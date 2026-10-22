// Runs deliver() and test() against an in-process MCP server that stands in for Obsidian, to
// check what goes over the wire: one session per call, ended with a DELETE.
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Recording } from '../db/schema.ts';
import { obsidian } from './obsidian.ts';

/** Files in the fake vault */
const files = new Map<string, string>();
const calls: { name: string; args: Record<string, unknown> }[] = [];
const deletes: (string | undefined)[] = [];
const sessions = new Map<string, StreamableHTTPServerTransport>();

const text = (value: unknown, isError = false) => ({
	content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
	...(isError ? { isError: true } : {})
});

/** Flat heading map of `## X` lines, enough for these tests */
const headingsOf = (content: string) =>
	Object.fromEntries([...content.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => [m[1]!.trim(), {}]));

function tool(name: string, args: Record<string, unknown>) {
	calls.push({ name, args });
	const path = String(args.path ?? '');
	switch (name) {
		case 'vault_get_document_map': {
			const content = files.get(path);
			if (content === undefined) return text(`File not found: ${path}`, true);
			return text({ version: 'v1', headings: headingsOf(content), blocks: [] });
		}
		case 'vault_write':
			files.set(path, String(args.content));
			return text({ message: 'OK' });
		case 'vault_read':
			return text('');
		case 'vault_patch':
			files.set(path, `${files.get(path) ?? ''}${String(args.content)}\n`);
			return text({ message: 'OK' });
		case 'vault_list':
			return text({ files: [...files.keys()] });
		default:
			return text(`Unknown tool ${name}`, true);
	}
}

function mcpServer() {
	const server = new Server(
		{ name: 'fake-obsidian', version: '0.0.0' },
		{ capabilities: { tools: {} } }
	);
	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: ['vault_get_document_map', 'vault_write', 'vault_read', 'vault_patch', 'vault_list'].map(
			(name) => ({ name, inputSchema: { type: 'object' as const } })
		)
	}));
	server.setRequestHandler(CallToolRequestSchema, async (req) =>
		tool(req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>)
	);
	return server;
}

async function readBody(req: IncomingMessage) {
	const chunks: Buffer[] = [];
	for await (const c of req) chunks.push(c as Buffer);
	const raw = Buffer.concat(chunks).toString('utf8');
	return raw ? JSON.parse(raw) : undefined;
}

let http: HttpServer;
let url = '';

beforeAll(async () => {
	http = createServer(async (req, res) => {
		const id = req.headers['mcp-session-id'] as string | undefined;
		if (req.method === 'DELETE') deletes.push(id);
		const body = req.method === 'POST' ? await readBody(req) : undefined;
		let transport = id ? sessions.get(id) : undefined;
		if (id && !transport) {
			res.writeHead(404).end();
			return;
		}
		if (!transport) {
			transport = new StreamableHTTPServerTransport({
				sessionIdGenerator: () => randomUUID(),
				enableJsonResponse: true,
				onsessioninitialized: (sid) => void sessions.set(sid, transport!),
				onsessionclosed: (sid) => void sessions.delete(sid)
			});
			await mcpServer().connect(transport);
		}
		await transport.handleRequest(req, res, body);
	});
	await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
	url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp/`;
});

afterAll(async () => {
	http.closeAllConnections();
	await new Promise((r) => http.close(r));
});

beforeEach(() => {
	files.clear();
	calls.length = 0;
	deletes.length = 0;
});

const recording = (over: Partial<Recording> = {}) =>
	({
		id: randomUUID(),
		trigger: 'single-click-hold',
		recordedAt: new Date('2026-10-22T09:00:00Z'),
		transcript: 'Hello',
		languages: null,
		durationMs: 1000,
		...over
	}) as Recording;

const deliver = (config: Record<string, unknown> = {}) =>
	obsidian.deliver({
		recording: recording(),
		config: { url, apiKey: 'k', ...config },
		general: { timezone: 'UTC' } as never
	});

describe('MCP sessions', () => {
	it('ends the session of a delivery with one DELETE', async () => {
		await deliver();
		expect(sessions.size).toBe(0);
		expect(deletes).toHaveLength(1);
		expect(deletes[0]).toMatch(/^[0-9a-f-]{36}$/);
	});

	it('ends the session of a connection test with one DELETE', async () => {
		expect(
			await obsidian.test(
				{ url, apiKey: 'k' },
				{ timeZone: 'UTC', now: new Date('2026-10-22T09:00:00Z') }
			)
		).toEqual({ target: '2026-10-22.md', state: 'new', heading: 'Notes' });
		expect(sessions.size).toBe(0);
		expect(deletes).toHaveLength(1);
		expect(deletes[0]).toBeTruthy();
	});

	it('leaves no session behind over many deliveries', async () => {
		for (let i = 0; i < 20; i++) await deliver();
		expect(sessions.size).toBe(0);
		expect(new Set(deletes).size).toBe(20);
	});
});

describe('new note', () => {
	it('starts a missing note with the configured heading', async () => {
		await deliver({ heading: 'Inbox' });
		const write = calls.find((c) => c.name === 'vault_write');
		expect(write?.args).toEqual({ path: '2026-10-22.md', content: '## Inbox\n' });
		expect(files.get('2026-10-22.md')).toBe('## Inbox\n- 09:00 Hello\n');
		expect(calls.filter((c) => c.name === 'vault_append')).toHaveLength(0);
	});

	it('reads the old stored default as the new one', async () => {
		await deliver({ heading: 'Inbox', newNoteTemplate: '## Notes\n' });
		expect(files.get('2026-10-22.md')).toBe('## Inbox\n- 09:00 Hello\n');
	});
});
