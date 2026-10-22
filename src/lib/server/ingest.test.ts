// Integration test against a real Postgres. Opt in:
//   INGEST_TEST_DATABASE_URL=postgres://root:pebble@localhost:5432/ingest_test pnpm exec vitest run src/lib/server/ingest.test.ts
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
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
	const { runMigrations } = await import('./db/index.ts');
	const { createRecording, deleteRecording } = await import('./ingest.ts');
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
});
