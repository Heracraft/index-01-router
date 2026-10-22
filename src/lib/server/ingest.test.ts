// Integration test against a real Postgres. Opt in:
//   INGEST_TEST_DATABASE_URL=postgres://root:pebble@localhost:5432/ingest_test pnpm exec vitest run src/lib/server/ingest.test.ts
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const url = process.env.INGEST_TEST_DATABASE_URL;
const root = await mkdtemp(path.join(tmpdir(), 'ingest-test-'));
const enqueued: string[] = [];

vi.mock('$app/env/private', () => ({
	DATABASE_URL: process.env.INGEST_TEST_DATABASE_URL ?? 'postgres://invalid',
	DATA_DIR: root,
	FFPROBE_PATH: 'ffprobe'
}));
vi.mock('./pipeline.ts', () => ({ enqueue: (id: string) => enqueued.push(id) }));

describe.skipIf(!url)('createRecording', async () => {
	const { db, runMigrations } = await import('./db/index.ts');
	const { recordings } = await import('./db/schema.ts');
	const { eq } = await import('drizzle-orm');
	const { createRecording, deleteRecording } = await import('./ingest.ts');
	const audioFiles = async () => {
		const out: string[] = [];
		const walk = async (dir: string): Promise<void> => {
			for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
				const p = path.join(dir, e.name);
				if (e.isDirectory()) await walk(p);
				else out.push(path.relative(root, p));
			}
		};
		await walk(path.join(root, 'audio'));
		return out.sort();
	};
	const m4a = path.join(root, 'in.m4a');

	beforeAll(async () => {
		await runMigrations();
		execFileSync('ffmpeg', [
			...['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=2'],
			...['-ar', '16000', '-ac', '1', '-c:a', 'aac', m4a]
		]);
	});
	afterAll(() => rm(root, { recursive: true, force: true }));

	it('stores audio, probes duration, enqueues, dedupes and deletes', async () => {
		const bytes = new Uint8Array(await readFile(m4a));
		const deliveryId = `vitest-${crypto.randomUUID()}`;
		const input = {
			deliveryId,
			source: 'ring' as const,
			trigger: 'single-click-hold',
			signed: true,
			recordedAt: new Date('2026-03-04T05:06:07Z'),
			audio: { bytes, mime: 'audio/mp4' }
		};
		const first = await createRecording(input);
		expect(first.duplicate).toBe(false);
		const r = first.recording;
		expect(r.audioPath).toBe(`audio/2026/03/${r.id}.m4a`);
		expect(r.audioBytes).toBe(bytes.byteLength);
		expect(r.durationMs).toBeGreaterThan(1900);
		expect(r.durationMs).toBeLessThan(2200);
		expect(enqueued).toContain(r.id);
		expect((await stat(path.join(root, r.audioPath!))).size).toBe(bytes.byteLength);

		const again = await createRecording(input);
		expect(again).toMatchObject({ duplicate: true, recording: { id: r.id } });
		expect(enqueued.filter((id) => id === r.id)).toHaveLength(1);

		expect(await deleteRecording(r.id)).toBe(true);
		await expect(stat(path.join(root, r.audioPath!))).rejects.toThrow();
		expect(await deleteRecording(r.id)).toBe(false);
	});

	it('takes the app transcript as the transcript without audio', async () => {
		const { recording, duplicate } = await createRecording({
			deliveryId: `vitest-text-${crypto.randomUUID()}`,
			source: 'ring',
			trigger: 'double-click-hold',
			signed: false,
			recordedAt: new Date(),
			appTranscript: ' Nimefika nyumbani '
		});
		expect(duplicate).toBe(false);
		expect(recording).toMatchObject({
			audioPath: null,
			appTranscript: 'Nimefika nyumbani',
			transcript: 'Nimefika nyumbani',
			transcribedBy: 'index-app',
			status: 'received'
		});
		await deleteRecording(recording.id);
	});

	const ringInput = (deliveryId: string, bytes: Uint8Array) => ({
		deliveryId,
		source: 'ring' as const,
		trigger: 'single-click-hold',
		signed: true,
		recordedAt: new Date('2026-05-06T07:08:09Z'),
		audio: { bytes, mime: 'audio/mp4' }
	});

	it('leaves no file behind on a duplicate', async () => {
		const bytes = new Uint8Array(await readFile(m4a));
		const input = ringInput(`vitest-dup-${crypto.randomUUID()}`, bytes);
		const first = await createRecording(input);
		const before = await audioFiles();
		const again = await createRecording(input);
		expect(again.duplicate).toBe(true);
		expect(await audioFiles()).toEqual(before);
		await deleteRecording(first.recording.id);
	});

	it('answers concurrent resends with one stored row and one file', async () => {
		const bytes = new Uint8Array(await readFile(m4a));
		const input = ringInput(`vitest-race-${crypto.randomUUID()}`, bytes);
		const before = await audioFiles();
		const results = await Promise.all([createRecording(input), createRecording(input)]);
		expect(results.filter((r) => r.duplicate)).toHaveLength(1);
		const stored = results.find((r) => !r.duplicate)!.recording;
		expect(stored.audioPath).toBeTruthy();
		expect(results.find((r) => r.duplicate)!.recording.audioPath).toBe(stored.audioPath);
		expect((await audioFiles()).filter((f) => !before.includes(f))).toEqual([stored.audioPath]);
		await deleteRecording(stored.id);
	});

	it('deletes the file when the insert fails', async () => {
		const bytes = new Uint8Array(await readFile(m4a));
		const before = await audioFiles();
		// trigger is NOT NULL, so the insert throws after the file is written
		const bad = { ...ringInput(`vitest-fail-${crypto.randomUUID()}`, bytes), trigger: null };
		await expect(createRecording(bad as never)).rejects.toThrow();
		expect(await audioFiles()).toEqual(before);
	});

	it('completes a row left without audio by an older crash, once', async () => {
		const bytes = new Uint8Array(await readFile(m4a));
		const deliveryId = `vitest-incomplete-${crypto.randomUUID()}`;
		const id = crypto.randomUUID();
		await db.insert(recordings).values({
			id,
			deliveryId,
			source: 'ring',
			trigger: 'single-click-hold',
			signed: true,
			recordedAt: new Date('2026-05-06T07:08:09Z'),
			audioMime: 'audio/mp4',
			status: 'failed',
			error: 'Audio was not stored; resend from the Index app'
		});
		const before = await audioFiles();
		const input = ringInput(deliveryId, bytes);
		const results = await Promise.all([createRecording(input), createRecording(input)]);
		const done = results.find((r) => r.completed)!;
		expect(done).toMatchObject({ duplicate: false, completed: true, recording: { id } });
		expect(results.find((r) => r !== done)).toMatchObject({ duplicate: true });
		const [row] = await db.select().from(recordings).where(eq(recordings.id, id));
		expect(row).toMatchObject({ status: 'received', error: null, audioBytes: bytes.byteLength });
		expect(row!.durationMs).toBeGreaterThan(1900);
		expect(enqueued).toContain(id);
		expect((await audioFiles()).filter((f) => !before.includes(f))).toEqual([row!.audioPath]);

		const later = await createRecording(input);
		expect(later).toMatchObject({ duplicate: true, recording: { id } });
		await deleteRecording(id);
	});

	it('sweeps audio files no row points to', async () => {
		vi.doMock('./settings.ts', () => ({ getSettings: vi.fn() }));
		vi.doMock('./transcribe/index.ts', () => ({ transcribe: vi.fn(), TranscribeError: Error }));
		vi.doMock('./integrations/index.ts', () => ({
			integrationMatches: vi.fn(),
			kinds: {},
			listIntegrations: vi.fn()
		}));
		const { sweepOrphanAudio } =
			await vi.importActual<typeof import('./pipeline.ts')>('./pipeline.ts');
		const bytes = new Uint8Array(await readFile(m4a));
		const kept = await createRecording(ringInput(`vitest-sweep-${crypto.randomUUID()}`, bytes));
		const dir = path.join(root, 'audio/2026/05');
		await mkdir(dir, { recursive: true });
		const orphan = path.join(dir, `${crypto.randomUUID()}.m4a`);
		const fresh = path.join(dir, `${crypto.randomUUID()}.m4a`);
		const tmp = path.join(dir, `${crypto.randomUUID()}.m4a.abc.tmp`);
		for (const f of [orphan, fresh, tmp]) await writeFile(f, 'x');
		const old = new Date(Date.now() - 2 * 60 * 60_000);
		for (const f of [orphan, tmp, path.join(root, kept.recording.audioPath!)])
			await utimes(f, old, old);

		const removed = await sweepOrphanAudio();
		expect(removed.sort()).toEqual([orphan, tmp].map((f) => path.relative(root, f)).sort());
		await expect(stat(orphan)).rejects.toThrow();
		await expect(stat(fresh)).resolves.toBeTruthy();
		await expect(stat(path.join(root, kept.recording.audioPath!))).resolves.toBeTruthy();
		await rm(fresh);
		await deleteRecording(kept.recording.id);
	});
});
