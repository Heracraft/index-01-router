// Live test against the headless Obsidian MCP server. Opt in:
//   scripts/obsidian-dev.sh /path/to/vault-copy
//   OBSIDIAN_TEST_URL=http://127.0.0.1:27123/mcp/ OBSIDIAN_TEST_VAULT=/path/to/vault-copy \
//     [OBSIDIAN_TEST_HTTPS_URL=https://127.0.0.1:27124/mcp/] \
//     [PIPELINE_TEST_DATABASE_URL=postgres://root:pebble@localhost:5432/pipeline_test] \
//     pnpm exec vitest run src/lib/server/integrations/obsidian.live.test.ts
// Every run writes under a fresh folder in the vault and asserts by reading files from disk.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Recording } from '../db/schema.ts';

const url = process.env.OBSIDIAN_TEST_URL;
const httpsUrl = process.env.OBSIDIAN_TEST_HTTPS_URL;
const vault = process.env.OBSIDIAN_TEST_VAULT;
const key = process.env.OBSIDIAN_TEST_KEY ?? 'testkey123';
const dbUrl = process.env.PIPELINE_TEST_DATABASE_URL;

vi.mock('$app/env/private', () => ({
	DATABASE_URL: process.env.PIPELINE_TEST_DATABASE_URL ?? 'postgres://invalid',
	AUTH_SECRET: 'live-test-secret-live-test-secret-0123',
	DATA_DIR: '/nonexistent',
	FFPROBE_PATH: 'ffprobe',
	INDEX01_WEBHOOK_SECRET: undefined,
	OPENAI_API_KEY: undefined,
	GEMINI_API_KEY: undefined
}));

const fixtures = path.resolve(import.meta.dirname, '../../../../scripts/sample-vault');
const run = `vitest-${Date.now().toString(36)}`;
const general = { timezone: 'Africa/Nairobi' };

const { obsidian, connect } = await import('./obsidian.ts');
const { DeliverError } = await import('./types.ts');

function recording(over: Partial<Recording>): Recording {
	return {
		id: crypto.randomUUID(),
		deliveryId: 'live',
		source: 'ring',
		trigger: 'single-click-hold',
		signed: true,
		recordedAt: new Date(),
		receivedAt: new Date(),
		audioPath: null,
		audioMime: null,
		audioBytes: null,
		durationMs: 12_000,
		appTranscript: null,
		transcript: 'hello',
		languages: null,
		transcribedBy: 'test',
		transcribeMs: null,
		status: 'routing',
		error: null,
		attempts: 0,
		updatedAt: new Date(),
		...over
	};
}

const config = (over: Record<string, unknown> = {}) => ({
	url,
	apiKey: key,
	notePath: `${run}/Daily/{{date:YYYY-MM-DD}}.md`,
	heading: 'Notes',
	entryTemplate: '- {{time:HH:mm}} {{transcript}}',
	newNoteTemplate: '# {{date:YYYY-MM-DD}}\n\n## Notes\n',
	...over
});

/** Local Nairobi time on a date, as a Date */
const at = (date: string, time: string) => new Date(`${date}T${time}:00+03:00`);

const deliver = (rec: Partial<Recording>, over: Record<string, unknown> = {}) =>
	obsidian.deliver({ recording: recording(rec), config: config(over), general });

const read = (rel: string) => readFile(path.join(vault!, rel), 'utf8');
const daily = (date: string) => `${run}/Daily/${date}.md`;
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

describe.skipIf(!url || !vault)('obsidian live', () => {
	beforeAll(async () => {
		// Seed the run folder through the server so its index knows the files
		const s = await connect({ url: url!, apiKey: key, insecureTls: false });
		try {
			for (const name of ['2026-10-20.md', '2026-10-21.md']) {
				const content = await readFile(path.join(fixtures, 'Daily', name), 'utf8');
				const r = await s.call('vault_write', { path: daily(name.slice(0, 10)), content });
				expect(r.isError).toBeFalsy();
			}
		} finally {
			await s.close();
		}
	});

	it('creates a missing note with the Notes heading', async () => {
		const res = await deliver({
			recordedAt: at('2026-10-19', '07:15'),
			transcript: 'First of the day'
		});
		expect(res.target).toBe(daily('2026-10-19'));
		const text = await read(daily('2026-10-19'));
		expect(text).toBe('# 2026-10-19\n\n## Notes\n- 07:15 First of the day\n');
	});

	it('uses the local date near midnight', async () => {
		// 21:30 UTC on the 18th is 00:30 on the 19th in Nairobi
		const res = await deliver({
			recordedAt: new Date('2026-10-18T21:30:00Z'),
			transcript: 'After midnight'
		});
		expect(res.target).toBe(daily('2026-10-19'));
		expect(await read(daily('2026-10-19'))).toContain('- 00:30 After midnight');
	});

	it('appends under Notes in order and leaves other sections alone', async () => {
		const before = await read(daily('2026-10-21'));
		for (const [t, words] of [
			['09:00', 'Buy milk'],
			['09:05', 'Call Amina about the router'],
			['09:10', 'Third entry']
		] as const) {
			await deliver({ recordedAt: at('2026-10-21', t), transcript: words });
		}
		const text = await read(daily('2026-10-21'));
		const notes = text.indexOf('## Notes');
		const journal = text.indexOf('## Journal');
		const positions = [
			'- 08:30 Coffee',
			'- 09:00 Buy milk',
			'- 09:05 Call Amina',
			'- 09:10 Third'
		].map((s) => text.indexOf(s));
		expect(positions.every((p) => p > notes && p < journal)).toBe(true);
		expect([...positions].sort((a, b) => a - b)).toEqual(positions);
		// One tight list, a blank line before the next heading
		expect(text).toContain(
			'## Notes\n- 08:30 Coffee with Amina about the router\n- 09:00 Buy milk\n- 09:05 Call Amina about the router\n- 09:10 Third entry\n\n## Journal'
		);
		// Tasks section and the journal are byte for byte the same
		expect(text.slice(0, notes)).toBe(before.slice(0, before.indexOf('## Notes')));
		expect(text.slice(journal)).toBe(before.slice(before.indexOf('## Journal')));
	});

	it('adds the Notes heading to a note without one', async () => {
		await deliver({ recordedAt: at('2026-10-20', '18:00'), transcript: 'Evening thought' });
		const text = await read(daily('2026-10-20'));
		expect(text).toBe(
			'# 2026-10-20\n\n## Tasks\n- [x] Flash the ring firmware\n- [ ] Write the release notes\n\n## Notes\n- 18:00 Evening thought\n'
		);
	});

	it('keeps a multi-line transcript in one list item', async () => {
		await deliver({
			recordedAt: at('2026-10-22', '10:00'),
			transcript: 'Line one\n\nLine two\n## not a heading'
		});
		const text = await read(daily('2026-10-22'));
		expect(text).toContain('- 10:00 Line one\n  Line two\n  \\## not a heading');
		expect(count(text, '## Notes')).toBe(1);
	});

	it('writes a retried entry once', async () => {
		const rec = { recordedAt: at('2026-10-23', '11:11'), transcript: 'Only once please' };
		await deliver(rec);
		await deliver(rec);
		expect(count(await read(daily('2026-10-23')), 'Only once please')).toBe(1);
	});

	it('keeps Swahili and other unicode text intact', async () => {
		const words = 'Nimefika nyumbani salama, tutaonana kesho. Ça va? 東京 ✓ — ok';
		await deliver({ recordedAt: at('2026-10-24', '08:00'), transcript: words, languages: 'sw,en' });
		expect(await read(daily('2026-10-24'))).toContain(`- 08:00 ${words}`);
	});

	it('lands two concurrent deliveries to a new note', async () => {
		await Promise.all([
			deliver({ recordedAt: at('2026-10-25', '12:00'), transcript: 'Concurrent A' }),
			deliver({ recordedAt: at('2026-10-25', '12:01'), transcript: 'Concurrent B' })
		]);
		const text = await read(daily('2026-10-25'));
		expect(text).toContain('Concurrent A');
		expect(text).toContain('Concurrent B');
		expect(count(text, '## Notes')).toBe(1);
	});

	it('renders the other placeholders', async () => {
		await deliver(
			{
				recordedAt: at('2026-10-26', '06:00'),
				transcript: 'Tagged',
				languages: 'sw,en',
				durationMs: 83_000
			},
			{ entryTemplate: '- {{time}} [{{languages}}] ({{duration}}, {{trigger}}) {{transcript}}' }
		);
		expect(await read(daily('2026-10-26'))).toContain(
			'- 06:00 [sw, en] (1:23, single-click-hold) Tagged'
		);
	});

	it('fails for good on a wrong key', async () => {
		const e = await deliver({ recordedAt: at('2026-10-27', '06:00') }, { apiKey: 'wrong' }).catch(
			(e) => e
		);
		expect(e).toBeInstanceOf(DeliverError);
		expect(e).toMatchObject({ retryable: false, message: 'Obsidian rejected the API key' });
	});

	it('retries when the server is down', async () => {
		const e = await deliver(
			{ recordedAt: at('2026-10-27', '06:00') },
			{ url: 'http://127.0.0.1:27199/mcp/' }
		).catch((e) => e);
		expect(e).toBeInstanceOf(DeliverError);
		expect(e.retryable).toBe(true);
		expect(e.message).toContain('ECONNREFUSED');
	});

	it('reports a test summary', async () => {
		const line = await obsidian.test(config());
		expect(line).toMatch(/^Connected, \d+ tools, \d+ entr(y|ies) at the vault root$/);
	});

	it.skipIf(!httpsUrl)('talks to a self-signed HTTPS server with insecure TLS', async () => {
		expect(await obsidian.test(config({ url: httpsUrl, insecureTls: true }))).toMatch(/^Connected/);
		await deliver(
			{ recordedAt: at('2026-10-28', '07:00'), transcript: 'Over TLS' },
			{ url: httpsUrl, insecureTls: true }
		);
		expect(await read(daily('2026-10-28'))).toContain('- 07:00 Over TLS');
		const e = await obsidian.test(config({ url: httpsUrl, insecureTls: false })).catch((e) => e);
		expect(e).toMatchObject({ retryable: false });
		expect(e.message).toContain('insecure TLS');
	});
});

describe.skipIf(!url || !vault || !dbUrl)('pipeline live', async () => {
	const { runMigrations, db } = await import('../db/index.ts');
	const { recordings, deliveries, integrations } = await import('../db/schema.ts');
	const { setStored } = await import('../settings.ts');
	const { saveIntegration, listIntegrationsForUI, deleteIntegration } = await import('./index.ts');
	const pipeline = await import('../pipeline.ts');
	const { TranscribeError } = await import('../transcribe/types.ts');
	const { eq } = await import('drizzle-orm');

	const created: string[] = [];
	const transcribeCalls: string[] = [];
	let integrationId = '';

	async function insert(over: Partial<typeof recordings.$inferInsert>) {
		const [row] = await db
			.insert(recordings)
			.values({
				deliveryId: `live-${crypto.randomUUID()}`,
				source: 'ring',
				trigger: 'single-click-hold',
				recordedAt: at('2026-11-01', '09:00'),
				...over
			})
			.returning();
		created.push(row!.id);
		return row!;
	}

	async function settle(id: string) {
		for (let i = 0; i < 200; i++) {
			await pipeline.whenIdle();
			const [row] = await db.select().from(recordings).where(eq(recordings.id, id));
			if (row && (row.status === 'done' || row.status === 'failed') && !pipeline.isProcessing(id)) {
				const ds = await db.select().from(deliveries).where(eq(deliveries.recordingId, id));
				return { row, ds };
			}
			await new Promise((r) => setTimeout(r, 50));
		}
		throw new Error(`recording ${id} did not settle`);
	}

	beforeAll(async () => {
		await runMigrations();
		// Leftovers from earlier runs in this test database must not be resumed
		await db.delete(recordings);
		await db.delete(integrations);
		await setStored('general', general);
		pipeline._setPipelineDeps({
			sleep: async () => {},
			transcribe: async (input) => {
				transcribeCalls.push(input.path);
				await new Promise((r) => setTimeout(r, 50));
				if (input.path.endsWith('bad-key.m4a')) throw new TranscribeError('Invalid API key', false);
				if (
					input.path.endsWith('flaky.m4a') &&
					transcribeCalls.filter((p) => p === input.path).length < 3
				) {
					throw new TranscribeError('503 from provider', true);
				}
				return {
					text: 'Habari, the meeting moved\nto Thursday',
					languages: ['sw', 'en'],
					by: 'fake:model'
				};
			}
		});
		const saved = await saveIntegration({
			kind: 'obsidian',
			name: 'Test vault',
			enabled: true,
			triggers: [],
			config: config({ notePath: `${run}/Pipeline/{{date:YYYY-MM-DD}}.md` })
		});
		integrationId = saved.id;
	});

	afterAll(async () => {
		if (created.length)
			for (const id of created) await db.delete(recordings).where(eq(recordings.id, id));
		if (integrationId) await deleteIntegration(integrationId);
	});

	it('stores the API key encrypted and hides it from the UI list', async () => {
		const [row] = await db.select().from(integrations).where(eq(integrations.id, integrationId));
		expect(String(row!.config.apiKey)).toMatch(/^enc:v1:/);
		const [view] = await listIntegrationsForUI();
		expect(view!.config.apiKey).toBe('');
		expect(view!.secretsSet).toEqual({ apiKey: true });
		// A blank key on save keeps the stored one
		const again = await saveIntegration({
			id: integrationId,
			kind: 'obsidian',
			name: 'Test vault',
			enabled: true,
			triggers: [],
			config: { ...config({ notePath: `${run}/Pipeline/{{date:YYYY-MM-DD}}.md` }), apiKey: '' }
		});
		expect(again.config.apiKey).toBe(key);
	});

	it('resumes an app transcript only recording on start and delivers it', async () => {
		const rec = await insert({ appTranscript: 'Kumbuka kununua mkate' });
		pipeline.startWorker();
		const { row, ds } = await settle(rec.id);
		expect(row).toMatchObject({
			status: 'done',
			transcript: 'Kumbuka kununua mkate',
			transcribedBy: 'index-app',
			error: null
		});
		expect(ds).toHaveLength(1);
		expect(ds[0]).toMatchObject({
			status: 'sent',
			target: `${run}/Pipeline/2026-11-01.md`,
			attempts: 1
		});
		expect(await read(`${run}/Pipeline/2026-11-01.md`)).toContain('- 09:00 Kumbuka kununua mkate');
	});

	it('transcribes audio, processes each id once, and saves languages', async () => {
		const rec = await insert({
			audioPath: 'audio/ok.m4a',
			audioMime: 'audio/mp4',
			recordedAt: at('2026-11-02', '14:20')
		});
		const changes: string[] = [];
		const off = pipeline.onChange((id) => id === rec.id && changes.push(id));
		pipeline.enqueue(rec.id);
		pipeline.enqueue(rec.id);
		const { row, ds } = await settle(rec.id);
		off();
		expect(transcribeCalls.filter((p) => p.endsWith('ok.m4a'))).toHaveLength(1);
		expect(row).toMatchObject({
			status: 'done',
			languages: 'sw,en',
			transcribedBy: 'fake:model',
			attempts: 1
		});
		expect(row.transcribeMs).toBeGreaterThanOrEqual(40);
		expect(ds[0]!.status).toBe('sent');
		expect(changes.length).toBeGreaterThan(3);
		expect(await read(`${run}/Pipeline/2026-11-02.md`)).toContain(
			'- 14:20 Habari, the meeting moved\n  to Thursday'
		);
	});

	it('retries retryable transcription errors', async () => {
		const rec = await insert({
			audioPath: 'audio/flaky.m4a',
			recordedAt: at('2026-11-03', '08:00')
		});
		pipeline.enqueue(rec.id);
		const { row } = await settle(rec.id);
		expect(row).toMatchObject({ status: 'done', attempts: 3, transcribedBy: 'fake:model' });
	});

	it('falls back to the app transcript on a final transcription error', async () => {
		const rec = await insert({
			audioPath: 'audio/bad-key.m4a',
			appTranscript: 'From the phone',
			recordedAt: at('2026-11-04', '08:00')
		});
		pipeline.enqueue(rec.id);
		const { row, ds } = await settle(rec.id);
		expect(row).toMatchObject({
			status: 'done',
			transcript: 'From the phone',
			transcribedBy: 'index-app',
			attempts: 1
		});
		expect(row.error).toBe('Used the app transcript: Invalid API key');
		expect(ds[0]!.status).toBe('sent');
	});

	it('fails without a fallback', async () => {
		const rec = await insert({
			audioPath: 'audio/bad-key.m4a',
			recordedAt: at('2026-11-05', '08:00')
		});
		pipeline.enqueue(rec.id);
		const { row, ds } = await settle(rec.id);
		expect(row).toMatchObject({ status: 'failed', error: 'Transcription failed: Invalid API key' });
		expect(ds).toHaveLength(0);
	});

	it('marks a failed delivery, then redelivers after the key is fixed', async () => {
		const base = config({ notePath: `${run}/Pipeline/{{date:YYYY-MM-DD}}.md` });
		await saveIntegration({
			id: integrationId,
			kind: 'obsidian',
			name: 'Test vault',
			enabled: true,
			triggers: [],
			config: { ...base, apiKey: 'wrong' }
		});
		const rec = await insert({ appTranscript: 'Retry me', recordedAt: at('2026-11-06', '08:00') });
		pipeline.enqueue(rec.id);
		let { row, ds } = await settle(rec.id);
		expect(row).toMatchObject({ status: 'failed', error: '1 of 1 delivery failed' });
		expect(ds[0]).toMatchObject({
			status: 'failed',
			attempts: 1,
			error: 'Obsidian rejected the API key'
		});

		await saveIntegration({
			id: integrationId,
			kind: 'obsidian',
			name: 'Test vault',
			enabled: true,
			triggers: [],
			config: base
		});
		await pipeline.redeliver(ds[0]!.id);
		({ row, ds } = await settle(rec.id));
		expect(row).toMatchObject({ status: 'done', error: null });
		expect(ds[0]).toMatchObject({ status: 'sent', attempts: 2 });
		expect(await read(`${run}/Pipeline/2026-11-06.md`)).toContain('- 08:00 Retry me');
	});

	it('retries a server that is down, then gives up', async () => {
		const base = config({ notePath: `${run}/Pipeline/{{date:YYYY-MM-DD}}.md` });
		await saveIntegration({
			id: integrationId,
			kind: 'obsidian',
			name: 'Test vault',
			enabled: true,
			triggers: [],
			config: { ...base, url: 'http://127.0.0.1:27199/mcp/' }
		});
		const rec = await insert({
			appTranscript: 'Nobody home',
			recordedAt: at('2026-11-07', '08:00')
		});
		pipeline.enqueue(rec.id);
		let { row, ds } = await settle(rec.id);
		expect(row.status).toBe('failed');
		expect(ds[0]).toMatchObject({ status: 'failed', attempts: 4 });

		await saveIntegration({
			id: integrationId,
			kind: 'obsidian',
			name: 'Test vault',
			enabled: true,
			triggers: [],
			config: base
		});
		await pipeline.retryRecording(rec.id, 'route');
		await expect(pipeline.retryRecording(rec.id, 'route')).rejects.toThrow('still processing');
		({ row, ds } = await settle(rec.id));
		expect(row.status).toBe('done');
		expect(ds[0]!.status).toBe('sent');
	});

	it('skips integrations that do not take the trigger', async () => {
		await saveIntegration({
			id: integrationId,
			kind: 'obsidian',
			name: 'Test vault',
			enabled: true,
			triggers: ['double-click-hold'],
			config: config({ notePath: `${run}/Pipeline/{{date:YYYY-MM-DD}}.md` })
		});
		const rec = await insert({
			appTranscript: 'Single click',
			recordedAt: at('2026-11-08', '08:00')
		});
		pipeline.enqueue(rec.id);
		const { row, ds } = await settle(rec.id);
		expect(row.status).toBe('done');
		expect(ds).toHaveLength(0);
	});
});
