// Local whisper.cpp server: POST {url}/inference, multipart. 16 kHz mono wav is whisper's own
// input, so this works whether or not the server runs with --convert.
import { hostOf, send, trimUrl } from './openai.ts';
import { normalizeLanguages } from './prompt.ts';
import { TranscribeError, type Provider, type TranscriptionSettings } from './types.ts';

export function whisperFields(
	settings: Pick<TranscriptionSettings, 'languages' | 'prompt'>
): [string, string][] {
	const langs = normalizeLanguages(settings.languages);
	const fields: [string, string][] = [
		// verbose_json carries the detected language; json is text only
		['response_format', 'verbose_json'],
		['language', langs.length === 1 ? langs[0]! : 'auto'],
		['temperature', '0']
	];
	const prompt = settings.prompt.replace(/\s+/g, ' ').trim().slice(0, 600);
	if (prompt) fields.push(['prompt', prompt]);
	return fields;
}

/** whisper.cpp marks non-speech with tags such as [BLANK_AUDIO] or (music) */
export function cleanWhisperText(text: string) {
	return text
		.replace(/\[(?:BLANK_AUDIO|[^\]]*(?:silence|music|noise|inaudible)[^\]]*)\]/gi, ' ')
		.replace(/\((?:[^)]*(?:silence|music|noise|inaudible)[^)]*)\)/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function parseWhisperReply(body: string) {
	let j: { text?: unknown; language?: unknown; error?: unknown };
	try {
		j = JSON.parse(body);
	} catch {
		return { text: cleanWhisperText(body), languages: [] };
	}
	if (typeof j.error === 'string') throw new TranscribeError(`whisper.cpp: ${j.error}`, false);
	return {
		text: typeof j.text === 'string' ? cleanWhisperText(j.text) : '',
		languages: normalizeLanguages(j.language)
	};
}

export const whisperCpp: Provider = {
	id: 'whisper-cpp',
	label: 'whisper.cpp',
	defaultModel: '',
	format: 'wav',
	maxBytes: 200 * 1024 * 1024,
	// The server decodes one request at a time; parallel chunks only queue up against the timeout
	concurrency: 1,
	// The server runs one model and does not report it
	model: () => '',

	async transcribe(audio, settings, ctx) {
		const url = trimUrl(settings.whisperCpp.url);
		const body = await send(
			`${url}/inference`,
			{ ...ctx, timeoutMs: ctx.timeoutMs ?? 10 * 60_000 },
			{
				body: () => {
					const form = new FormData();
					form.set(
						'file',
						new Blob([audio.bytes as Uint8Array<ArrayBuffer>], { type: audio.mime }),
						audio.name
					);
					for (const [k, v] of whisperFields(settings)) form.append(k, v);
					return form;
				}
			}
		);
		return parseWhisperReply(body);
	},

	async test(settings, ctx) {
		const url = trimUrl(settings.whisperCpp.url);
		try {
			await send(`${url}/`, { ...ctx, timeoutMs: ctx.timeoutMs ?? 5000 }, { attempts: 1 });
		} catch (e) {
			if (e instanceof TranscribeError && /answered 503/.test(e.message))
				throw new TranscribeError(`whisper.cpp at ${hostOf(url)} is still loading its model`, true);
			throw e;
		}
		return `whisper.cpp answering at ${hostOf(url)}`;
	}
};
