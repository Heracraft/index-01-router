import { describe, expect, it } from 'vitest';
import { SAMPLE_RATE } from './chunk.ts';
import {
	MAX_AUDIO_SECONDS,
	PROVIDERS,
	testTranscription,
	transcribe,
	type TranscribeDeps
} from './index.ts';
import type { TranscriptionSettings, UploadFormat } from './types.ts';

function settings(over: Partial<TranscriptionSettings> = {}): TranscriptionSettings {
	return {
		provider: 'openai',
		openai: { baseUrl: 'https://api.openai.com/v1/', apiKey: 'sk-test', model: 'gpt-transcribe' },
		openaiAudio: { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-audio' },
		gemini: { apiKey: 'g-test', model: 'gemini-3.8-flash' },
		whisperCpp: { url: 'http://whisper:8080' },
		languages: [],
		prompt: '',
		chunking: true,
		...over
	};
}

type Call = { url: string; init: RequestInit };

/** fetch that answers from a list, recording each call */
function fakeFetch(answers: (Response | Error | ((c: Call) => Response))[]) {
	const calls: Call[] = [];
	const f = (async (url: string, init: RequestInit) => {
		const c = { url: String(url), init };
		calls.push(c);
		const a = answers.length > 1 ? answers.shift()! : answers[0]!;
		if (a instanceof Error) throw a;
		return typeof a === 'function' ? a(c) : a.clone();
	}) as unknown as typeof fetch;
	return { f, calls };
}

/** Voice bursts with quiet gaps, as PCM */
function speech(pattern: [on: number, off: number][]) {
	const total = pattern.reduce((n, [a, b]) => n + a + b, 0);
	const pcm = new Int16Array(Math.round(total * SAMPLE_RATE));
	let i = 0;
	let seed = 7;
	const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
	for (const [on, off] of pattern) {
		// 200 ms syllables with 50 ms dips
		for (let k = 0; k < on * SAMPLE_RATE; k++)
			pcm[i++] = Math.round(rnd() * (k % 4000 >= 3200 ? 150 : 3000));
		for (let k = 0; k < off * SAMPLE_RATE; k++) pcm[i++] = Math.round(rnd() * 5);
	}
	return pcm;
}

function deps(pcm: Int16Array, f: typeof fetch) {
	const encoded: { format: UploadFormat; a?: number; b?: number }[] = [];
	const d: TranscribeDeps = {
		fetch: f,
		sleep: async () => {},
		decode: async () => pcm,
		encode: async (_pcm, format, a, b) => {
			encoded.push({ format, a, b });
			return { bytes: new Uint8Array(10), mime: 'audio/webm', name: 'audio.webm' };
		}
	};
	return { d, encoded };
}

const input = (s: TranscriptionSettings) => ({
	path: '/x.m4a',
	mime: 'audio/mp4',
	durationMs: null,
	settings: s
});

describe('transcribe', () => {
	it('sends short audio whole', async () => {
		const { f, calls } = fakeFetch([
			new Response(JSON.stringify({ text: 'Habari', languages: [{ code: 'sw' }] }))
		]);
		const { d, encoded } = deps(
			speech([
				[4, 1],
				[4, 0]
			]),
			f
		);
		const r = await transcribe(input(settings()), d);
		expect(r).toEqual({ text: 'Habari', languages: ['sw'], by: 'openai:gpt-transcribe' });
		expect(calls.length).toBe(1);
		expect(encoded).toEqual([{ format: 'webm', a: undefined, b: undefined }]);
	});

	it('chunks long audio at pauses and merges languages by voiced time', async () => {
		let n = 0;
		const replies = [
			{ text: 'Hello there.', languages: [{ code: 'en' }] },
			{ text: 'Habari yako.', languages: [{ code: 'sw' }] },
			{ text: 'Hola.', languages: [{ code: 'es' }] }
		];
		const { f, calls } = fakeFetch([() => new Response(JSON.stringify(replies[n++]))]);
		// 3 x (12 s voice, 1 s pause) + a short tail: about 41 s
		const { d, encoded } = deps(
			speech([
				[12, 1],
				[12, 1],
				[12, 1],
				[2, 0]
			]),
			f
		);
		const r = await transcribe(input(settings()), d);
		expect(calls.length).toBeGreaterThanOrEqual(2);
		expect(encoded.every((e) => e.b! - e.a! <= 30)).toBe(true);
		expect(r.text.split(' ').length).toBeGreaterThanOrEqual(4);
		expect(r.languages[0]).toBe('en');
		expect(r.by).toBe('openai:gpt-transcribe');
	});

	it('sends long audio whole when chunking is off', async () => {
		const { f, calls } = fakeFetch([new Response(JSON.stringify({ text: 'all of it' }))]);
		const { d } = deps(
			speech([
				[20, 1],
				[20, 1]
			]),
			f
		);
		const r = await transcribe(input(settings({ chunking: false })), d);
		expect(calls.length).toBe(1);
		expect(r.text).toBe('all of it');
		expect(r.languages).toEqual([]);
	});

	it('returns an empty transcript for silence without calling the provider', async () => {
		const { f, calls } = fakeFetch([new Response('{}')]);
		const { d } = deps(new Int16Array(SAMPLE_RATE * 40), f);
		expect(await transcribe(input(settings()), d)).toEqual({
			text: '',
			languages: [],
			by: 'openai:gpt-transcribe'
		});
		expect(calls.length).toBe(0);
	});

	it('fails the whole recording when a chunk fails for good', async () => {
		const { f } = fakeFetch([
			new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 })
		]);
		const { d } = deps(
			speech([
				[12, 1],
				[12, 1],
				[12, 1],
				[12, 0]
			]),
			f
		);
		const err = await transcribe(input(settings()), d).catch((e) => e);
		expect(err.message).toBe('Key rejected by api.openai.com (401)');
		expect(err.retryable).toBe(false);
	});

	it('uses each provider format and label', async () => {
		const { f } = fakeFetch([new Response(JSON.stringify({ text: 'x', language: 'en' }))]);
		const { d, encoded } = deps(speech([[3, 0]]), f);
		const r = await transcribe(input(settings({ provider: 'whisper-cpp' })), d);
		expect(r.by).toBe('whisper-cpp');
		expect(encoded[0]!.format).toBe('wav');
	});

	it('stops when the caller aborts', async () => {
		const ac = new AbortController();
		const f = ((_: string, init: RequestInit) => {
			setTimeout(() => ac.abort(new Error('shutting down')), 5);
			return new Promise((_r, reject) =>
				init.signal!.addEventListener('abort', () => reject(init.signal!.reason))
			);
		}) as unknown as typeof fetch;
		const { d } = deps(speech([[3, 0]]), f);
		await expect(transcribe({ ...input(settings()), signal: ac.signal }, d)).rejects.toThrow(
			'shutting down'
		);
	});

	it('rejects an empty file', async () => {
		const { f } = fakeFetch([new Response('{}')]);
		const { d } = deps(new Int16Array(0), f);
		await expect(transcribe(input(settings()), d)).rejects.toThrow('The file holds no audio');
	});

	it('treats a clip under 0.1 s as no speech', async () => {
		const { f, calls } = fakeFetch([new Response('{"text":"x"}')]);
		const { d } = deps(new Int16Array(800), f);
		expect(await transcribe(input(settings()), d)).toEqual({
			text: '',
			languages: [],
			by: 'openai:gpt-transcribe'
		});
		expect(calls.length).toBe(0);
	});

	it('refuses recordings over the cap before decoding', async () => {
		const { f } = fakeFetch([new Response('{}')]);
		let decoded = 0;
		const { d } = deps(speech([[3, 0]]), f);
		d.decode = async () => (decoded++, new Int16Array(0));
		const err = await transcribe(
			{ ...input(settings()), durationMs: (MAX_AUDIO_SECONDS + 60) * 1000 },
			d
		).catch((e) => e);
		expect(err.message).toBe('Recording longer than 2 h');
		expect(err.retryable).toBe(false);
		expect(decoded).toBe(0);
	});

	it('sizes the decode from the probed duration and caps its length', async () => {
		const { f } = fakeFetch([new Response('{"text":"hi"}')]);
		const seen: unknown[] = [];
		const pcm = speech([[3, 0]]);
		const { d } = deps(pcm, f);
		d.decode = async (_path, opts) => (seen.push(opts), pcm);
		await transcribe({ ...input(settings()), durationMs: 3000 }, d);
		expect(seen).toEqual([{ expectedSeconds: 3, maxSeconds: MAX_AUDIO_SECONDS + 1 }]);
	});

	it('turns the caller deadline into a TranscribeError that is not retried', async () => {
		const f = ((_: string, init: RequestInit) =>
			new Promise((_r, reject) =>
				init.signal!.addEventListener('abort', () => reject(init.signal!.reason))
			)) as unknown as typeof fetch;
		const { d } = deps(speech([[3, 0]]), f);
		const err = await transcribe(
			{ ...input(settings()), signal: AbortSignal.timeout(20) },
			d
		).catch((e) => e);
		expect(err.name).toBe('TranscribeError');
		expect(err.message).toBe('Transcription ran past its time limit');
		expect(err.retryable).toBe(false);
	});

	it('drops a hallucinated chunk among speech chunks', async () => {
		let n = 0;
		const replies = [
			{ text: 'Hello there.', language: 'english' },
			{ text: 'ご視聴ありがとうございました', language: 'japanese' },
			{ text: '[Motor]', language: 'nynorsk' },
			{ text: 'Habari yako.', language: 'swahili' }
		];
		const { f } = fakeFetch([() => new Response(JSON.stringify(replies[n++]))]);
		const { d } = deps(
			speech([
				[20, 1],
				[20, 1],
				[20, 1],
				[20, 0]
			]),
			f
		);
		const s = settings({
			openai: { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk', model: 'whisper-1' }
		});
		const r = await transcribe(input(s), d);
		expect(n).toBe(4);
		expect(r.text).toBe('Hello there. Habari yako.');
		expect(r.languages.sort()).toEqual(['en', 'sw']);
	});
});

describe('PROVIDERS and testTranscription', () => {
	it('lists the four providers', () => {
		expect(PROVIDERS.map((p) => p.id)).toEqual(['openai', 'openai-audio', 'gemini', 'whisper-cpp']);
		expect(PROVIDERS[0]!.defaultModel).toBe('gpt-transcribe');
	});

	it('dispatches the probe', async () => {
		const { f, calls } = fakeFetch([new Response(JSON.stringify({ id: 'gpt-audio' }))]);
		expect(await testTranscription(settings({ provider: 'openai-audio' }), { fetch: f })).toBe(
			'gpt-audio available'
		);
		expect(calls[0]!.url).toBe('https://api.openai.com/v1/models/gpt-audio');
	});
});
