// ffmpeg steps: decode any audio file to 16 kHz mono PCM once, then encode the whole file or a
// slice of it in the container the provider wants. Cutting from PCM keeps chunk offsets exact.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FFMPEG_PATH } from '$app/env/private';
import { SAMPLE_RATE } from './chunk.ts';
import { TranscribeError, type Upload, type UploadFormat } from './types.ts';

/** Runs ffmpeg, handing each stdout chunk to `onData`. Rejects with a TranscribeError */
function runFfmpeg(
	args: string[],
	stdin: Uint8Array | null,
	onData: (d: Buffer) => void,
	timeoutMs = 5 * 60_000
): Promise<void> {
	return new Promise((resolve, reject) => {
		const p = spawn(FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], {
			stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe']
		});
		let err = '';
		p.stdout!.on('data', onData);
		p.stderr!.on('data', (d) => {
			err += d;
			if (err.length > 16_000) err = err.slice(-8000);
		});
		const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
		p.on('error', (e) => {
			clearTimeout(timer);
			reject(new TranscribeError(`Could not run ffmpeg (${e.message})`, false));
		});
		p.on('close', (code) => {
			clearTimeout(timer);
			if (code === 0) return resolve();
			if (/Invalid data found|could not find codec parameters|moov atom not found/i.test(err)) {
				return reject(new TranscribeError('The file is not audio ffmpeg can read', false));
			}
			// Last lines, without file paths
			const last = err.trim().split('\n').slice(-2).join(' | ').replace(/\/\S+/g, '<file>');
			reject(new TranscribeError(`ffmpeg failed (${code ?? 'killed'}): ${last}`, false));
		});
		if (stdin && p.stdin) {
			p.stdin.on('error', () => {});
			p.stdin.end(Buffer.from(stdin.buffer, stdin.byteOffset, stdin.byteLength));
		}
	});
}

export interface DecodeOptions {
	/** Expected length, to size the buffer once. Default 10 minutes */
	expectedSeconds?: number;
	/** ffmpeg stops after this many seconds */
	maxSeconds?: number;
}

/**
 * Any audio or video file to 16 kHz mono signed 16-bit PCM. Samples stream into one buffer sized
 * from the expected length (doubled when it runs out), so peak memory stays near one copy of
 * the PCM: 32 KB per second of audio.
 */
export async function decodePcm(path: string, opts: DecodeOptions = {}): Promise<Int16Array> {
	const expected = opts.expectedSeconds && opts.expectedSeconds > 0 ? opts.expectedSeconds : 600;
	let buf = new Uint8Array(Math.ceil(expected * SAMPLE_RATE * 1.02) * 2);
	let offset = 0;
	const limit = opts.maxSeconds ? ['-t', String(opts.maxSeconds)] : [];
	await runFfmpeg(
		['-i', path, '-vn', ...limit, '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', 'pipe:1'],
		null,
		(d) => {
			if (offset + d.byteLength > buf.byteLength) {
				let size = buf.byteLength * 2;
				while (size < offset + d.byteLength) size *= 2;
				const next = new Uint8Array(size);
				next.set(buf.subarray(0, offset));
				buf = next;
			}
			buf.set(d, offset);
			offset += d.byteLength;
		}
	);
	// An odd trailing byte is half a sample; the view leaves it out
	return new Int16Array(buf.buffer, 0, offset >> 1);
}

const codecs: Record<UploadFormat, { args: string[]; mime: string; ext: string }> = {
	// About 120 KB per 30 s
	webm: { args: ['-c:a', 'libopus', '-b:a', '32k'], mime: 'audio/webm', ext: 'webm' },
	// 32 KB/s, lossless
	wav: { args: ['-c:a', 'pcm_s16le'], mime: 'audio/wav', ext: 'wav' },
	mp3: { args: ['-c:a', 'libmp3lame', '-b:a', '48k'], mime: 'audio/mpeg', ext: 'mp3' }
};

/** Seconds [a, b) of the PCM in `format`. Written to a temp file so muxers can fix headers */
export async function encodePcm(
	pcm: Int16Array,
	format: UploadFormat,
	a = 0,
	b = pcm.length / SAMPLE_RATE
): Promise<Upload> {
	const i = Math.max(0, Math.floor(a * SAMPLE_RATE));
	const j = Math.min(pcm.length, Math.ceil(b * SAMPLE_RATE));
	const slice = pcm.subarray(i, j);
	const bytes = new Uint8Array(slice.buffer, slice.byteOffset, slice.byteLength);
	const c = codecs[format];
	const dir = await mkdtemp(join(tmpdir(), 'index01-stt-'));
	try {
		const out = join(dir, `chunk.${c.ext}`);
		const input = ['-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1', '-i', 'pipe:0'];
		await runFfmpeg([...input, ...c.args, '-y', out], bytes, () => {});
		return { bytes: new Uint8Array(await readFile(out)), mime: c.mime, name: `audio.${c.ext}` };
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
