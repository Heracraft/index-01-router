import { beforeEach, describe, expect, it, vi } from 'vitest';

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);

const env = vi.hoisted(() => ({
	AUTH_SECRET: '',
	AUTH_SECRET_PREVIOUS: [] as string[],
	INDEX01_WEBHOOK_SECRET: undefined as string | undefined,
	OPENAI_API_KEY: undefined as string | undefined,
	GEMINI_API_KEY: undefined as string | undefined,
	TZ: 'Africa/Nairobi'
}));

vi.mock('$app/env/private', () => ({
	DATABASE_URL: 'postgres://invalid',
	get OPENAI_API_KEY() {
		return env.OPENAI_API_KEY;
	},
	get GEMINI_API_KEY() {
		return env.GEMINI_API_KEY;
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
	env.GEMINI_API_KEY = undefined;
	store.settings.clear();
	store.integrations = [];
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

async function saveUnderA() {
	const t = await settings.getStored('transcription');
	await settings.setStored('transcription', {
		...t,
		provider: 'gemini',
		openai: { ...t.openai, apiKey: 'sk-openai' },
		gemini: { ...t.gemini, apiKey: 'gm-key' }
	});
	await settings.setStored('webhook', { secret: 'old-secret', requireSignature: false });
}

describe('settings after AUTH_SECRET changes', () => {
	it('blanks keys it cannot decrypt and keeps the rest', async () => {
		await saveUnderA();
		env.AUTH_SECRET = B;
		const { value, lost } = await settings.getStoredWithStatus('transcription');
		expect(lost).toEqual(['openai.apiKey', 'gemini.apiKey']);
		expect(value.provider).toBe('gemini');
		expect(value.openai.apiKey).toBe('');
		expect(value.gemini.apiKey).toBe('');
		expect(value.openai.model).toBe('');
		await expect(settings.getSettings('transcription')).resolves.toMatchObject({
			provider: 'gemini'
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
		expect((await settings.getStored('transcription')).gemini.apiKey).toBe('gm-key');
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
	it('uses OPENAI_API_KEY and GEMINI_API_KEY while nothing is stored', async () => {
		env.OPENAI_API_KEY = 'sk-env';
		env.GEMINI_API_KEY = 'gm-env';
		const t = await settings.getSettings('transcription');
		expect(t.openai.apiKey).toBe('sk-env');
		expect(t.openaiAudio.apiKey).toBe('sk-env');
		expect(t.gemini.apiKey).toBe('gm-env');
	});

	it('prefers a key saved in the UI over the env key', async () => {
		env.OPENAI_API_KEY = 'sk-env';
		env.GEMINI_API_KEY = 'gm-env';
		const t = await settings.getStored('transcription');
		await settings.setStored('transcription', {
			...t,
			openai: { ...t.openai, apiKey: 'sk-stored' },
			gemini: { ...t.gemini, apiKey: 'gm-stored' }
		});
		const out = await settings.getSettings('transcription');
		expect(out.openai.apiKey).toBe('sk-stored');
		expect(out.gemini.apiKey).toBe('gm-stored');
		// Removing the stored key falls back to the env one
		await settings.setStored('transcription', { ...t, openai: { ...t.openai, apiKey: '' } });
		expect((await settings.getSettings('transcription')).openai.apiKey).toBe('sk-env');
	});
});

describe('model defaults', () => {
	it('stores no model, so each provider uses its defaultModel', async () => {
		const { openai } = await import('./transcribe/openai.ts');
		const { openaiAudio } = await import('./transcribe/openai-audio.ts');
		const { gemini, GEMINI_DEFAULT_MODEL } = await import('./transcribe/gemini.ts');
		const t = await settings.getStored('transcription');
		expect([t.openai.model, t.openaiAudio.model, t.gemini.model]).toEqual(['', '', '']);
		expect(openai.model(t)).toBe(openai.defaultModel);
		expect(openaiAudio.model(t)).toBe(openaiAudio.defaultModel);
		expect(gemini.model(t)).toBe(GEMINI_DEFAULT_MODEL);
	});
});
