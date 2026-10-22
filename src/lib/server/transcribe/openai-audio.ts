// Audio piped into an LLM: POST {base}/chat/completions with an input_audio part (gpt-audio).
// input_audio takes wav or mp3 only. The model is told to transcribe verbatim and reply JSON.
import { bearer, probeModel, requireKey, send, trimUrl } from './openai.ts';
import { llmInstructions, llmUserText, parseLlmTranscript } from './prompt.ts';
import {
	TranscribeError,
	type Provider,
	type TranscriptionSettings,
	type Upload
} from './types.ts';

export function chatBody(audio: Upload, settings: TranscriptionSettings, model: string) {
	const format = audio.mime === 'audio/mpeg' ? 'mp3' : 'wav';
	return {
		model,
		modalities: ['text'],
		temperature: 0,
		messages: [
			{ role: 'system', content: llmInstructions(settings) },
			{
				role: 'user',
				content: [
					{ type: 'text', text: llmUserText },
					{
						type: 'input_audio',
						input_audio: { data: Buffer.from(audio.bytes).toString('base64'), format }
					}
				]
			}
		]
	};
}

interface ChatReply {
	choices?: {
		finish_reason?: string;
		message?: {
			content?: string | { type?: string; text?: string }[] | null;
			refusal?: string | null;
		};
	}[];
}

export function parseChatReply(body: string, host: string) {
	let j: ChatReply;
	try {
		j = JSON.parse(body) as ChatReply;
	} catch {
		throw new TranscribeError(`${host} sent a reply that is not JSON`, true);
	}
	const msg = j.choices?.[0]?.message;
	if (msg?.refusal) throw new TranscribeError(`Model refused: ${msg.refusal.slice(0, 160)}`, false);
	const content = msg?.content;
	const text = Array.isArray(content)
		? content.map((p) => (typeof p.text === 'string' ? p.text : '')).join('')
		: (content ?? '');
	return parseLlmTranscript(text);
}

export const openaiAudio: Provider = {
	id: 'openai-audio',
	label: 'OpenAI audio chat',
	defaultModel: 'gpt-audio',
	format: 'wav',
	// Base64 grows the request by a third; 16 MB of wav is about 8 minutes
	maxBytes: 16 * 1024 * 1024,
	model: (s) => s.openaiAudio.model.trim() || 'gpt-audio',

	async transcribe(audio, settings, ctx) {
		const base = trimUrl(settings.openaiAudio.baseUrl);
		requireKey(base, settings.openaiAudio.apiKey);
		const payload = JSON.stringify(chatBody(audio, settings, this.model(settings)));
		const body = await send(`${base}/chat/completions`, ctx, {
			headers: { 'content-type': 'application/json', ...bearer(settings.openaiAudio.apiKey) },
			body: () => payload
		});
		return parseChatReply(body, new URL(base).host);
	},

	test(settings, ctx) {
		const s = settings.openaiAudio;
		return probeModel(s.baseUrl, s.apiKey, this.model(settings), ctx);
	}
};
