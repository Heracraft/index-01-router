// The transcription page's Test: a 7 s clip of mixed English and Swahili, sent through the same
// transcribe() path recordings take, with the settings on the form. Vite inlines the clip, so it
// ships inside the server bundle. Not imported by transcribe/index.ts, which plain node scripts
// load without Vite.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import clip from './probe.m4a?inline';
import { transcribe, type TranscribeDeps } from './index.ts';
import type { TranscriptionSettings } from './types.ts';

/** Length of probe.m4a, cut from tests/fixtures/audio/code-switched-en-sw-es.m4a (segment 4) */
export const PROBE_MS = 7400;

export interface ProbeResult {
	/** Wall time of the transcription */
	ms: number;
	text: string;
	languages: string[];
}

export async function probeTranscription(
	settings: TranscriptionSettings,
	opts: { signal?: AbortSignal } & Pick<TranscribeDeps, 'fetch'> = {}
): Promise<ProbeResult> {
	const bytes = Buffer.from(clip.slice(clip.indexOf(',') + 1), 'base64');
	const dir = await mkdtemp(path.join(tmpdir(), 'index01-probe-'));
	const file = path.join(dir, 'probe.m4a');
	try {
		await writeFile(file, bytes);
		const started = performance.now();
		const r = await transcribe(
			{ path: file, mime: 'audio/mp4', durationMs: PROBE_MS, settings, signal: opts.signal },
			{ fetch: opts.fetch }
		);
		return { ms: Math.round(performance.now() - started), text: r.text, languages: r.languages };
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
