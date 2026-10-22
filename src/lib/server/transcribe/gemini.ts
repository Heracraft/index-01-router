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

/** `models/gemini-2.5-flash` and `gemini-2.5-flash` both name the same model */
const modelPath = (model: string) => encodeURIComponent(model.replace(/^models\//, ''));

export function geminiBody(audio: Upload, settings: TranscriptionSettings) {
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
			temperature: 0,
			responseMimeType: 'application/json',
			responseSchema: transcriptSchema
		}
	};
}

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

export const gemini: Provider = {
	id: 'gemini',
	label: 'Gemini',
	defaultModel: 'gemini-2.5-flash',
	format: 'ogg',
	// 20 MB per request including base64 and the prompt
	maxBytes: 14 * 1024 * 1024,
	model: (s) => s.gemini.model.trim().replace(/^models\//, '') || 'gemini-2.5-flash',

	async transcribe(audio, settings, ctx) {
		const key = settings.gemini.apiKey;
		if (!key) throw new TranscribeError(`No API key set for ${HOST}`, false);
		const payload = JSON.stringify(geminiBody(audio, settings));
		const body = await send(
			`${GEMINI_BASE}/models/${modelPath(this.model(settings))}:generateContent`,
			ctx,
			{
				headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
				body: () => payload
			}
		);
		return parseGeminiReply(body);
	},

	async test(settings, ctx) {
		const key = settings.gemini.apiKey;
		const model = this.model(settings);
		if (!key) throw new TranscribeError(`No API key set for ${HOST}`, false);
		try {
			await send(
				`${GEMINI_BASE}/models/${modelPath(model)}`,
				{ ...ctx, timeoutMs: ctx.timeoutMs ?? 10_000 },
				{
					headers: { 'x-goog-api-key': key },
					attempts: 1
				}
			);
		} catch (e) {
			if (e instanceof TranscribeError && / answered 404/.test(e.message))
				throw new TranscribeError(`${model} not offered by ${HOST}`, false);
			throw e;
		}
		return `${model} available`;
	}
};
