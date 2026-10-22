// OpenAI compatible POST /audio/transcriptions (OpenAI, Groq, speaches), and the HTTP helper every
// provider uses: per request timeout, retries with backoff for 408/409/429/5xx and network errors,
// specific errors for the rest.
import { cleanTranscriptText, textFromSegments } from './clean.ts';
import { normalizeLanguages, sanitizePrompt } from './prompt.ts';
import {
	TranscribeError,
	type ChunkReply,
	type Provider,
	type RequestContext,
	type TranscriptionSettings
} from './types.ts';

export const ATTEMPTS = 3;
export const TIMEOUT_MS = 120_000;
const BASE_MS = 1000;
const MAX_WAIT_MS = 30_000;

const sleep = (ms: number, signal?: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		if (signal?.aborted) return reject(signal.reason);
		const t = setTimeout(done, ms);
		function done() {
			signal?.removeEventListener('abort', abort);
			resolve();
		}
		function abort() {
			clearTimeout(t);
			reject(signal!.reason);
		}
		signal?.addEventListener('abort', abort, { once: true });
	});

export const trimUrl = (url: string) => url.trim().replace(/\/+$/, '');

export function hostOf(url: string) {
	try {
		return new URL(url).host;
	} catch {
		throw new TranscribeError(`Not a URL: ${url}`, false);
	}
}

/** Milliseconds from Retry-After (seconds or HTTP date) or retry-after-ms */
export function retryAfterMs(headers: Headers, now = Date.now()): number | null {
	const ms = Number(headers.get('retry-after-ms'));
	if (headers.get('retry-after-ms') && Number.isFinite(ms)) return Math.max(0, ms);
	const h = headers.get('retry-after');
	if (!h) return null;
	const s = Number(h);
	if (Number.isFinite(s)) return Math.max(0, s * 1000);
	const d = Date.parse(h);
	return Number.isFinite(d) ? Math.max(0, d - now) : null;
}

/** The message in an error body: OpenAI and Gemini `{error: {message}}`, whisper.cpp `{error}` */
export function errorDetail(body: string): string {
	let msg = body;
	try {
		const j = JSON.parse(body) as { error?: unknown; message?: unknown; detail?: unknown };
		const e = j.error;
		if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string')
			msg = (e as { message: string }).message;
		else if (typeof e === 'string') msg = e;
		else if (typeof j.message === 'string') msg = j.message;
		else if (typeof j.detail === 'string') msg = j.detail;
	} catch {
		// not JSON
	}
	msg = msg
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return msg.length > 200 ? msg.slice(0, 197) + '...' : msg;
}

/**
 * A 403 or 429 that refuses the model rather than the key: Gemini answers PERMISSION_DENIED for
 * a model the key may not use (the 2.5 models for new keys), and RESOURCE_EXHAUSTED with a
 * quota limit of 0 for a model the key's tier does not include
 */
function refusesModel(status: number, body: string) {
	if (status === 403)
		return (
			/PERMISSION_DENIED|model|not (?:allowed|available)|does not have access/i.test(body) &&
			!/API_KEY_|API key|unregistered callers/i.test(body)
		);
	return status === 429 && /RESOURCE_EXHAUSTED/.test(body) && /\blimit:\s*0\b/i.test(body);
}

/**
 * Error for a non-2xx answer. Retryable: 408, 409, 429 (except quota), 5xx. With `model` given, a
 * refusal of that model is named as such instead of as a rejected key.
 */
export function httpError(
	status: number,
	body: string,
	host: string,
	model?: string
): TranscribeError {
	const detail = errorDetail(body);
	const tail = detail ? `: ${detail}` : '';
	if (model && refusesModel(status, body))
		return new TranscribeError(`${model} not available to this key (${status})${tail}`, false);
	if (status === 401 || status === 403)
		return new TranscribeError(`Key rejected by ${host} (${status})`, false);
	if (
		status === 429 &&
		/insufficient_quota|billing|quota exceeded|RESOURCE_EXHAUSTED.*quota/i.test(body)
	)
		return new TranscribeError(`Quota used up at ${host} (429)${tail}`, false);
	// Gemini answers a bad key with 400 API_KEY_INVALID
	if (status === 400 && /API_KEY_INVALID|API key not valid/i.test(body))
		return new TranscribeError(`Key rejected by ${host} (400)`, false);
	const retryable = status === 408 || status === 409 || status === 429 || status >= 500;
	return new TranscribeError(`${host} answered ${status}${tail}`, retryable);
}

export interface SendOptions {
	method?: 'GET' | 'POST';
	headers?: Record<string, string>;
	/** Built per attempt */
	body?: () => BodyInit;
	attempts?: number;
	/** Model the request asks for, named in errors that refuse it */
	model?: string;
}

/** One request with retries. Resolves to the response body of a 2xx answer */
export async function send(
	url: string,
	ctx: RequestContext,
	opts: SendOptions = {}
): Promise<string> {
	const host = hostOf(url);
	const attempts = opts.attempts ?? ATTEMPTS;
	const timeoutMs = ctx.timeoutMs ?? TIMEOUT_MS;
	const wait = ctx.sleep ?? ((ms: number) => sleep(ms, ctx.signal));
	let last: TranscribeError | null = null;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		ctx.signal?.throwIfAborted();
		const timeout = AbortSignal.timeout(timeoutMs);
		const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
		let after: number | null = null;
		let r: Response | null = null;
		let body = '';
		try {
			const res = await ctx.fetch(url, {
				method: opts.method ?? (opts.body ? 'POST' : 'GET'),
				headers: opts.headers,
				body: opts.body?.(),
				signal
			});
			body = await res.text();
			r = res;
		} catch (e) {
			if (ctx.signal?.aborted) throw ctx.signal.reason;
			const err = e as Error & { cause?: { code?: string; message?: string } };
			last = timeout.aborted
				? new TranscribeError(`${host} did not answer within ${timeoutMs / 1000} s`, true)
				: new TranscribeError(
						`Could not reach ${host} (${err.cause?.code ?? err.cause?.message ?? err.message})`,
						true
					);
		}
		if (r) {
			if (r.ok) return body;
			last = httpError(r.status, body, host, opts.model);
			if (!last.retryable) throw last;
			after = retryAfterMs(r.headers);
			// A server asking for minutes is better left to the pipeline's own retry
			if (after !== null && after > 60_000) throw last;
		}
		if (attempt < attempts) {
			const backoff = BASE_MS * 2 ** (attempt - 1) + Math.random() * BASE_MS * 0.25;
			await wait(Math.min(MAX_WAIT_MS, after ?? backoff));
		}
	}
	throw last ?? new TranscribeError(`${host} failed`, true);
}

export const bearer = (key: string): Record<string, string> =>
	key ? { authorization: `Bearer ${key}` } : {};

const isOpenAIHost = (url: string) => /(^|\.)openai\.com$/.test(hostOf(url).split(':')[0]!);

export function requireKey(baseUrl: string, apiKey: string) {
	if (!apiKey && isOpenAIHost(baseUrl))
		throw new TranscribeError(`No API key set for ${hostOf(baseUrl)}`, false);
}

/**
 * GET {base}/models/{model}, which is small and quick; servers without that route get the full
 * list checked instead
 */
export async function probeModel(
	baseUrl: string,
	apiKey: string,
	model: string,
	ctx: RequestContext
): Promise<string> {
	const base = trimUrl(baseUrl);
	const host = hostOf(base);
	requireKey(base, apiKey);
	const get = (path: string) =>
		send(
			`${base}${path}`,
			{ ...ctx, timeoutMs: ctx.timeoutMs ?? 20_000 },
			{
				headers: bearer(apiKey),
				attempts: 1
			}
		);
	const notFound = (e: unknown) => e instanceof TranscribeError && / answered 404/.test(e.message);
	try {
		const one = JSON.parse(await get(`/models/${model}`)) as { id?: unknown };
		if (one?.id === model) return `${model} available`;
	} catch (e) {
		if (!notFound(e) && !(e instanceof SyntaxError)) throw e;
	}
	let body: string;
	try {
		body = await get('/models');
	} catch (e) {
		if (notFound(e)) return `${host} answered, but has no model list to check ${model} against`;
		throw e;
	}
	let ids: string[];
	try {
		const j = JSON.parse(body) as { data?: { id?: unknown }[] };
		ids = (j.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string');
	} catch {
		return `${host} answered, but its model list is not JSON`;
	}
	if (!ids.length) return `${host} answered with an empty model list`;
	if (!ids.includes(model)) throw new TranscribeError(`${model} not offered by ${host}`, false);
	return `${model} available`;
}

// ---------- provider ----------

export type ModelKind = 'gpt-transcribe' | 'gpt-4o' | 'whisper';

/** gpt-transcribe takes a language list; gpt-4o-*transcribe one language; the rest are Whisper-like */
export function modelKind(model: string): ModelKind {
	if (/^gpt-transcribe/i.test(model)) return 'gpt-transcribe';
	if (/^gpt-/i.test(model)) return 'gpt-4o';
	return 'whisper';
}

/** Endpoints that refused verbose_json once, so later requests go straight to json */
const refusedVerbose = new Set<string>();

export function transcriptionFields(
	settings: Pick<TranscriptionSettings, 'languages' | 'prompt'>,
	model: string,
	responseFormat?: string
): [string, string][] {
	const kind = modelKind(model);
	const fields: [string, string][] = [['model', model]];
	fields.push([
		'response_format',
		responseFormat ?? (kind === 'whisper' ? 'verbose_json' : 'json')
	]);
	const langs = normalizeLanguages(settings.languages);
	// A single `language` forces that language on code-switched audio, so only with one hint
	if (kind === 'gpt-transcribe') for (const l of langs) fields.push(['languages[]', l]);
	else if (langs.length === 1) fields.push(['language', langs[0]!]);
	if (kind === 'whisper') fields.push(['temperature', '0']);
	const prompt = sanitizePrompt(settings.prompt, kind === 'whisper' ? 600 : 2000);
	if (prompt) fields.push(['prompt', prompt]);
	return fields;
}

/**
 * Text and languages of a /audio/transcriptions reply (json, verbose_json, or plain text).
 * verbose_json segments that Whisper marks as non-speech or as a repetition loop are left out,
 * then sound-event tags are stripped.
 */
export function parseTranscription(body: string): ChunkReply {
	let j: { text?: unknown; language?: unknown; languages?: unknown; segments?: unknown };
	try {
		j = JSON.parse(body);
	} catch {
		return { text: cleanTranscriptText(body), languages: [] };
	}
	const languages = normalizeLanguages([
		...(Array.isArray(j.languages) ? j.languages : []),
		...(j.language ? [j.language] : [])
	]);
	const full = typeof j.text === 'string' ? j.text : '';
	const seg = textFromSegments(j.segments, full);
	const text = cleanTranscriptText(seg ? seg.text : full);
	return seg?.noSpeech === undefined
		? { text, languages }
		: { text, languages, noSpeech: seg.noSpeech };
}

export const openai: Provider = {
	id: 'openai',
	label: 'OpenAI compatible',
	defaultModel: 'gpt-transcribe',
	format: 'webm',
	// OpenAI takes 25 MB; leave room for the multipart envelope
	maxBytes: 24 * 1024 * 1024,
	model: (s) => s.openai.model.trim() || 'gpt-transcribe',

	async transcribe(audio, settings, ctx) {
		const base = trimUrl(settings.openai.baseUrl);
		const model = this.model(settings);
		requireKey(base, settings.openai.apiKey);
		const memo = `${base} ${model}`;
		const post = (format?: string) =>
			send(`${base}/audio/transcriptions`, ctx, {
				headers: bearer(settings.openai.apiKey),
				body: () => {
					const form = new FormData();
					form.set(
						'file',
						new Blob([audio.bytes as Uint8Array<ArrayBuffer>], { type: audio.mime }),
						audio.name
					);
					for (const [k, v] of transcriptionFields(settings, model, format)) form.append(k, v);
					return form;
				}
			});
		const verbose = modelKind(model) === 'whisper' && !refusedVerbose.has(memo);
		try {
			return parseTranscription(await post(verbose ? undefined : 'json'));
		} catch (e) {
			if (
				verbose &&
				e instanceof TranscribeError &&
				/\b400\b.*(response_format|verbose_json)/i.test(e.message)
			) {
				refusedVerbose.add(memo);
				return parseTranscription(await post('json'));
			}
			throw e;
		}
	},

	test(settings, ctx) {
		return probeModel(settings.openai.baseUrl, settings.openai.apiKey, this.model(settings), ctx);
	}
};
