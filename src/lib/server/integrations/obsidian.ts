// Obsidian over MCP: the headless obsidian-remote-rest-api server or the Local REST API plugin
// inside desktop Obsidian. Neither knows about daily notes, so the note path is computed here.
import { Agent, request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
	StreamableHTTPClientTransport,
	StreamableHTTPError
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { DeliverError, type DeliverContext, type IntegrationKind } from './types.ts';
import { renderEntry, renderNotePath, renderTemplate, type TemplateVars } from './template.ts';

export interface ObsidianConfig {
	url: string;
	apiKey: string;
	insecureTls: boolean;
	notePath: string;
	heading: string;
	entryTemplate: string;
	newNoteTemplate: string;
}

export const OBSIDIAN_DEFAULTS: ObsidianConfig = {
	url: 'http://obsidian-rest:27123/mcp/',
	apiKey: '',
	insecureTls: false,
	notePath: '{{date:YYYY-MM-DD}}.md',
	heading: 'Notes',
	entryTemplate: '- {{time:HH:mm}} {{transcript}}',
	newNoteTemplate: '## {{heading}}\n'
};

/** The default new-note template before it named {{heading}}; stored configs still carry it */
const OLD_NEW_NOTE_TEMPLATE = '## Notes\n';

/** Per call timeout for MCP requests */
const CALL_TIMEOUT_MS = 30_000;
/** Longest wait for the session DELETE when closing */
const CLOSE_TIMEOUT_MS = 5_000;

export function obsidianConfig(raw: Record<string, unknown>): ObsidianConfig {
	const str = (k: keyof ObsidianConfig) =>
		typeof raw[k] === 'string' && (raw[k] as string).trim() !== ''
			? (raw[k] as string)
			: (OBSIDIAN_DEFAULTS[k] as string);
	return {
		url: str('url').trim(),
		apiKey: typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '',
		insecureTls: raw.insecureTls === true || raw.insecureTls === 'true' || raw.insecureTls === 'on',
		notePath: str('notePath'),
		heading: str('heading')
			.trim()
			.replace(/^#+\s*/, ''),
		entryTemplate: str('entryTemplate'),
		// An empty template is allowed: the heading gets added on first delivery. The old default
		// is read as the new one, so a changed heading also applies to configs saved with it
		newNoteTemplate:
			typeof raw.newNoteTemplate === 'string' && raw.newNoteTemplate !== OLD_NEW_NOTE_TEMPLATE
				? raw.newNoteTemplate
				: OBSIDIAN_DEFAULTS.newNoteTemplate
	};
}

let insecureAgent: Agent | undefined;

/**
 * fetch that skips TLS verification, for the plugin's self-signed 27124 certificate. undici is
 * not a dependency, so this goes through node:https and streams the body back as a Response.
 */
export const insecureFetch: typeof fetch = async (input, init) => {
	const url = new URL(input instanceof Request ? input.url : String(input));
	if (url.protocol !== 'https:') return fetch(input, init);
	insecureAgent ??= new Agent({ rejectUnauthorized: false, keepAlive: true });
	const headers: Record<string, string> = {};
	new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
	const body = init?.body;
	if (body != null && typeof body !== 'string' && !(body instanceof Uint8Array)) {
		throw new TypeError('insecureFetch only sends string or byte bodies');
	}
	const signal = init?.signal ?? undefined;
	signal?.throwIfAborted();
	return new Promise<Response>((resolve, reject) => {
		const req = httpsRequest(
			url,
			{ method: init?.method ?? 'GET', headers, agent: insecureAgent, signal },
			(res) => {
				const out = new Headers();
				for (const [k, v] of Object.entries(res.headers)) {
					if (Array.isArray(v)) for (const item of v) out.append(k, item);
					else if (v !== undefined) out.set(k, v);
				}
				const status = res.statusCode ?? 502;
				const empty = status === 204 || status === 304 || init?.method === 'HEAD';
				if (empty) res.resume();
				resolve(
					new Response(empty ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>), {
						status,
						statusText: res.statusMessage,
						headers: out
					})
				);
			}
		);
		req.on('error', (e) => reject(new TypeError('fetch failed', { cause: e })));
		if (body != null) req.write(body);
		req.end();
	});
};

const NETWORK_CODES = new Set([
	'ECONNREFUSED',
	'ECONNRESET',
	'ETIMEDOUT',
	'EHOSTUNREACH',
	'ENETUNREACH',
	'EAI_AGAIN',
	'ENOTFOUND',
	'EPIPE',
	'UND_ERR_SOCKET',
	'UND_ERR_CONNECT_TIMEOUT'
]);

const TLS_CODES = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/;

/** Maps transport and protocol errors to DeliverError */
export function toDeliverError(e: unknown, url: string): DeliverError {
	if (e instanceof DeliverError) return e;
	if (e instanceof StreamableHTTPError) {
		const code = e.code ?? 0;
		if (code === 401 || code === 403)
			return new DeliverError('Obsidian rejected the API key', false);
		if (code === 404) return new DeliverError(`No MCP endpoint at ${url}`, false);
		const retryable = code === 408 || code === 429 || code >= 500 || code === 0;
		return new DeliverError(`Obsidian answered ${code || 'with an error'}`, retryable);
	}
	const err = e as { name?: string; message?: string; code?: unknown; cause?: { code?: string } };
	const code = String(err?.cause?.code ?? err?.code ?? '');
	if (TLS_CODES.test(code)) {
		return new DeliverError(
			`TLS check failed (${code}). Turn on insecure TLS for a self-signed cert`,
			false
		);
	}
	if (NETWORK_CODES.has(code)) return new DeliverError(`Cannot reach ${url} (${code})`, true);
	if (err?.name === 'AbortError' || err?.name === 'TimeoutError' || code === '-32001') {
		return new DeliverError('Obsidian did not answer in time', true);
	}
	if (err?.message === 'fetch failed') return new DeliverError(`Cannot reach ${url}`, true);
	return new DeliverError(err?.message || String(e), true);
}

interface ToolResult {
	isError?: boolean;
	content?: { type: string; text?: string }[];
}

const rawTextOf = (r: ToolResult) =>
	(r.content ?? []).map((c) => (c.type === 'text' ? (c.text ?? '') : '')).join('\n');

const textOf = (r: ToolResult) => rawTextOf(r).trim();

type Headings = { [heading: string]: Headings };

/** Full path to the first heading named `name`, at any level. Exact match first, then case-insensitive */
export function findHeadingPath(headings: Headings, name: string): string[] | null {
	const walk = (node: Headings, trail: string[], eq: (k: string) => boolean): string[] | null => {
		for (const [k, child] of Object.entries(node ?? {})) {
			if (eq(k)) return [...trail, k];
			const hit = walk(child, [...trail, k], eq);
			if (hit) return hit;
		}
		return null;
	};
	const want = name.trim();
	return (
		walk(headings, [], (k) => k.trim() === want) ??
		walk(headings, [], (k) => k.trim().toLowerCase() === want.toLowerCase())
	);
}

/** Separator so `appended` starts on its own line after one blank line */
export function separatorBefore(content: string) {
	if (!content) return '';
	if (content.endsWith('\n\n')) return '';
	if (content.endsWith('\n')) return '\n';
	return '\n\n';
}

const LIST_ITEM = /^\s*([-*+]|\d+\.)\s/;

/**
 * True when a list entry can extend the list that ends `section`: both are list items and the
 * section holds no sub-headings (within -1 would land after them).
 */
export function continuesList(section: string, entry: string) {
	if (!LIST_ITEM.test(entry) || /^#{1,6}\s/m.test(section)) return false;
	const blocks = section.trim().split(/\n[ \t]*\n/);
	const last = blocks.at(-1) ?? '';
	return last !== '' && LIST_ITEM.test(last);
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * True when `entry` sits in `body` as whole lines: it starts a line, ends one, and the line after
 * it is not an indented continuation of the same item. "- 10:00 Buy milk" is not in
 * "- 10:00 Buy milk and eggs".
 */
export function containsEntry(body: string, entry: string) {
	const lf = (t: string) => t.replace(/\r\n?/g, '\n');
	const want = lf(entry).replace(/\n+$/, '');
	if (!want) return false;
	const continuation = LIST_ITEM.test(want) ? '(?![ \\t]+\\S)' : '';
	return new RegExp(`(^|\\n)${escapeRegExp(want)}(\\n${continuation}|$)`).test(lf(body));
}

/** Width of each numeric date token, in the order they rank */
const RANKED = ['YYYY', 'MM', 'DD', 'HH', 'mm', 'ss'] as const;
const FORMAT_TOKEN = /\[([^\]]*)\]|YYYY|MMMM|MMM|MM|DD|dddd|ddd|HH|mm|ss/g;

/** True when a note path template names one note per day: its {{date}} has year, month and day */
export function notePerDay(notePath: string) {
	for (const m of notePath.matchAll(/\{\{\s*date\s*(?::([^}]*))?\}\}/g)) {
		const fmt = (m[1]?.trim() || 'YYYY-MM-DD').replace(/\[[^\]]*\]/g, '');
		if (/YYYY/.test(fmt) && /MM/.test(fmt) && /DD/.test(fmt)) return true;
	}
	return false;
}

/**
 * Reads a sort key off a note line when the entry template starts with a {{time}} token, e.g.
 * "- {{time:HH:mm}} ..." gives a reader for lines like "- 09:05 ...". Null when the template
 * starts otherwise, its time format has names (MMM, ddd), which do not sort, or it has no date
 * while the note is not one per day (a 09:00 from today must not go above yesterday's 10:00).
 */
export function entryOrder(
	template: string,
	perDay = true
): ((line: string) => string | null) | null {
	const m = /^([^{\n]*)\{\{\s*time\s*(?::([^}]*))?\}\}/.exec(template);
	if (!m) return null;
	const fmt = m[2]?.trim() || 'HH:mm';
	const order: (typeof RANKED)[number][] = [];
	let pattern = '';
	let last = 0;
	for (const t of fmt.matchAll(FORMAT_TOKEN)) {
		pattern += escapeRegExp(fmt.slice(last, t.index));
		last = t.index + t[0].length;
		if (t[1] !== undefined) {
			pattern += escapeRegExp(t[1]);
			continue;
		}
		const rank = RANKED.indexOf(t[0] as (typeof RANKED)[number]);
		if (rank < 0) return null;
		order.push(RANKED[rank]!);
		pattern += `(\\d{${t[0].length}})`;
	}
	pattern += escapeRegExp(fmt.slice(last));
	if (!order.length) return null;
	if (!perDay && !['YYYY', 'MM', 'DD'].every((t) => order.includes(t as (typeof RANKED)[number])))
		return null;
	const re = new RegExp(`^${escapeRegExp(m[1]!)}${pattern}(?!\\d)`);
	return (line) => {
		const hit = re.exec(line);
		if (!hit) return null;
		const by: Record<string, string> = {};
		order.forEach((token, i) => (by[token] = hit[i + 1]!));
		return RANKED.map((t) => by[t] ?? '').join('');
	};
}

/**
 * `body` with `entry` placed before the first top-level entry that sorts after it, or null when
 * none does (then appending keeps the order). Lines after a sub-heading are left alone.
 */
export function insertInOrder(
	body: string,
	entry: string,
	keyOf: (line: string) => string | null
): string | null {
	const key = keyOf(entry);
	if (key === null) return null;
	const lines = body.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		if (/^#{1,6}\s/.test(line)) return null;
		const k = keyOf(line);
		if (k === null || k <= key) continue;
		// A list item joins the list; any other entry is its own paragraph
		const block = LIST_ITEM.test(entry) ? [entry] : [entry, ''];
		return [...lines.slice(0, i), ...block, ...lines.slice(i)].join('\n');
	}
	return null;
}

export interface Session {
	client: Client;
	call(name: string, args: Record<string, unknown>): Promise<ToolResult>;
	close(): Promise<void>;
}

export async function connect(
	config: Pick<ObsidianConfig, 'url' | 'apiKey' | 'insecureTls'>,
	signal?: AbortSignal
): Promise<Session> {
	let url: URL;
	try {
		url = new URL(config.url);
	} catch {
		throw new DeliverError(`Not a URL: ${config.url}`, false);
	}
	if (!config.apiKey) throw new DeliverError('API key is not set', false);
	const transport = new StreamableHTTPClientTransport(url, {
		requestInit: { headers: { Authorization: `Bearer ${config.apiKey}` } },
		fetch: config.insecureTls ? insecureFetch : undefined
	});
	const client = new Client({ name: 'index-01-router', version: '0.1.0' });
	// client.close() only aborts the stream; the server keeps a session until it gets a DELETE.
	// terminateSession() runs on the transport's own controller, so it works after `signal` fired
	const end = async () => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		await Promise.race([
			transport.terminateSession().catch(() => {}),
			new Promise<void>((r) => (timer = setTimeout(r, CLOSE_TIMEOUT_MS)))
		]);
		clearTimeout(timer);
		await client.close().catch(() => {});
	};
	try {
		await client.connect(transport, { signal, timeout: CALL_TIMEOUT_MS });
	} catch (e) {
		// Initialize can fail after the server assigned a session id
		await end();
		throw toDeliverError(e, config.url);
	}
	return {
		client,
		async call(name, args) {
			try {
				return (await client.callTool({ name, arguments: args }, undefined, {
					signal,
					timeout: CALL_TIMEOUT_MS
				})) as ToolResult;
			} catch (e) {
				throw toDeliverError(e, config.url);
			}
		},
		close: end
	};
}

const isMissingFile = (r: ToolResult) => !!r.isError && /not found/i.test(textOf(r));

function parseJson<T>(r: ToolResult, what: string): T {
	try {
		return JSON.parse(textOf(r)) as T;
	} catch {
		throw new DeliverError(`Unexpected ${what} reply from Obsidian`, false);
	}
}

function check(r: ToolResult, what: string) {
	if (r.isError) throw new DeliverError(`${what}: ${textOf(r) || 'failed'}`, false);
	return r;
}

/** Serialises writes to one note within this process, so two deliveries cannot both create it */
const noteLocks = new Map<string, Promise<unknown>>();

async function withNoteLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const prev = noteLocks.get(key) ?? Promise.resolve();
	const run = prev.then(fn, fn);
	const tail = run.catch(() => {});
	noteLocks.set(key, tail);
	try {
		return await run;
	} finally {
		if (noteLocks.get(key) === tail) noteLocks.delete(key);
	}
}

type DocumentMap = { headings: Headings; version?: string };

/**
 * Adds `entry` under `heading` in `path`, creating the note and the heading when missing. With
 * `keyOf` (see entryOrder) it goes before the first entry that sorts after it, otherwise at the
 * end of the section.
 */
export async function appendToNote(
	session: Session,
	path: string,
	heading: string,
	entry: string,
	newNote: string,
	keyOf: ((line: string) => string | null) | null = null,
	skipIfPresent = true
) {
	let map = await session.call('vault_get_document_map', { path });
	if (isMissingFile(map)) {
		check(
			await session.call('vault_write', { path, content: newNote }),
			`Could not create ${path}`
		);
		map = await session.call('vault_get_document_map', { path });
	}
	check(map, `Could not read ${path}`);
	let doc = parseJson<DocumentMap>(map, 'document map');
	let target = findHeadingPath(doc.headings, heading);

	if (!target) {
		const read = check(await session.call('vault_read', { path }), `Could not read ${path}`);
		const content = parseJson<{ content?: string }>(read, 'read').content ?? '';
		check(
			await session.call('vault_append', {
				path,
				content: `${separatorBefore(content)}## ${heading}\n`
			}),
			`Could not add the ${heading} heading`
		);
		map = check(await session.call('vault_get_document_map', { path }), `Could not read ${path}`);
		doc = parseJson<DocumentMap>(map, 'document map');
		target = findHeadingPath(doc.headings, heading);
		if (!target) throw new DeliverError(`Added the ${heading} heading but cannot find it`, false);
	}

	const section = await session.call('vault_read', { path, targetType: 'heading', target });
	const body = section.isError ? null : rawTextOf(section);
	// A retry whose entry already landed. A first attempt writes even when the same text from
	// the same minute is there: that is another recording
	if (skipIfPresent && body !== null && containsEntry(body, entry)) return;

	const ordered = body !== null && keyOf ? insertInOrder(body, entry, keyOf) : null;
	if (ordered !== null) {
		// A replace of the section's content takes what the read returned. ifMatch turns a hand
		// edit in Obsidian since the map was read into a retry instead of overwriting it
		const res = await session.call('vault_patch', {
			path,
			targetType: 'heading',
			target,
			operation: 'replace',
			content: ordered,
			...(doc.version ? { ifMatch: doc.version } : {})
		});
		if (res.isError && /precondition|ifMatch/i.test(textOf(res))) {
			throw new DeliverError(`${path} changed while writing`, true);
		}
		check(res, `Could not write to ${path}`);
		return;
	}

	const tight = body !== null && continuesList(body, entry);
	const res = await session.call('vault_patch', {
		path,
		targetType: 'heading',
		target,
		operation: 'append',
		// within -1 continues the section's last list instead of starting a new block
		...(tight
			? { within: -1, content: `\n${entry}` }
			: { content: entry, createTargetIfMissing: true })
	});
	check(res, `Could not append to ${path}`);
}

export const obsidian: IntegrationKind = {
	kind: 'obsidian',
	label: 'Obsidian',
	fields: [
		{
			key: 'url',
			label: 'MCP URL',
			type: 'url',
			default: OBSIDIAN_DEFAULTS.url,
			hint: 'Ends in /mcp/',
			required: true
		},
		{ key: 'apiKey', label: 'API key', type: 'secret', required: true },
		{
			key: 'insecureTls',
			label: 'Accept a self-signed certificate',
			type: 'boolean',
			default: false,
			hint: 'Plugin on port 27124'
		},
		{
			key: 'notePath',
			label: 'Note path',
			type: 'text',
			default: OBSIDIAN_DEFAULTS.notePath,
			hint: 'Relative to the vault root'
		},
		{ key: 'heading', label: 'Heading', type: 'text', default: OBSIDIAN_DEFAULTS.heading },
		{
			key: 'entryTemplate',
			label: 'Entry',
			type: 'textarea',
			default: OBSIDIAN_DEFAULTS.entryTemplate,
			hint: '{{time:HH:mm}} {{transcript}} {{languages}} {{trigger}} {{duration}}'
		},
		{
			key: 'newNoteTemplate',
			label: 'New note',
			type: 'textarea',
			default: OBSIDIAN_DEFAULTS.newNoteTemplate,
			hint: 'Used when the note is missing. {{heading}} {{date:YYYY-MM-DD}}'
		}
	],
	secrets: ['apiKey'],

	async deliver(ctx: DeliverContext) {
		const config = obsidianConfig(ctx.config);
		const { recording } = ctx;
		const vars: TemplateVars = {
			recordedAt: recording.recordedAt,
			timeZone: ctx.general.timezone || 'UTC',
			transcript: recording.transcript ?? '',
			languages: recording.languages ? recording.languages.split(',').filter(Boolean) : [],
			trigger: recording.trigger,
			durationMs: recording.durationMs
		};
		let path: string, entry: string, newNote: string;
		try {
			path = renderNotePath(config.notePath, vars);
			entry = renderEntry(config.entryTemplate, vars);
			newNote = renderTemplate(config.newNoteTemplate, {
				...vars,
				transcript: '',
				heading: config.heading
			});
		} catch (e) {
			throw new DeliverError((e as Error).message, false);
		}
		return withNoteLock(`${config.url}\n${path}`, async () => {
			const session = await connect(config, ctx.signal);
			try {
				await appendToNote(
					session,
					path,
					config.heading,
					entry,
					newNote,
					entryOrder(config.entryTemplate, notePerDay(config.notePath)),
					ctx.firstAttempt !== true
				);
			} finally {
				await session.close();
			}
			return { target: path };
		});
	},

	async test(raw) {
		const config = obsidianConfig(raw);
		const session = await connect(config, AbortSignal.timeout(CALL_TIMEOUT_MS));
		try {
			const { tools } = await session.client.listTools();
			if (!tools.some((t) => t.name === 'vault_patch')) {
				throw new DeliverError(`Connected, but the server has no vault_patch tool`, false);
			}
			const list = await session.call('vault_list', {});
			const entries = list.isError
				? null
				: (parseJson<{ files?: string[] }>(list, 'list').files ?? []).length;
			return entries === null
				? `Connected, ${tools.length} tools`
				: `Connected, ${tools.length} tools, ${entries} ${entries === 1 ? 'entry' : 'entries'} at the vault root`;
		} catch (e) {
			throw toDeliverError(e, config.url);
		} finally {
			await session.close();
		}
	}
};
