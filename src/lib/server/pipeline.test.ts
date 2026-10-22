// transcribeBudgetMs runs always. The deadline test needs a real Postgres. Opt in:
//   PIPELINE_TEST_DATABASE_URL=postgres://root:pebble@localhost:5432/pipeline_test \
//     pnpm exec vitest run src/lib/server/pipeline.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const dbUrl = process.env.PIPELINE_TEST_DATABASE_URL;

vi.mock('$app/env/private', () => ({
	DATABASE_URL: process.env.PIPELINE_TEST_DATABASE_URL ?? 'postgres://invalid',
	AUTH_SECRET: 'pipeline-test-secret-pipeline-test-0123',
	AUTH_SECRET_PREVIOUS: [],
	DATA_DIR: '/nonexistent',
	FFPROBE_PATH: 'ffprobe',
	FFMPEG_PATH: 'ffmpeg',
	INDEX01_WEBHOOK_SECRET: undefined,
	OPENAI_API_KEY: undefined,
	OBSIDIAN_MCP_URL: undefined,
	OBSIDIAN_API_KEY: undefined,
	TZ: 'UTC'
}));

const { transcribeBudgetMs } = await import('./pipeline.ts');
const { MAX_AUDIO_SECONDS } = await import('./transcribe/index.ts');

describe('transcribeBudgetMs', () => {
	const min = 60_000;
	it('gives short recordings 15 minutes', () => {
		expect(transcribeBudgetMs({ durationMs: 30_000, audioBytes: 1 }, 'openai')).toBe(15 * min);
		expect(transcribeBudgetMs({ durationMs: null, audioBytes: null }, 'openai-audio')).toBe(
			15 * min
		);
	});

	it('scales with length, three times for whisper.cpp', () => {
		expect(transcribeBudgetMs({ durationMs: 60 * min, audioBytes: 0 }, 'openai')).toBe(60 * min);
		expect(transcribeBudgetMs({ durationMs: 60 * min, audioBytes: 0 }, 'whisper-cpp')).toBe(
			180 * min
		);
	});

	it('estimates from the file size without a duration, and caps', () => {
		// 16 KB per second: 57.6 MB is an hour
		expect(transcribeBudgetMs({ durationMs: null, audioBytes: 57_600_000 }, 'openai')).toBe(
			60 * min
		);
		expect(transcribeBudgetMs({ durationMs: 10 * 60 * min, audioBytes: 0 }, 'whisper-cpp')).toBe(
			MAX_AUDIO_SECONDS * 3 * 1000
		);
	});
});

describe.skipIf(!dbUrl)('transcription deadline', async () => {
	const { runMigrations, db } = await import('./db/index.ts');
	const { recordings } = await import('./db/schema.ts');
	const { eq } = await import('drizzle-orm');
	const pipeline = await import('./pipeline.ts');
	const created: string[] = [];
	let calls = 0;

	beforeAll(async () => {
		await runMigrations();
		pipeline._setPipelineDeps({
			sleep: async () => {},
			deadline: () => AbortSignal.timeout(30),
			transcribe: (input) => {
				calls++;
				return new Promise((_resolve, reject) => {
					input.signal!.addEventListener('abort', () => reject(input.signal!.reason));
				});
			}
		});
	});

	afterAll(async () => {
		for (const id of created) await db.delete(recordings).where(eq(recordings.id, id));
	});

	it('fails once with a clear message instead of starting over', async () => {
		const [rec] = await db
			.insert(recordings)
			.values({
				deliveryId: `vitest-${crypto.randomUUID()}`,
				source: 'upload',
				trigger: 'upload',
				recordedAt: new Date(),
				audioPath: 'audio/long.m4a',
				audioMime: 'audio/mp4',
				audioBytes: 1000,
				durationMs: 60_000
			})
			.returning();
		created.push(rec!.id);
		pipeline.enqueue(rec!.id);
		await pipeline.whenIdle();
		const [row] = await db.select().from(recordings).where(eq(recordings.id, rec!.id));
		expect(calls).toBe(1);
		expect(row).toMatchObject({
			status: 'failed',
			attempts: 1,
			error: 'Transcription failed: Transcription took longer than 15 min'
		});
	});
});

describe.skipIf(!dbUrl)('delivering an already transcribed recording', async () => {
	const { runMigrations, db } = await import('./db/index.ts');
	const { deliveries, integrations, recordings } = await import('./db/schema.ts');
	const { eq } = await import('drizzle-orm');
	const { kinds } = await import('./integrations/index.ts');
	const pipeline = await import('./pipeline.ts');
	let transcribed = 0;
	const delivered: string[] = [];
	const recs: string[] = [];
	const ints: string[] = [];

	beforeAll(async () => {
		await runMigrations();
		// Only this suite's integrations match
		await db.update(integrations).set({ enabled: false });
		pipeline._setPipelineDeps({
			sleep: async () => {},
			transcribe: async () => {
				transcribed++;
				throw new Error('no transcription expected');
			}
		});
		vi.spyOn(kinds.obsidian, 'deliver').mockImplementation(async ({ recording }) => {
			delivered.push(recording.id);
			return { target: `Daily/${recording.id}.md` };
		});
	});

	afterAll(async () => {
		vi.restoreAllMocks();
		for (const id of recs) await db.delete(recordings).where(eq(recordings.id, id));
		for (const id of ints) await db.delete(integrations).where(eq(integrations.id, id));
	});

	async function transcribedRecording() {
		const [rec] = await db
			.insert(recordings)
			.values({
				deliveryId: `vitest-${crypto.randomUUID()}`,
				source: 'upload',
				trigger: 'upload',
				recordedAt: new Date(),
				transcript: 'Habari, meeting at noon',
				status: 'routing'
			})
			.returning();
		recs.push(rec!.id);
		return rec!;
	}

	async function integration(enabled = true) {
		const [row] = await db
			.insert(integrations)
			.values({ kind: 'obsidian', name: 'Vitest vault', enabled, config: {} })
			.returning();
		ints.push(row!.id);
		return row!;
	}

	const deliveriesOf = (id: string) =>
		db.select().from(deliveries).where(eq(deliveries.recordingId, id));

	it('delivers to an integration added after the recording, without transcribing', async () => {
		const rec = await transcribedRecording();
		pipeline.enqueue(rec.id);
		await pipeline.whenIdle();
		expect(await deliveriesOf(rec.id)).toEqual([]);

		const int = await integration();
		await pipeline.retryRecording(rec.id, 'route');
		await pipeline.whenIdle();
		const rows = await deliveriesOf(rec.id);
		expect(rows).toEqual([
			expect.objectContaining({ integrationId: int.id, status: 'sent', attempts: 1 })
		]);
		expect(transcribed).toBe(0);
		expect(delivered).toEqual([rec.id]);
		const [after] = await db.select().from(recordings).where(eq(recordings.id, rec.id));
		expect(after!.status).toBe('done');
	});

	it('delivers a row skipped while its integration was off once it is back on', async () => {
		await db.update(integrations).set({ enabled: false });
		const int = await integration();
		const rec = await transcribedRecording();
		// A delivery that was pending when the integration got switched off
		await db.insert(deliveries).values({ recordingId: rec.id, integrationId: int.id });
		await db.update(integrations).set({ enabled: false }).where(eq(integrations.id, int.id));
		pipeline.enqueue(rec.id);
		await pipeline.whenIdle();
		expect(await deliveriesOf(rec.id)).toEqual([expect.objectContaining({ status: 'skipped' })]);

		// An automatic pass leaves it skipped
		await db.update(integrations).set({ enabled: true }).where(eq(integrations.id, int.id));
		await db.update(recordings).set({ status: 'routing' }).where(eq(recordings.id, rec.id));
		pipeline.enqueue(rec.id);
		await pipeline.whenIdle();
		expect(await deliveriesOf(rec.id)).toEqual([expect.objectContaining({ status: 'skipped' })]);

		await pipeline.retryRecording(rec.id, 'route');
		await pipeline.whenIdle();
		expect(await deliveriesOf(rec.id)).toEqual([
			expect.objectContaining({ status: 'sent', target: `Daily/${rec.id}.md` })
		]);
		expect(transcribed).toBe(0);
	});

	it('leaves sent rows alone, so a second Deliver adds no duplicate note', async () => {
		await db.update(integrations).set({ enabled: false });
		await integration();
		const rec = await transcribedRecording();
		pipeline.enqueue(rec.id);
		await pipeline.whenIdle();
		const before = delivered.filter((id) => id === rec.id).length;
		expect(before).toBe(1);
		await pipeline.retryRecording(rec.id, 'route');
		await pipeline.whenIdle();
		expect(delivered.filter((id) => id === rec.id).length).toBe(before);
	});
});

describe.skipIf(!dbUrl)('stopping for a shutdown', async () => {
	const { runMigrations, db } = await import('./db/index.ts');
	const { recordings } = await import('./db/schema.ts');
	const { eq } = await import('drizzle-orm');
	const pipeline = await import('./pipeline.ts');
	const created: string[] = [];
	const started: string[] = [];
	const release: (() => void)[] = [];
	let blocking = true;

	beforeAll(async () => {
		await runMigrations();
		pipeline._setPipelineDeps({
			sleep: async () => {},
			deadline: () => new AbortController().signal,
			transcribe: (input) => {
				const result = { text: '', languages: [], by: 'test' };
				if (!blocking) return Promise.resolve(result);
				started.push(input.path);
				return new Promise((resolve) => release.push(() => resolve(result)));
			}
		});
	});

	afterAll(async () => {
		// The queued third job runs now and finishes at once, so later suites start idle
		blocking = false;
		pipeline._resumeAccepting();
		await pipeline.whenIdle();
		for (const id of created) await db.delete(recordings).where(eq(recordings.id, id));
	});

	it('finishes running jobs, leaves queued ones received, and tells listeners', async () => {
		const rows = await db
			.insert(recordings)
			.values(
				[1, 2, 3].map((n) => ({
					deliveryId: `vitest-${crypto.randomUUID()}`,
					source: 'upload' as const,
					trigger: 'upload' as const,
					recordedAt: new Date(),
					audioPath: `audio/stop-${n}.m4a`,
					audioMime: 'audio/mp4'
				}))
			)
			.returning();
		created.push(...rows.map((r) => r.id));
		for (const r of rows) pipeline.enqueue(r.id);
		await expect.poll(() => started.length).toBe(2);

		let notified = 0;
		pipeline.onShutdown(() => notified++);
		pipeline.stopAccepting();
		expect(notified).toBe(1);
		let late = 0;
		pipeline.onShutdown(() => late++);
		expect(late).toBe(1);

		let idle = false;
		const done = pipeline.whenIdle().then(() => (idle = true));
		await new Promise((r) => setTimeout(r, 20));
		expect(idle).toBe(false);
		for (const r of release.splice(0)) r();
		await done;

		expect(started).toHaveLength(2);
		const [third] = await db.select().from(recordings).where(eq(recordings.id, rows[2]!.id));
		expect(third!.status).toBe('received');
	});
});
