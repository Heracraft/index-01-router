import { describe, expect, it } from 'vitest';
import { gemini, geminiBody, parseGeminiReply } from './gemini.ts';
import {
	errorDetail,
	modelKind,
	openai,
	parseTranscription,
	retryAfterMs,
	send,
	transcriptionFields
} from './openai.ts';
import { chatBody, openaiAudio, parseChatReply } from './openai-audio.ts';
import { TranscribeError, type RequestContext, type TranscriptionSettings } from './types.ts';
import { cleanWhisperText, parseWhisperReply, whisperCpp, whisperFields } from './whisper-cpp.ts';

function settings(over: Partial<TranscriptionSettings> = {}): TranscriptionSettings {
	return {
		provider: 'openai',
		openai: { baseUrl: 'https://api.openai.com/v1/', apiKey: 'sk-test', model: 'gpt-transcribe' },
		openaiAudio: { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-audio' },
		gemini: { apiKey: 'g-test', model: 'gemini-2.5-flash' },
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

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', ...headers }
	});

const audio = { bytes: new Uint8Array([1, 2, 3]), mime: 'audio/webm', name: 'audio.webm' };

function ctx(f: typeof fetch, waits: number[] = []): RequestContext {
	return { fetch: f, sleep: async (ms) => void waits.push(ms) };
}

async function formOf(c: Call) {
	return c.init.body as FormData;
}

describe('send', () => {
	it('retries 429 and 5xx, honouring Retry-After', async () => {
		const waits: number[] = [];
		const { f, calls } = fakeFetch([
			json({ error: { message: 'slow down' } }, 429, { 'retry-after': '2' }),
			json({ error: { message: 'oops' } }, 503),
			new Response('ok')
		]);
		expect(await send('https://api.openai.com/v1/x', ctx(f, waits))).toBe('ok');
		expect(calls.length).toBe(3);
		expect(waits[0]).toBe(2000);
		expect(waits[1]).toBeGreaterThanOrEqual(2000);
	});

	it('gives up after 3 attempts with a retryable error', async () => {
		const { f, calls } = fakeFetch([json({ error: { message: 'down' } }, 502)]);
		const err = await send('https://api.openai.com/v1/x', ctx(f)).catch((e) => e);
		expect(calls.length).toBe(3);
		expect(err).toBeInstanceOf(TranscribeError);
		expect(err.retryable).toBe(true);
		expect(err.message).toBe('api.openai.com answered 502: down');
	});

	it.each([
		[401, {}, 'Key rejected by api.openai.com (401)'],
		[403, {}, 'Key rejected by api.openai.com (403)'],
		[
			404,
			{ error: { message: 'The model `nope` does not exist' } },
			'api.openai.com answered 404: The model `nope` does not exist'
		],
		[
			400,
			{ error: { message: 'Invalid file format.' } },
			'api.openai.com answered 400: Invalid file format.'
		],
		[
			429,
			{ error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } },
			'Quota used up at api.openai.com (429): You exceeded your current quota'
		]
	])('does not retry %i', async (status, body, message) => {
		const { f, calls } = fakeFetch([json(body, status)]);
		const err = await send('https://api.openai.com/v1/x', ctx(f)).catch((e) => e);
		expect(calls.length).toBe(1);
		expect(err.retryable).toBe(false);
		expect(err.message).toBe(message);
	});

	it('retries network errors and names the cause', async () => {
		const e = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
		const { f, calls } = fakeFetch([e]);
		const err = await send('http://whisper:8080/inference', ctx(f)).catch((x) => x);
		expect(calls.length).toBe(3);
		expect(err.message).toBe('Could not reach whisper:8080 (ECONNREFUSED)');
		expect(err.retryable).toBe(true);
	});

	it('times out per request', async () => {
		const f = ((_: string, init: RequestInit) =>
			new Promise((_r, reject) =>
				init.signal!.addEventListener('abort', () => reject(init.signal!.reason))
			)) as unknown as typeof fetch;
		const err = await send('https://api.openai.com/v1/x', { ...ctx(f), timeoutMs: 20 }).catch(
			(e) => e
		);
		expect(err.message).toBe('api.openai.com did not answer within 0.02 s');
	});

	it('stops when the caller aborts', async () => {
		const ac = new AbortController();
		const { f, calls } = fakeFetch([
			() => {
				ac.abort(new Error('stop'));
				return json({}, 500);
			}
		]);
		const err = await send('https://api.openai.com/v1/x', { ...ctx(f), signal: ac.signal }).catch(
			(e) => e
		);
		expect(err.message).toBe('stop');
		expect(calls.length).toBe(1);
	});

	it('parses Retry-After forms', () => {
		expect(retryAfterMs(new Headers({ 'retry-after': '3' }))).toBe(3000);
		expect(retryAfterMs(new Headers({ 'retry-after-ms': '150' }))).toBe(150);
		expect(retryAfterMs(new Headers({ 'retry-after': new Date(10_000).toUTCString() }), 4000)).toBe(
			6000
		);
		expect(retryAfterMs(new Headers())).toBeNull();
	});

	it('extracts error messages', () => {
		expect(errorDetail('{"error":"model not loaded"}')).toBe('model not loaded');
		expect(errorDetail('<html><body>Bad gateway</body></html>')).toBe('Bad gateway');
	});
});

describe('openai', () => {
	it('sends languages[] and prompt to gpt-transcribe', async () => {
		const { f, calls } = fakeFetch([
			json({ text: 'Habari hello', languages: [{ code: 'sw' }, { code: 'en' }] })
		]);
		const s = settings({ languages: ['sw', 'en'], prompt: 'Names: Amina' });
		const r = await openai.transcribe(audio, s, ctx(f));
		expect(r).toEqual({ text: 'Habari hello', languages: ['sw', 'en'] });
		expect(calls[0]!.url).toBe('https://api.openai.com/v1/audio/transcriptions');
		expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
		const form = await formOf(calls[0]!);
		expect(form.getAll('languages[]')).toEqual(['sw', 'en']);
		expect(form.get('language')).toBeNull();
		expect(form.get('prompt')).toBe('Names: Amina');
		expect(form.get('response_format')).toBe('json');
		expect((form.get('file') as File).name).toBe('audio.webm');
	});

	it('sends one language to whisper-style models only with one hint', () => {
		expect(transcriptionFields({ languages: ['sw', 'en'], prompt: '' }, 'whisper-1')).toEqual([
			['model', 'whisper-1'],
			['response_format', 'verbose_json'],
			['temperature', '0']
		]);
		expect(
			transcriptionFields({ languages: ['sw'], prompt: '' }, 'whisper-large-v3-turbo')
		).toContainEqual(['language', 'sw']);
		expect(transcriptionFields({ languages: ['sw'], prompt: '' }, 'gpt-4o-transcribe')).toEqual([
			['model', 'gpt-4o-transcribe'],
			['response_format', 'json'],
			['language', 'sw']
		]);
	});

	it('classifies models', () => {
		expect(modelKind('gpt-transcribe')).toBe('gpt-transcribe');
		expect(modelKind('gpt-4o-mini-transcribe')).toBe('gpt-4o');
		expect(modelKind('Systran/faster-whisper-small')).toBe('whisper');
	});

	it('falls back to json when verbose_json is refused', async () => {
		const { f, calls } = fakeFetch([
			json({ error: { message: "response_format 'verbose_json' is not compatible" } }, 400),
			json({ text: 'hi' })
		]);
		const s = settings({
			openai: { baseUrl: 'http://speaches:8000/v1', apiKey: '', model: 'odd-model' }
		});
		expect((await openai.transcribe(audio, s, ctx(f))).text).toBe('hi');
		expect((await formOf(calls[1]!)).get('response_format')).toBe('json');
		// Remembered: the next request goes straight to json
		await openai.transcribe(audio, s, ctx(f));
		expect((await formOf(calls[2]!)).get('response_format')).toBe('json');
	});

	it('reads verbose_json language names and plain text replies', () => {
		expect(parseTranscription('{"text":" Hola ","language":"spanish","segments":[]}')).toEqual({
			text: 'Hola',
			languages: ['es']
		});
		expect(parseTranscription('plain words\n')).toEqual({ text: 'plain words', languages: [] });
	});

	it('needs a key for api.openai.com only', async () => {
		const { f } = fakeFetch([json({ text: '' })]);
		const s = settings({
			openai: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-transcribe' }
		});
		await expect(openai.transcribe(audio, s, ctx(f))).rejects.toThrow(
			'No API key set for api.openai.com'
		);
		const local = settings({
			openai: { baseUrl: 'http://speaches:8000/v1', apiKey: '', model: 'x' }
		});
		await expect(openai.transcribe(audio, local, ctx(f))).resolves.toEqual({
			text: '',
			languages: []
		});
	});

	it('tests the connection against /models', async () => {
		const ok = fakeFetch([json({ id: 'gpt-transcribe', object: 'model' })]);
		expect(await openai.test(settings(), ctx(ok.f))).toBe('gpt-transcribe available');
		expect(ok.calls[0]!.url).toBe('https://api.openai.com/v1/models/gpt-transcribe');
		const listed = fakeFetch([
			new Response('', { status: 404 }),
			json({ data: [{ id: 'gpt-transcribe' }] })
		]);
		expect(await openai.test(settings(), ctx(listed.f))).toBe('gpt-transcribe available');
		expect(listed.calls[1]!.url).toBe('https://api.openai.com/v1/models');
		const missing = fakeFetch([
			json({ error: { message: 'The model does not exist' } }, 404),
			json({ data: [{ id: 'whisper-1' }] })
		]);
		await expect(openai.test(settings(), ctx(missing.f))).rejects.toThrow(
			'gpt-transcribe not offered by api.openai.com'
		);
		const bad = fakeFetch([json({ error: { message: 'Incorrect API key' } }, 401)]);
		await expect(openai.test(settings(), ctx(bad.f))).rejects.toThrow(
			'Key rejected by api.openai.com (401)'
		);
		const nolist = fakeFetch([new Response('not found', { status: 404 })]);
		const s = settings({ openai: { baseUrl: 'http://speaches:8000/v1', apiKey: '', model: 'x' } });
		expect(await openai.test(s, ctx(nolist.f))).toBe(
			'speaches:8000 answered, but has no model list to check x against'
		);
	});
});

describe('openai-audio', () => {
	it('builds a chat request with input_audio and strict instructions', () => {
		const s = settings({ languages: ['sw'] });
		const body = chatBody({ ...audio, mime: 'audio/wav', name: 'audio.wav' }, s, 'gpt-audio');
		expect(body.model).toBe('gpt-audio');
		expect(body.messages[0]!.role).toBe('system');
		expect(body.messages[0]!.content).toContain('Never translate');
		const parts = body.messages[1]!.content as {
			type: string;
			input_audio?: { data: string; format: string };
		}[];
		expect(parts[1]!.input_audio).toEqual({ data: 'AQID', format: 'wav' });
	});

	it('posts to chat/completions and parses the reply', async () => {
		const { f, calls } = fakeFetch([
			json({
				choices: [
					{ message: { content: '```json\n{"text":"Hola amigo","languages":["es"]}\n```' } }
				]
			})
		]);
		const r = await openaiAudio.transcribe(audio, settings(), ctx(f));
		expect(r).toEqual({ text: 'Hola amigo', languages: ['es'] });
		expect(calls[0]!.url).toBe('https://api.openai.com/v1/chat/completions');
	});

	it('reports refusals', () => {
		expect(() =>
			parseChatReply(
				JSON.stringify({ choices: [{ message: { content: null, refusal: 'No.' } }] }),
				'x'
			)
		).toThrow('Model refused: No.');
	});
});

describe('gemini', () => {
	it('builds generateContent with inline audio and a response schema', async () => {
		const { f, calls } = fakeFetch([
			json({
				candidates: [
					{
						content: { parts: [{ text: '{"text":"Sawa sawa","languages":["sw"]}' }] },
						finishReason: 'STOP'
					}
				]
			})
		]);
		const ogg = { bytes: new Uint8Array([1, 2, 3]), mime: 'audio/ogg', name: 'audio.ogg' };
		const r = await gemini.transcribe(ogg, settings({ prompt: 'Juma' }), ctx(f));
		expect(r).toEqual({ text: 'Sawa sawa', languages: ['sw'] });
		const c = calls[0]!;
		expect(c.url).toBe(
			'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
		);
		expect((c.init.headers as Record<string, string>)['x-goog-api-key']).toBe('g-test');
		const body = JSON.parse(c.init.body as string);
		expect(body).toEqual(geminiBody(ogg, settings({ prompt: 'Juma' })));
		expect(body.contents[0].parts[1]).toEqual({
			inline_data: { mime_type: 'audio/ogg', data: 'AQID' }
		});
		expect(body.generationConfig.responseMimeType).toBe('application/json');
		expect(body.generationConfig.responseSchema.required).toEqual(['text', 'languages']);
		expect(body.system_instruction.parts[0].text).toContain('Juma');
	});

	it('maps Gemini errors', async () => {
		const bad = fakeFetch([
			json(
				{
					error: {
						code: 400,
						message: 'API key not valid. Please pass a valid API key.',
						status: 'INVALID_ARGUMENT',
						details: [{ reason: 'API_KEY_INVALID' }]
					}
				},
				400
			)
		]);
		await expect(gemini.test(settings(), ctx(bad.f))).rejects.toThrow(
			'Key rejected by generativelanguage.googleapis.com (400)'
		);
		const missing = fakeFetch([json({ error: { code: 404, message: 'not found' } }, 404)]);
		await expect(gemini.test(settings(), ctx(missing.f))).rejects.toThrow(
			'gemini-2.5-flash not offered by generativelanguage.googleapis.com'
		);
		const ok = fakeFetch([json({ name: 'models/gemini-2.5-flash' })]);
		expect(await gemini.test(settings(), ctx(ok.f))).toBe('gemini-2.5-flash available');
		expect(ok.calls[0]!.url).toBe(
			'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash'
		);
		expect(() => parseGeminiReply('{"promptFeedback":{"blockReason":"SAFETY"}}')).toThrow(
			'Gemini blocked the request (SAFETY)'
		);
	});
});

describe('whisper-cpp', () => {
	it('posts multipart to /inference with language auto', async () => {
		const { f, calls } = fakeFetch([json({ text: ' Habari [BLANK_AUDIO] yako', language: 'sw' })]);
		const wav = { bytes: new Uint8Array([1]), mime: 'audio/wav', name: 'audio.wav' };
		const r = await whisperCpp.transcribe(wav, settings({ languages: ['sw', 'en'] }), ctx(f));
		expect(r).toEqual({ text: 'Habari yako', languages: ['sw'] });
		expect(calls[0]!.url).toBe('http://whisper:8080/inference');
		const form = await formOf(calls[0]!);
		expect(form.get('language')).toBe('auto');
		expect(form.get('temperature')).toBe('0');
		expect(form.get('response_format')).toBe('verbose_json');
		expect((form.get('file') as File).name).toBe('audio.wav');
	});

	it('forces one language only with exactly one hint', () => {
		expect(whisperFields({ languages: ['sw'], prompt: '' })).toContainEqual(['language', 'sw']);
	});

	it('strips non-speech tags and reports server errors', () => {
		expect(cleanWhisperText('[BLANK_AUDIO]')).toBe('');
		expect(cleanWhisperText('Hello (music playing) there [ Silence ]')).toBe('Hello there');
		expect(() => parseWhisperReply('{"error":"failed to read audio"}')).toThrow(
			'whisper.cpp: failed to read audio'
		);
	});

	it('tests with GET /', async () => {
		const { f, calls } = fakeFetch([new Response('<html>whisper</html>')]);
		expect(await whisperCpp.test(settings(), ctx(f))).toBe('whisper.cpp answering at whisper:8080');
		expect(calls[0]!.url).toBe('http://whisper:8080/');
		const loading = fakeFetch([json({ status: 'loading model' }, 503)]);
		await expect(whisperCpp.test(settings(), ctx(loading.f))).rejects.toThrow(
			'whisper.cpp at whisper:8080 is still loading its model'
		);
	});
});
