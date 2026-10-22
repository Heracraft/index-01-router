// Audio lives under DATA_DIR/audio/YYYY/MM/<recordingId>.<ext>; the DB stores the relative path.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { DATA_DIR, FFPROBE_PATH } from '$app/env/private';

const run = promisify(execFile);

const EXTENSIONS: Record<string, string> = {
	'audio/mp4': 'm4a',
	'audio/m4a': 'm4a',
	'audio/x-m4a': 'm4a',
	'audio/aac': 'aac',
	'audio/mpeg': 'mp3',
	'audio/mp3': 'mp3',
	'audio/wav': 'wav',
	'audio/wave': 'wav',
	'audio/x-wav': 'wav',
	'audio/ogg': 'ogg',
	'audio/opus': 'opus',
	'audio/webm': 'webm',
	'audio/flac': 'flac',
	'audio/x-flac': 'flac',
	'video/mp4': 'mp4',
	'video/webm': 'webm'
};

/** File extension for a MIME type. m4a for audio/mp4 (what the ring sends) */
export function audioExtension(mime: string) {
	const base = mime.split(';')[0].trim().toLowerCase();
	if (EXTENSIONS[base]) return EXTENSIONS[base];
	const sub = base.split('/')[1]?.replace(/^x-/, '') ?? '';
	return /^[a-z0-9]{1,8}$/.test(sub) ? sub : 'bin';
}

/** Resolves `relative` inside `root`; throws on absolute paths and anything escaping root */
export function resolveInside(root: string, relative: string) {
	const base = path.resolve(root);
	if (!relative || path.isAbsolute(relative) || relative.includes('\0'))
		throw new Error(`Invalid storage path: ${relative}`);
	const abs = path.resolve(base, relative);
	if (!abs.startsWith(base + path.sep)) throw new Error(`Invalid storage path: ${relative}`);
	return abs;
}

export function absolutePath(relative: string) {
	return resolveInside(DATA_DIR, relative);
}

/** audio/YYYY/MM/<id>.<ext>, year and month in UTC */
export function audioRelativePath(recordingId: string, recordedAt: Date, mime: string) {
	if (!/^[A-Za-z0-9_-]{1,100}$/.test(recordingId)) throw new Error('Invalid recording id');
	const yyyy = String(recordedAt.getUTCFullYear()).padStart(4, '0');
	const mm = String(recordedAt.getUTCMonth() + 1).padStart(2, '0');
	return `audio/${yyyy}/${mm}/${recordingId}.${audioExtension(mime)}`;
}

/** Writes atomically: temp file in the same directory, then rename */
export async function saveAudio(
	recordingId: string,
	recordedAt: Date,
	bytes: Uint8Array,
	mime: string
): Promise<{ path: string; bytes: number }> {
	const rel = audioRelativePath(recordingId, recordedAt, mime);
	const abs = absolutePath(rel);
	await mkdir(path.dirname(abs), { recursive: true });
	const tmp = `${abs}.${randomBytes(6).toString('hex')}.tmp`;
	try {
		await writeFile(tmp, bytes);
		await rename(tmp, abs);
	} catch (e) {
		await rm(tmp, { force: true });
		throw e;
	}
	return { path: rel, bytes: bytes.byteLength };
}

export async function deleteAudio(relative: string) {
	await rm(absolutePath(relative), { force: true });
}

/**
 * Every file under DATA_DIR/audio/YYYY/MM, as relative paths with their modification time.
 * Empty when the audio directory does not exist yet.
 */
export async function listAudioFiles(): Promise<{ path: string; mtimeMs: number }[]> {
	const files: { path: string; mtimeMs: number }[] = [];
	const dirs = async (rel: string, pattern: RegExp) => {
		try {
			const entries = await readdir(absolutePath(rel), { withFileTypes: true });
			return entries.filter((e) => e.isDirectory() && pattern.test(e.name)).map((e) => e.name);
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
			throw e;
		}
	};
	for (const yyyy of await dirs('audio', /^\d{4}$/)) {
		for (const mm of await dirs(`audio/${yyyy}`, /^\d{2}$/)) {
			const dir = `audio/${yyyy}/${mm}`;
			for (const e of await readdir(absolutePath(dir), { withFileTypes: true })) {
				if (!e.isFile()) continue;
				const rel = `${dir}/${e.name}`;
				try {
					files.push({ path: rel, mtimeMs: (await stat(absolutePath(rel))).mtimeMs });
				} catch {
					// Deleted while listing
				}
			}
		}
	}
	return files;
}

/** Container duration via ffprobe. Null when ffprobe is missing or cannot read the file */
export async function probeDurationMs(absPath: string): Promise<number | null> {
	try {
		const { stdout } = await run(
			FFPROBE_PATH,
			['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', absPath],
			{ timeout: 15_000 }
		);
		const seconds = Number.parseFloat(stdout.trim());
		return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null;
	} catch {
		return null;
	}
}
