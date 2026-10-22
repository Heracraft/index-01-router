// Gemini generateContent with the audio inline and a JSON response schema. Inline requests carry
// at most 20 MB in total. Not verified live: built from the v1beta REST docs.
import { send } from './openai.ts';
import { llmInstructions, llmUserText, parseLlmTranscript, transcriptSchema } from './prompt.ts';
import {
	TranscribeError,
	type Provider,
	type TranscriptionSettings,
	type Upload
} from './types.ts';

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const HOST = 'generativelanguage.googleapis.com';

/**
 * Google limits the 2.5 models to keys that used them before and points new projects at
 * 3.8 Flash (or 3.5 Flash-Lite when cost matters more than accuracy on code-switched audio)
 */
export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';

/** `models/gemini-3.8-flash` and `gemini-3.8-flash` both name the same model */
const modelPath = (model: string) => encodeURIComponent(model.replace(/^models\//, ''));

/**
 * Gemini 3 wants the default temperature (lower values can loop) and takes a thinking level.
 * 2.5 Flash can turn thinking off; 2.5 Pro cannot, and 128 tokens is its smallest budget.
 */
function thinkingConfig(model: string) {
	if (/^gemini-3/.test(model)) return { thinkingLevel: 'low' };
	if (/^gemini-2\.5-flash/.test(model)) return { thinkingBudget: 0 };
	if (/^gemini-2\.5-pro/.test(model)) return { thinkingBudget: 128 };
	return undefined;
}

export function geminiBody(
	audio: Upload,
	settings: TranscriptionSettings,
	model: string,
	maxOutputTokens?: number
) {
	const g3 = /^gemini-3/.test(model);
	const thinking = thinkingConfig(model);
	return {
		system_instruction: { parts: [{ text: llmInstructions(settings) }] },
		contents: [
			{
				role: 'user',
				parts: [
					{ text: llmUserText },
					{
						inline_data: {
							mime_type: audio.mime,
							data: Buffer.from(audio.bytes).toString('base64')
						}
					}
				]
			}
		],
		generationConfig: {
			...(g3 ? {} : { temperature: 0 }),
			...(thinking ? { thinkingConfig: thinking } : {}),
			...(maxOutputTokens ? { maxOutputTokens } : {}),
			responseMimeType: 'application/json',
			responseSchema: transcriptSchema
		}
	};
}

/** Half a second of silence, ogg/opus, for the Test button */
const SILENCE: Upload = {
	bytes: Buffer.from(
		'T2dnUwACAAAAAAAAAAAAAAAAAAAAAEkq9qABE09wdXNIZWFkAQE4AYA+AAAAAABPZ2dTAAAAAAAAAAAAAAAAAAABAA' +
			'AASZW+VAEuT3B1c1RhZ3MGAAAAZmZtcGVnAQAAABQAAABlbmNvZGVyPUxhdmMgbGlib3B1c09nZ1MABPheAAAAAAAA' +
			'AAAAAAIAAACJ/z9nGgcGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGCAvkuaC8hAgHxrMOxggHxrMOxggHxrMOxggHxr' +
			'MOxggHxrMOxggHxrMOxggHxrMOxggHxrMOxggHxrMOxggHxrMOxggHxrMOxggHxrMOxggHxrMOxggHxrMOxggHxrMO' +
			'xggHxrMOxggHxrMOxggHxrMOxggHxrMOxggHxrMOxggHxrMOxggHxrMOxggHxrMOxggHxrMOxggHxrMOxg==',
		'base64'
	),
	mime: 'audio/ogg',
	name: 'audio.ogg'
};

interface GeminiReply {
	candidates?: {
		finishReason?: string;
		content?: { parts?: { text?: string; thought?: boolean }[] };
	}[];
	promptFeedback?: { blockReason?: string };
}

export function parseGeminiReply(body: string) {
	let j: GeminiReply;
	try {
		j = JSON.parse(body) as GeminiReply;
	} catch {
		throw new TranscribeError(`${HOST} sent a reply that is not JSON`, true);
	}
	if (j.promptFeedback?.blockReason)
		throw new TranscribeError(
			`Gemini blocked the request (${j.promptFeedback.blockReason})`,
			false
		);
	const c = j.candidates?.[0];
	if (!c) throw new TranscribeError('Gemini returned no candidates', true);
	const text = (c.content?.parts ?? [])
		.filter((p) => !p.thought && typeof p.text === 'string')
		.map((p) => p.text)
		.join('');
	if (!text && c.finishReason && c.finishReason !== 'STOP')
		throw new TranscribeError(
			`Gemini stopped without text (${c.finishReason})`,
			c.finishReason === 'OTHER'
		);
	return parseLlmTranscript(text);
}

const generate = (
	audio: Upload,
	settings: TranscriptionSettings,
	model: string,
	ctx: Parameters<Provider['transcribe']>[2],
	opts: { maxOutputTokens?: number; attempts?: number } = {}
) => {
	const payload = JSON.stringify(geminiBody(audio, settings, model, opts.maxOutputTokens));
	return send(`${GEMINI_BASE}/models/${modelPath(model)}:generateContent`, ctx, {
		headers: { 'content-type': 'application/json', 'x-goog-api-key': settings.gemini.apiKey },
		body: () => payload,
		attempts: opts.attempts,
		model
	});
};

export const gemini: Provider = {
	id: 'gemini',
	label: 'Gemini',
	defaultModel: GEMINI_DEFAULT_MODEL,
	format: 'ogg',
	// 20 MB per request including base64 and the prompt
	maxBytes: 14 * 1024 * 1024,
	model: (s) => s.gemini.model.trim().replace(/^models\//, '') || GEMINI_DEFAULT_MODEL,

	async transcribe(audio, settings, ctx) {
		if (!settings.gemini.apiKey) throw new TranscribeError(`No API key set for ${HOST}`, false);
		return parseGeminiReply(await generate(audio, settings, this.model(settings), ctx));
	},

	/** GET the model (a cheap 404 for a typo), then transcribe half a second of silence */
	async test(settings, ctx) {
		const key = settings.gemini.apiKey;
		const model = this.model(settings);
		if (!key) throw new TranscribeError(`No API key set for ${HOST}`, false);
		const quick = { ...ctx, timeoutMs: ctx.timeoutMs ?? 20_000 };
		try {
			await send(`${GEMINI_BASE}/models/${modelPath(model)}`, quick, {
				headers: { 'x-goog-api-key': key },
				attempts: 1,
				model
			});
		} catch (e) {
			if (e instanceof TranscribeError && / answered 404/.test(e.message))
				throw new TranscribeError(`${model} not offered by ${HOST}`, false);
			throw e;
		}
		// Any 2xx will do: a short output cap can end the reply before the JSON is complete
		await generate(SILENCE, settings, model, quick, { maxOutputTokens: 64, attempts: 1 });
		return `${model} transcribes`;
	}
};
