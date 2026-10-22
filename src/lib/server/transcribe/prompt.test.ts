import { describe, expect, it } from 'vitest';
import {
	llmInstructions,
	normalizeLanguage,
	normalizeLanguages,
	parseLlmTranscript,
	sanitizePrompt
} from './prompt.ts';

describe('normalizeLanguage', () => {
	it.each([
		['en', 'en'],
		['EN-us', 'en'],
		['english', 'en'],
		['Swahili', 'sw'],
		['spanish', 'es'],
		['castilian', 'es'],
		['swa', 'sw'],
		['eng', 'en'],
		[{ code: 'fr' }, 'fr'],
		['maori', 'mi'],
		['Māori', 'mi'],
		['Bengali', 'bn'],
		['nynorsk', 'nn'],
		['myanmar', 'my'],
		['tagalog', 'tl'],
		['hawaiian', 'haw'],
		['klingonese', null],
		['', null],
		[42, null]
	])('%j -> %j', (input, out) => {
		expect(normalizeLanguage(input)).toBe(out);
	});

	it('knows every language name Whisper returns', () => {
		// whisper/tokenizer.py LANGUAGES
		const whisper =
			'english chinese german spanish russian korean french japanese portuguese turkish polish catalan dutch arabic swedish italian indonesian hindi finnish vietnamese hebrew ukrainian greek malay czech romanian danish hungarian tamil norwegian thai urdu croatian bulgarian lithuanian latin maori malayalam welsh slovak telugu persian latvian bengali serbian azerbaijani slovenian kannada estonian macedonian breton basque icelandic armenian nepali mongolian bosnian kazakh albanian swahili galician marathi punjabi sinhala khmer shona yoruba somali afrikaans occitan georgian belarusian tajik sindhi gujarati amharic yiddish lao uzbek faroese haitian_creole pashto turkmen nynorsk maltese sanskrit luxembourgish myanmar tibetan tagalog malagasy assamese tatar hawaiian lingala hausa bashkir javanese sundanese cantonese'
				.split(' ')
				.map((n) => n.replace('_', ' '));
		expect(whisper).toHaveLength(100);
		expect(whisper.filter((n) => normalizeLanguage(n) === null)).toEqual([]);
	});

	it('dedupes lists', () => {
		expect(normalizeLanguages(['en', 'English', 'sw', null])).toEqual(['en', 'sw']);
		expect(normalizeLanguages('es')).toEqual(['es']);
	});
});

describe('parseLlmTranscript', () => {
	it('reads plain JSON', () => {
		expect(parseLlmTranscript('{"text":" Habari, hello ","languages":["sw","English"]}')).toEqual({
			text: 'Habari, hello',
			languages: ['sw', 'en']
		});
	});
	it('reads JSON in a code fence', () => {
		expect(parseLlmTranscript('```json\n{"text":"Hola","languages":["es"]}\n```').text).toBe(
			'Hola'
		);
	});
	it('reads JSON with text around it', () => {
		expect(
			parseLlmTranscript('Here is the transcript: {"text":"Sawa","language":"sw"} Done.')
		).toEqual({ text: 'Sawa', languages: ['sw'] });
	});
	it('salvages truncated JSON', () => {
		expect(parseLlmTranscript('{"text":"Nimechoka sana \\"leo\\", lakini')).toEqual({
			text: 'Nimechoka sana "leo", lakini',
			languages: []
		});
	});
	it('falls back to the raw reply', () => {
		expect(parseLlmTranscript('Just words.')).toEqual({ text: 'Just words.', languages: [] });
	});
});

describe('prompts', () => {
	it('strips characters OpenAI rejects in prompt', () => {
		expect(sanitizePrompt('Names: <Amina>\r\nJuma,  Lucía')).toBe('Names: Amina Juma, Lucía');
	});
	it('names hinted languages and vocabulary', () => {
		const s = llmInstructions({ languages: ['sw', 'en'], prompt: 'Amina, Juma' });
		expect(s).toContain('Swahili (sw), English (en)');
		expect(s).toContain('Amina, Juma');
		expect(s).toContain('Never translate');
	});
});
