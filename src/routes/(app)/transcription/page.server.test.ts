import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ values: new Map<string, unknown>() }));

vi.mock('$app/env/private', () => ({ TZ: 'UTC' }));
vi.mock('#lib/server/transcribe/index.ts', () => ({
	PROVIDERS: [
		{ id: 'openai', label: 'OpenAI', defaultModel: 'gpt-transcribe' },
		{ id: 'openai-audio', label: 'OpenAI audio', defaultModel: 'gpt-audio' },
		{ id: 'gemini', label: 'Gemini', defaultModel: 'gemini-default' },
		{ id: 'whisper-cpp', label: 'whisper.cpp', defaultModel: '' }
	],
	CHUNK_SECONDS: 30
}));
vi.mock('#lib/server/transcribe/probe.ts', () => ({
	probeTranscription: async () => ({ ms: 1, text: 'ok', languages: [] })
}));
vi.mock('#lib/server/settings.ts', () => {
	const transcription = () => ({
		provider: 'gemini',
		openai: { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-old', model: 'old-openai' },
		openaiAudio: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'old-audio' },
		gemini: { apiKey: '', model: 'gemini-2.5-flash' },
		whisperCpp: { url: 'http://whisper:8080' },
		languages: ['sw'],
		prompt: '',
		chunking: true
	});
	return {
		envLocks: { webhookSecret: false, openaiKey: true, geminiKey: false },
		withEnvKeys: (t: unknown) => t,
		keyReadiness: () => ({}),
		getStoredWithStatus: async (key: string) => ({
			value: structuredClone(
				store.values.get(key) ?? (key === 'transcription' ? transcription() : {})
			),
			lost: []
		}),
		getStored: async (key: string) =>
			structuredClone(store.values.get(key) ?? (key === 'transcription' ? transcription() : {})),
		setStored: async (key: string, value: unknown) => void store.values.set(key, value)
	};
});

const { actions } = await import('./+page.server.ts');

type Stored = {
	openai: { model: string; apiKey: string };
	openaiAudio: { model: string };
	gemini: { model: string };
	languages: string[];
};

function post(fields: [string, string][]) {
	const body = new FormData();
	for (const [k, v] of fields) body.append(k, v);
	const request = new Request('http://localhost/transcription?/save', { method: 'POST', body });
	return { request } as unknown as Parameters<NonNullable<typeof actions.save>>[0];
}

const base: [string, string][] = [
	['provider', 'gemini'],
	['openai.baseUrl', 'https://api.openai.com/v1'],
	['openaiAudio.baseUrl', 'https://api.openai.com/v1'],
	['whisperCpp.url', 'http://whisper:8080'],
	['languages', 'sw']
];

beforeEach(() => store.values.clear());

describe('transcription save', () => {
	it('stores a cleared model blank, so the provider default applies', async () => {
		await actions.save!(
			post([...base, ['openai.model', ''], ['openaiAudio.model', ' '], ['gemini.model', '']])
		);
		const t = store.values.get('transcription') as Stored;
		expect([t.openai.model, t.openaiAudio.model, t.gemini.model]).toEqual(['', '', '']);
	});

	it('keeps a typed model', async () => {
		await actions.save!(post([...base, ['gemini.model', ' gemini-3.8-pro ']]));
		expect((store.values.get('transcription') as Stored).gemini.model).toBe('gemini-3.8-pro');
	});

	it('saves a language typed into the box without Add', async () => {
		// The box posts as one more `languages` value
		await actions.save!(post([...base, ['languages', ' ES ']]));
		expect((store.values.get('transcription') as Stored).languages).toEqual(['sw', 'es']);
	});

	it('rejects a bad typed language and stores nothing', async () => {
		const out = await actions.save!(post([...base, ['languages', 'xx1']]));
		expect(out).toMatchObject({ status: 400, data: { errors: { languages: expect.any(String) } } });
		expect(store.values.has('transcription')).toBe(false);
	});

	it('stores a key typed over an env-supplied one', async () => {
		await actions.save!(post([...base, ['openai.apiKey', 'sk-ui']]));
		expect((store.values.get('transcription') as Stored).openai.apiKey).toBe('sk-ui');
	});
});
