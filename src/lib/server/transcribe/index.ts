// Transcription entry point. The audio is decoded once to 16 kHz mono PCM; with chunking on and
// more than 30 s of audio it is cut at pauses into chunks of at most 30 s, each encoded in the
// provider's format and sent with at most 3 requests in flight. Provider modules take settings
// as arguments and import nothing from $app, so plain node scripts and vitest can load them.
import { decodePcm, encodePcm, type DecodeOptions } from './audio.ts';
import {
	findPauses,
	joinTexts,
	planChunks,
	rankLanguages,
	SAMPLE_RATE,
	voicedIn,
	voicedSeconds,
	type Chunk,
	type Span
} from './chunk.ts';
import { isHallucination } from './clean.ts';
import { gemini } from './gemini.ts';
import { openai } from './openai.ts';
import { openaiAudio } from './openai-audio.ts';
import { normalizeLanguages } from './prompt.ts';
import {
	TranscribeError,
	type ChunkReply,
	type Provider,
	type RequestContext,
	type TranscribeInput,
	type TranscribeProvider,
	type TranscribeResult,
	type TranscriptionSettings
} from './types.ts';
import { whisperCpp } from './whisper-cpp.ts';

export { TranscribeError } from './types.ts';
export type { TranscribeInput, TranscribeResult } from './types.ts';

const registry: Record<TranscribeProvider, Provider> = {
	openai,
	'openai-audio': openaiAudio,
	gemini,
	'whisper-cpp': whisperCpp
};

export const PROVIDERS: { id: TranscribeProvider; label: string; defaultModel: string }[] =
	Object.values(registry).map((p) => ({ id: p.id, label: p.label, defaultModel: p.defaultModel }));

/** Chunking applies above this length */
export const CHUNK_SECONDS = 30;
export const CONCURRENCY = 3;
/** Longest recording transcribed. Decoded PCM takes 32 KB per second: 230 MB at this cap */
export const MAX_AUDIO_SECONDS = 2 * 60 * 60;
/** Shorter clips count as no speech */
const MIN_SECONDS = 0.1;

export interface TranscribeDeps {
	fetch?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
	decode?: (path: string, opts?: DecodeOptions) => Promise<Int16Array>;
	encode?: typeof encodePcm;
}

function providerOf(settings: TranscriptionSettings): Provider {
	const p = registry[settings.provider];
	if (!p) throw new TranscribeError(`Unknown transcription provider: ${settings.provider}`, false);
	return p;
}

export function byLabel(p: Provider, settings: TranscriptionSettings) {
	const model = p.model(settings);
	return model ? `${p.id}:${model}` : p.id;
}

/** The whole file as one chunk, or nothing when it holds no voice */
function wholeFile(pauses: Span[], duration: number): Chunk[] {
	const voiced = voicedIn(pauses, 0, duration);
	return voiced.length ? [{ start: 0, end: duration, overlap: false, voiced }] : [];
}

/**
 * The caller's deadline (an AbortSignal.timeout) surfaces as a DOMException. Turned into a
 * TranscribeError that is not retried: starting over would hit the same deadline.
 */
function timedOut(e: unknown): unknown {
	if (e instanceof Error && e.name === 'TimeoutError' && !(e instanceof TranscribeError))
		return new TranscribeError('Transcription ran past its time limit', false);
	return e;
}

/** Run `fn` over items with at most `n` in flight. Stops taking new items after a failure */
async function pool<T, R>(
	items: T[],
	n: number,
	fn: (x: T, i: number) => Promise<R>
): Promise<R[]> {
	const out = new Array<R>(items.length);
	let next = 0;
	let failed = false;
	const worker = async () => {
		while (!failed && next < items.length) {
			const i = next++;
			try {
				out[i] = await fn(items[i]!, i);
			} catch (e) {
				failed = true;
				throw e;
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
	return out;
}

export async function transcribe(
	input: TranscribeInput,
	deps: TranscribeDeps = {}
): Promise<TranscribeResult> {
	const { settings } = input;
	const provider = providerOf(settings);
	const by = byLabel(provider, settings);
	const decode = deps.decode ?? decodePcm;
	const encode = deps.encode ?? encodePcm;
	input.signal?.throwIfAborted();

	const tooLong = () =>
		new TranscribeError(`Recording longer than ${MAX_AUDIO_SECONDS / 3600} h`, false);
	if (input.durationMs != null && input.durationMs > MAX_AUDIO_SECONDS * 1000) throw tooLong();
	const pcm = await decode(input.path, {
		expectedSeconds: input.durationMs ? input.durationMs / 1000 : undefined,
		// One second past the cap tells an over-length file from one exactly at it
		maxSeconds: MAX_AUDIO_SECONDS + 1
	});
	const duration = pcm.length / SAMPLE_RATE;
	// Nothing decoded points to a broken file; a clip too short for a word is just no speech
	if (pcm.length === 0) throw new TranscribeError('The file holds no audio', false);
	if (duration > MAX_AUDIO_SECONDS) throw tooLong();
	if (duration < MIN_SECONDS) return { text: '', languages: [], by };
	const { pauses } = findPauses(pcm);

	// Sibling requests stop once one fails for good
	const controller = new AbortController();
	const onAbort = () => controller.abort(input.signal!.reason);
	input.signal?.addEventListener('abort', onAbort, { once: true });
	const ctx: RequestContext = {
		signal: controller.signal,
		fetch: deps.fetch ?? fetch,
		sleep: deps.sleep
	};

	try {
		let chunks =
			settings.chunking && duration > CHUNK_SECONDS
				? planChunks(pauses, duration, CHUNK_SECONDS)
				: wholeFile(pauses, duration);
		const whole = chunks.length === 1 && chunks[0]!.start === 0 && chunks[0]!.end === duration;
		let wholeUpload = whole ? await encode(pcm, provider.format) : null;
		if (wholeUpload && wholeUpload.bytes.byteLength > provider.maxBytes) {
			// Too big for one request: chunk regardless of the setting
			chunks = planChunks(pauses, duration, CHUNK_SECONDS);
			wholeUpload = null;
		}
		if (!chunks.length) return { text: '', languages: [], by };

		const replies = await pool(
			chunks,
			provider.concurrency ?? CONCURRENCY,
			async (c): Promise<ChunkReply> => {
				const upload = wholeUpload ?? (await encode(pcm, provider.format, c.start, c.end));
				try {
					const r = await provider.transcribe(upload, settings, ctx);
					// A noise chunk must not leak an invented phrase or the language guessed for it
					if (!r.text.trim() || isHallucination(r)) return { text: '', languages: [] };
					return { text: r.text, languages: normalizeLanguages(r.languages) };
				} catch (e) {
					if (!controller.signal.aborted) controller.abort(e);
					throw timedOut(e);
				}
			}
		);

		return {
			text: joinTexts(replies.map((r, i) => ({ text: r.text, overlap: chunks[i]!.overlap }))),
			languages: rankLanguages(
				replies.map((r, i) => ({ languages: r.languages, seconds: voicedSeconds(chunks[i]!) }))
			),
			by
		};
	} catch (e) {
		throw timedOut(e);
	} finally {
		input.signal?.removeEventListener('abort', onAbort);
	}
}

/** A cheap request that checks the key, the endpoint and the model. One line for the UI */
export async function testTranscription(
	settings: TranscriptionSettings,
	deps: Pick<TranscribeDeps, 'fetch'> & { signal?: AbortSignal } = {}
): Promise<string> {
	return providerOf(settings).test(settings, { fetch: deps.fetch ?? fetch, signal: deps.signal });
}
