import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const root = await mkdtemp(path.join(tmpdir(), 'storage-test-'));
vi.mock('$app/env/private', () => ({ DATA_DIR: root, FFPROBE_PATH: 'ffprobe' }));

const storage = await import('./storage.ts');

afterAll(() => rm(root, { recursive: true, force: true }));

describe('storage', () => {
	it('maps mime types to extensions', () => {
		expect(storage.audioExtension('audio/mp4')).toBe('m4a');
		expect(storage.audioExtension('audio/mpeg; charset=x')).toBe('mp3');
		expect(storage.audioExtension('audio/x-wav')).toBe('wav');
		expect(storage.audioExtension('audio/x-caf')).toBe('caf');
		expect(storage.audioExtension('application/octet-stream')).toBe('bin');
		expect(storage.audioExtension('')).toBe('bin');
	});

	it('rejects path traversal', () => {
		for (const bad of ['../x', 'audio/../../x', '/etc/passwd', '', '.', 'a\0b']) {
			expect(() => storage.absolutePath(bad), bad).toThrow();
		}
		expect(storage.absolutePath('audio/2026/10/a.m4a')).toBe(
			path.join(root, 'audio/2026/10/a.m4a')
		);
	});

	it('saves under audio/YYYY/MM and deletes', async () => {
		const bytes = new Uint8Array([1, 2, 3]);
		const at = new Date('2026-01-31T23:30:00Z');
		const saved = await storage.saveAudio('abc-123', at, bytes, 'audio/mp4');
		expect(saved).toEqual({ path: 'audio/2026/01/abc-123.m4a', bytes: 3 });
		const abs = storage.absolutePath(saved.path);
		expect(new Uint8Array(await readFile(abs))).toEqual(bytes);
		expect(await readdir(path.dirname(abs))).toEqual(['abc-123.m4a']);
		await storage.deleteAudio(saved.path);
		expect(await readdir(path.dirname(abs))).toEqual([]);
		await storage.deleteAudio(saved.path);
	});

	it('rejects odd recording ids', async () => {
		await expect(
			storage.saveAudio('../x', new Date(), new Uint8Array(1), 'audio/mp4')
		).rejects.toThrow();
	});

	it('returns null duration for unreadable files', async () => {
		expect(await storage.probeDurationMs(path.join(root, 'missing.m4a'))).toBeNull();
	});
});
