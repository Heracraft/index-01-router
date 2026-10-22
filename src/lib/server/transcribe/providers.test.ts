import { describe, expect, it } from 'vitest';
import { isHallucination } from './clean.ts';
import { gemini, GEMINI_DEFAULT_MODEL, geminiBody, parseGeminiReply } from './gemini.ts';
import {
	errorDetail,
	httpError,
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

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', ...headers }
	});

const audio = { bytes: new Uint8Array([1, 2, 3]), mime: 'audio/webm', name: 'audio.webm' };

function ctx(f: typeof fetch, waits: number[] = []): RequestContext {
	return { fetch: f, sleep: async (ms) => void waits.push(ms) };
}

/** The multipart body send() encoded, read back */
async function formOf(c: Call) {
	const headers = c.init.headers as Record<string, string>;
	expect(c.init.body).toBeInstanceOf(Uint8Array);
	return new Response(c.init.body, { headers }).formData();
}

describe('send', () => {
	it('survives a refused request with a multipart body', async () => {
		// undici used to throw an uncaught ERR_INVALID_STATE here, which ended the process.
		// Port 9 is on fetch's blocked list, so the request fails while the body still streams,
		// and transcribe() then aborts the shared signal
		const body = () => {
			const form = new FormData();
			form.set('file', new Blob([new Uint8Array(32 * 1024)], { type: 'audio/webm' }), 'a.webm');
			form.append('model', 'gpt-transcribe');
			return form;
		};
		const stop = new AbortController();
		const sent = send(
			'http://127.0.0.1:9/v1/audio/transcriptions',
			{ fetch, signal: stop.signal, sleep: async () => {} },
			{ body }
		).finally(() => stop.abort());
		await expect(sent).rejects.toThrow(/Could not reach 127\.0\.0\.1:9/);
		await new Promise((r) => setTimeout(r, 200));
	});

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

	it('drops segments Whisper marks as silence or loops', () => {
		const reply = (segments: object[]) =>
			JSON.stringify({
				text: segments.map((s) => (s as { text: string }).text).join(''),
				segments
			});
		expect(
			parseTranscription(reply([{ text: ' Hmm.', no_speech_prob: 0.9, avg_logprob: -1.2 }])).text
		).toBe('');
		expect(
			parseTranscription(
				reply([
					{ text: ' Hello.', no_speech_prob: 0.1, avg_logprob: -0.3, compression_ratio: 1.2 },
					{
						text: ' la la la la la la',
						no_speech_prob: 0.1,
						avg_logprob: -0.3,
						compression_ratio: 3.1
					}
				])
			)
		).toEqual({ text: 'Hello.', languages: [], noSpeech: 0.1 });
		expect(parseTranscription(JSON.stringify({ text: ' [Motor]' })).text).toBe('');
	});

	it('flags stock hallucinations only on doubt', () => {
		const ja = parseTranscription(
			JSON.stringify({
				text: 'ご視聴ありがとうございました',
				segments: [
					{ text: 'ご視聴ありがとうございました', no_speech_prob: 0.48, avg_logprob: -0.72 }
				]
			})
		);
		expect(ja.text).toBe('ご視聴ありがとうございました');
		expect(isHallucination(ja)).toBe(true);
		expect(isHallucination({ text: 'Thank you.', noSpeech: 0.01 })).toBe(false);
		expect(isHallucination({ text: 'Thank you.', noSpeech: 0.5 })).toBe(true);
		expect(isHallucination({ text: 'Thank you.' })).toBe(false);
		expect(isHallucination({ text: 'Sous-titrage Société Radio-Canada' })).toBe(true);
		expect(isHallucination({ text: 'Legendas do filme precisam de revisão' })).toBe(false);
		expect(isHallucination({ text: 'Thanks for watching, see you tomorrow' })).toBe(false);
		// A run of outro sentences, as whisper-1 wrote for 20 s of pink noise
		expect(
			isHallucination({
				text: 'Thanks for watching... Please subscribe and Thumbs Up.... More Videos to come....'
			})
		).toBe(true);
		expect(isHallucination({ text: 'Thank you for watching! See you in the next video.' })).toBe(
			true
		);
		expect(isHallucination({ text: 'Please subscribe to the newsletter. Then call Juma.' })).toBe(
			false
		);
		expect(isHallucination({ text: 'Remind me to subscribe to the gym' })).toBe(false);
		expect(isHallucination({ text: 'Subscribe to the newsletter.' })).toBe(false);
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
			'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent'
		);
		expect((c.init.headers as Record<string, string>)['x-goog-api-key']).toBe('g-test');
		const body = JSON.parse(c.init.body as string);
		expect(body).toEqual(geminiBody(ogg, settings({ prompt: 'Juma' }), 'gemini-3.8-flash'));
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
		await expect(gemini.transcribe(audio, settings(), ctx(bad.f))).rejects.toThrow(
			'Key rejected by generativelanguage.googleapis.com (400)'
		);
		expect(() => parseGeminiReply('{"promptFeedback":{"blockReason":"SAFETY"}}')).toThrow(
			'Gemini blocked the request (SAFETY)'
		);
	});

	it('defaults to gemini-3.8-flash', () => {
		expect(GEMINI_DEFAULT_MODEL).toBe('gemini-3.8-flash');
		expect(gemini.model(settings({ gemini: { apiKey: 'k', model: ' ' } }))).toBe(
			'gemini-3.8-flash'
		);
		expect(
			gemini.model(settings({ gemini: { apiKey: 'k', model: 'models/gemini-3.5-flash-lite' } }))
		).toBe('gemini-3.5-flash-lite');
	});

	it('names the model when generateContent refuses it', async () => {
		const { f } = fakeFetch([
			json(
				{
					error: {
						code: 403,
						message: 'Your project does not have access to model gemini-2.5-flash.',
						status: 'PERMISSION_DENIED'
					}
				},
				403
			)
		]);
		const s = settings({ gemini: { apiKey: 'k', model: 'gemini-2.5-flash' } });
		const err = (await gemini.transcribe(audio, s, ctx(f)).catch((e) => e)) as TranscribeError;
		expect(err.message).toBe(
			'gemini-2.5-flash not available to this key (403): Your project does not have access to model gemini-2.5-flash.'
		);
		expect(err.retryable).toBe(false);
	});

	it('tells a model refusal from a key refusal', () => {
		const host = 'generativelanguage.googleapis.com';
		const zero = JSON.stringify({
			error: {
				code: 429,
				status: 'RESOURCE_EXHAUSTED',
				message:
					'Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: gemini-2.5-pro'
			}
		});
		expect(httpError(429, zero, host, 'gemini-2.5-pro').message).toMatch(
			/^gemini-2\.5-pro not available to this key \(429\)/
		);
		const busy = JSON.stringify({
			error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Resource has been exhausted' }
		});
		expect(httpError(429, busy, host, 'gemini-3.8-flash').retryable).toBe(true);
		const blocked = JSON.stringify({
			error: {
				code: 403,
				status: 'PERMISSION_DENIED',
				message: 'API key expired.',
				details: [{ reason: 'API_KEY_INVALID' }]
			}
		});
		expect(httpError(403, blocked, host, 'gemini-3.8-flash').message).toBe(
			`Key rejected by ${host} (403)`
		);
		// Without a model the old wording stays
		expect(httpError(403, '{"error":{"status":"PERMISSION_DENIED"}}', host).message).toBe(
			`Key rejected by ${host} (403)`
		);
	});

	it('picks temperature and thinking by model generation', () => {
		const ogg = { bytes: new Uint8Array([1]), mime: 'audio/ogg', name: 'audio.ogg' };
		const g3 = geminiBody(ogg, settings(), 'gemini-3-flash').generationConfig;
		expect(g3).not.toHaveProperty('temperature');
		expect(g3).toMatchObject({ thinkingConfig: { thinkingLevel: 'low' } });
		const g25 = geminiBody(ogg, settings(), 'gemini-2.5-flash').generationConfig;
		expect(g25).toMatchObject({ temperature: 0, thinkingConfig: { thinkingBudget: 0 } });
		const pro = geminiBody(ogg, settings(), 'gemini-2.5-pro').generationConfig;
		expect(pro).toMatchObject({ thinkingConfig: { thinkingBudget: 128 } });
		const other = geminiBody(ogg, settings(), 'gemini-2.0-flash').generationConfig;
		expect(other).not.toHaveProperty('thinkingConfig');
		expect(other).toMatchObject({ temperature: 0 });
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
		expect(cleanWhisperText(' [Motor]')).toBe('');
		expect(cleanWhisperText('hello [Motor] there')).toBe('hello there');
		expect(cleanWhisperText('(laughs) ok *music* ♪ la la ♪ ♫')).toBe('ok');
		expect(cleanWhisperText('I said *really* (twice, to be sure today)')).toBe(
			'I said *really* (twice, to be sure today)'
		);
		expect(cleanWhisperText('...')).toBe('');
		expect(
			parseWhisperReply(
				JSON.stringify({
					text: ' Noise here. Real words.',
					language: 'nynorsk',
					segments: [
						{ text: ' Noise here.', no_speech_prob: 0.9, avg_logprob: -1.2 },
						{ text: ' Real words.', no_speech_prob: 0.05, avg_logprob: -0.2 }
					]
				})
			)
		).toEqual({ text: 'Real words.', languages: ['nn'], noSpeech: 0.05 });
		expect(() => parseWhisperReply('{"error":"failed to read audio"}')).toThrow(
			'whisper.cpp: failed to read audio'
		);
	});
});
