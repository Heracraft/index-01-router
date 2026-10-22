import { beforeEach, describe, expect, it, vi } from 'vitest';

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);

const env = vi.hoisted(() => ({
	AUTH_SECRET: '',
	AUTH_SECRET_PREVIOUS: [] as string[],
	INDEX01_WEBHOOK_SECRET: undefined as string | undefined,
	OPENAI_API_KEY: undefined as string | undefined,
	TZ: 'Africa/Nairobi'
}));

vi.mock('$app/env/private', () => ({
	DATABASE_URL: 'postgres://invalid',
	get OPENAI_API_KEY() {
		return env.OPENAI_API_KEY;
	},
	get AUTH_SECRET() {
		return env.AUTH_SECRET;
	},
	get AUTH_SECRET_PREVIOUS() {
		return env.AUTH_SECRET_PREVIOUS;
	},
	get INDEX01_WEBHOOK_SECRET() {
		return env.INDEX01_WEBHOOK_SECRET;
	},
	get TZ() {
		return env.TZ;
	}
}));

// eq() returns something the fake database below can read
vi.mock('drizzle-orm', async (orig) => ({
	...(await orig<typeof import('drizzle-orm')>()),
	eq: (_column: unknown, value: unknown) => ({ value })
}));

const store = vi.hoisted(() => ({
	settings: new Map<string, unknown>(),
	integrations: [] as { id: string; config: Record<string, unknown> }[]
}));

vi.mock('./db/index.ts', async () => {
	const schema = await import('./db/schema.ts');
	const rowsOf = (table: unknown) =>
		table === schema.settings
			? [...store.settings].map(([key, value]) => ({ key, value: structuredClone(value) }))
			: store.integrations.map((r) => structuredClone(r));
	return {
		db: {
			select: () => ({
				from: (table: unknown) =>
					Object.assign(Promise.resolve(rowsOf(table)), {
						where: async (c: { value: unknown }) =>
							rowsOf(table).filter((r) => ('key' in r ? r.key : r.id) === c.value)
					})
			}),
			insert: () => ({
				values: (v: { key: string; value: unknown }) => ({
					onConflictDoUpdate: async () => void store.settings.set(v.key, structuredClone(v.value))
				})
			}),
			update: () => ({
				set: (v: { config: Record<string, unknown> }) => ({
					where: async (c: { value: unknown }) => {
						const row = store.integrations.find((r) => r.id === c.value);
						if (row) row.config = structuredClone(v.config);
					}
				})
			})
		}
	};
});

const settings = await import('./settings.ts');
const { encrypt, decrypt, isEncrypted } = await import('./crypto.ts');

beforeEach(() => {
	env.AUTH_SECRET = A;
	env.AUTH_SECRET_PREVIOUS = [];
	env.INDEX01_WEBHOOK_SECRET = undefined;
	env.OPENAI_API_KEY = undefined;
	store.settings.clear();
	store.integrations = [];
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

async function saveUnderA() {
	const t = await settings.getStored('transcription');
	await settings.setStored('transcription', {
		...t,
		provider: 'openai-audio',
		openai: { ...t.openai, apiKey: 'sk-openai' },
		openaiAudio: { ...t.openaiAudio, apiKey: 'sk-audio' }
	});
	await settings.setStored('webhook', { secret: 'old-secret', requireSignature: false });
}

describe('settings after AUTH_SECRET changes', () => {
	it('blanks keys it cannot decrypt and keeps the rest', async () => {
		await saveUnderA();
		env.AUTH_SECRET = B;
		const { value, lost } = await settings.getStoredWithStatus('transcription');
		expect(lost).toEqual(['openai.apiKey', 'openaiAudio.apiKey']);
		expect(value.provider).toBe('openai-audio');
		expect(value.openai.apiKey).toBe('');
		expect(value.openaiAudio.apiKey).toBe('');
		expect(value.openai.model).toBe('');
		await expect(settings.getSettings('transcription')).resolves.toMatchObject({
			provider: 'openai-audio'
		});
	});

	it('replaces a lost webhook secret once and flags it', async () => {
		await saveUnderA();
		env.AUTH_SECRET = B;
		const [a, b] = await Promise.all([
			settings.getSettings('webhook'),
			settings.getSettings('webhook')
		]);
		expect(a.secret).toHaveLength(43);
		expect(b.secret).toBe(a.secret);
		expect(a.secretReset).toBe(true);
		expect(a.requireSignature).toBe(false);
		const stored = store.settings.get('webhook') as { secret: string };
		expect(decrypt(stored.secret)).toBe(a.secret);
		expect((await settings.getStoredWithStatus('webhook')).lost).toEqual([]);
	});

	it('does not flag a replaced secret that INDEX01_WEBHOOK_SECRET overrides', async () => {
		await saveUnderA();
		env.AUTH_SECRET = B;
		env.INDEX01_WEBHOOK_SECRET = 'from-env';
		const w = await settings.getSettings('webhook');
		expect(w.secret).toBe('from-env');
		expect(w.secretReset).toBe(false);
	});

	it('reads with AUTH_SECRET_PREVIOUS and stores again under the new key', async () => {
		await saveUnderA();
		env.AUTH_SECRET = B;
		env.AUTH_SECRET_PREVIOUS = [A];
		const { value, lost } = await settings.getStoredWithStatus('transcription');
		expect(lost).toEqual([]);
		expect(value.openai.apiKey).toBe('sk-openai');
		env.AUTH_SECRET_PREVIOUS = [];
		expect((await settings.getStored('transcription')).openaiAudio.apiKey).toBe('sk-audio');
	});

	it('re-encrypts settings and integration configs at start', async () => {
		await saveUnderA();
		store.integrations = [{ id: 'i1', config: { url: 'http://o', apiKey: encrypt('ob-key') } }];
		env.AUTH_SECRET = B;
		env.AUTH_SECRET_PREVIOUS = [A];
		await settings.reencryptStored();
		env.AUTH_SECRET_PREVIOUS = [];
		const apiKey = store.integrations[0].config.apiKey;
		expect(isEncrypted(apiKey)).toBe(true);
		expect(decrypt(apiKey as string)).toBe('ob-key');
		expect(store.integrations[0].config.url).toBe('http://o');
		expect((await settings.getStored('webhook')).secret).toBe('old-secret');
		expect((await settings.getStored('transcription')).openai.apiKey).toBe('sk-openai');
	});
});

describe('general settings', () => {
	it('follows TZ until a zone is stored', async () => {
		expect((await settings.getStored('general')).timezone).toBe('Africa/Nairobi');
		await settings.setStored('general', {});
		expect((await settings.getStored('general')).timezone).toBe('Africa/Nairobi');
		await settings.setStored('general', { timezone: 'Europe/Berlin' });
		expect((await settings.getStored('general')).timezone).toBe('Europe/Berlin');
	});
});

describe('session epoch', () => {
	it('starts at 0 and bumps', async () => {
		expect(await settings.sessionEpoch()).toBe(0);
		await settings.bumpSessionEpoch();
		expect(await settings.sessionEpoch()).toBe(1);
		expect(store.settings.get('session')).toEqual({ epoch: 1 });
	});
});

describe('env keys are fallbacks', () => {
	it('uses OPENAI_API_KEY while nothing is stored', async () => {
		env.OPENAI_API_KEY = 'sk-env';
		const t = await settings.getSettings('transcription');
		expect(t.openai.apiKey).toBe('sk-env');
		expect(t.openaiAudio.apiKey).toBe('sk-env');
	});

	it('prefers a key saved in the UI over the env key', async () => {
		env.OPENAI_API_KEY = 'sk-env';
		const t = await settings.getStored('transcription');
		await settings.setStored('transcription', {
			...t,
			openai: { ...t.openai, apiKey: 'sk-stored' }
		});
		const out = await settings.getSettings('transcription');
		expect(out.openai.apiKey).toBe('sk-stored');
		expect(out.openaiAudio.apiKey).toBe('sk-env');
		// Removing the stored key falls back to the env one
		await settings.setStored('transcription', { ...t, openai: { ...t.openai, apiKey: '' } });
		expect((await settings.getSettings('transcription')).openai.apiKey).toBe('sk-env');
	});
});

describe('model defaults', () => {
	it('stores no model, so each provider uses its defaultModel', async () => {
		const { openai } = await import('./transcribe/openai.ts');
		const { openaiAudio } = await import('./transcribe/openai-audio.ts');
		const t = await settings.getStored('transcription');
		expect([t.openai.model, t.openaiAudio.model]).toEqual(['', '']);
		expect(openai.model(t)).toBe(openai.defaultModel);
		expect(openaiAudio.model(t)).toBe(openaiAudio.defaultModel);
	});

	it('has no whisper.cpp URL until one is set', async () => {
		expect((await settings.getStored('transcription')).whisperCpp.url).toBe('');
	});
});

describe('rows from versions with the gemini provider', () => {
	it('load with the default provider and without the gemini fields', async () => {
		store.settings.set('transcription', {
			provider: 'gemini',
			openai: { baseUrl: 'https://api.openai.com/v1', apiKey: encrypt('sk-openai'), model: '' },
			gemini: { apiKey: encrypt('gm-key'), model: 'gemini-3.8-flash' },
			whisperCpp: { url: 'http://whisper:8080' },
			languages: ['sw'],
			prompt: '',
			chunking: true
		});
		const { value, lost } = await settings.getStoredWithStatus('transcription');
		expect(lost).toEqual([]);
		expect(value.provider).toBe('openai');
		expect(value).not.toHaveProperty('gemini');
		expect(value.openai.apiKey).toBe('sk-openai');
		expect(value.languages).toEqual(['sw']);
		expect(settings.keyReadiness(value, lost)).toEqual({
			openai: 'ok',
			'openai-audio': 'missing',
			'whisper-cpp': null
		});
	});

	it('keep a known provider', async () => {
		store.settings.set('transcription', { provider: 'whisper-cpp', gemini: { apiKey: '' } });
		const value = await settings.getStored('transcription');
		expect(value.provider).toBe('whisper-cpp');
		expect(Object.keys(value).sort()).toEqual(
			['chunking', 'languages', 'openai', 'openaiAudio', 'prompt', 'provider', 'whisperCpp'].sort()
		);
	});
});
