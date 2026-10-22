import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { db } from './db/index.ts';
import { integrations, settings } from './db/schema.ts';
import { decryptWithStatus, encrypt, isEncrypted } from './crypto.ts';
import { AUTH_SECRET_PREVIOUS, INDEX01_WEBHOOK_SECRET, OPENAI_API_KEY, TZ } from '$app/env/private';

export const TRANSCRIBE_PROVIDERS = ['openai', 'openai-audio', 'whisper-cpp'] as const;
export type TranscribeProvider = (typeof TRANSCRIBE_PROVIDERS)[number];

export interface TranscriptionSettings {
	provider: TranscribeProvider;
	/** openai: any OpenAI compatible /audio/transcriptions server (OpenAI, Groq, speaches) */
	openai: { baseUrl: string; apiKey: string; model: string };
	/** openai-audio: chat completions with input_audio, the audio is piped into an LLM */
	openaiAudio: { baseUrl: string; apiKey: string; model: string };
	/** whisper.cpp server hosted separately, POST {url}/inference. Blank until set */
	whisperCpp: { url: string };
	/** ISO 639-1 hints for code switched audio, e.g. ['sw', 'en']. Empty means detect */
	languages: string[];
	/** Vocabulary and context: names, jargon */
	prompt: string;
	/** Split at pauses into chunks of at most 30 s before sending */
	chunking: boolean;
}

export interface GeneralSettings {
	/** IANA zone used for daily notes and for showing times. Stored only when it differs from TZ */
	timezone: string;
}

export interface WebhookSettings {
	secret: string;
	/** Reject unsigned requests */
	requireSignature: boolean;
	/** AUTH_SECRET changed and a new secret replaced the lost one. Cleared on reveal or rotate */
	secretReset?: boolean;
	/** ISO time of the last Rotate, to tell whether the app has sent with the new secret since */
	rotatedAt?: string;
}

export interface SessionSettings {
	/** Sessions signed with an older epoch are rejected. Bumped by "Sign out everywhere" */
	epoch: number;
}

interface Shapes {
	transcription: TranscriptionSettings;
	general: GeneralSettings;
	webhook: WebhookSettings;
	session: SessionSettings;
}

/** What setStored accepts: general may leave out the timezone to follow TZ */
type Stored = Omit<Shapes, 'general'> & { general: Partial<GeneralSettings> };

const defaults: { [K in keyof Shapes]: () => Shapes[K] } = {
	transcription: () => ({
		provider: 'openai',
		// Blank models follow each provider's defaultModel, so a new default reaches old installs
		openai: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: '' },
		openaiAudio: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: '' },
		whisperCpp: { url: '' },
		languages: [],
		prompt: '',
		chunking: true
	}),
	general: () => ({ timezone: TZ || 'UTC' }),
	webhook: () => ({ secret: newWebhookSecret(), requireSignature: true }),
	session: () => ({ epoch: 0 })
};

export const newWebhookSecret = () => randomBytes(32).toString('base64url');

/** Paths of string fields stored encrypted */
const secretPaths: { [K in keyof Shapes]: string[] } = {
	transcription: ['openai.apiKey', 'openaiAudio.apiKey'],
	general: [],
	webhook: ['secret'],
	session: []
};

/** Names of encrypted fields, for messages about keys that need entering again */
export const SECRET_LABELS: Record<string, string> = {
	'openai.apiKey': 'OpenAI key',
	'openaiAudio.apiKey': 'OpenAI audio key',
	secret: 'webhook signing secret'
};

function mapPaths(value: unknown, paths: string[], fn: (s: string, path: string) => string) {
	const copy = structuredClone(value) as Record<string, unknown>;
	for (const path of paths) {
		const keys = path.split('.');
		let node = copy;
		for (const k of keys.slice(0, -1)) node = (node?.[k] ?? {}) as Record<string, unknown>;
		const last = keys.at(-1)!;
		if (typeof node[last] === 'string' && node[last]) node[last] = fn(node[last] as string, path);
	}
	return copy;
}

function merge<T>(base: T, over: unknown): T {
	if (!over || typeof over !== 'object' || Array.isArray(over)) return (over ?? base) as T;
	const out = { ...base } as Record<string, unknown>;
	for (const [k, v] of Object.entries(over)) {
		const b = (base as Record<string, unknown>)[k];
		out[k] = b && typeof b === 'object' && !Array.isArray(b) ? merge(b, v) : v;
	}
	return out as T;
}

async function writeRow(key: string, value: unknown) {
	await db
		.insert(settings)
		.values({ key, value })
		.onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

const warned = new Set<string>();

let webhookReset: Promise<Record<string, unknown>> | undefined;

/** One new secret even when several requests find the old one unreadable at once */
function resetWebhookSecret(raw: Record<string, unknown>) {
	return (webhookReset ??= (async () => {
		const next = { ...raw, secret: newWebhookSecret(), secretReset: !INDEX01_WEBHOOK_SECRET };
		await writeRow('webhook', mapPaths(next, secretPaths.webhook, encrypt));
		console.warn('AUTH_SECRET changed: generated a new webhook signing secret');
		return next;
	})().finally(() => (webhookReset = undefined)));
}

/**
 * Stored values merged over defaults, secrets decrypted. Env overrides are NOT applied here.
 * `lost` lists encrypted fields no key in AUTH_SECRET or AUTH_SECRET_PREVIOUS opens. They read
 * as blank and stay so until saved again. A lost webhook secret is replaced at once.
 */
export async function getStoredWithStatus<K extends keyof Shapes>(
	key: K
): Promise<{ value: Shapes[K]; lost: string[] }> {
	const [row] = await db.select().from(settings).where(eq(settings.key, key));
	if (!row) {
		const value = defaults[key]();
		// Persist generated values (the webhook secret) so they stay stable
		if (key === 'webhook') await setStored(key, value);
		return { value, lost: [] };
	}
	const lost: string[] = [];
	let stale = false;
	let raw = mapPaths(row.value, secretPaths[key], (s, path) => {
		try {
			const r = decryptWithStatus(s);
			stale ||= r.stale;
			return r.plain;
		} catch {
			lost.push(path);
			return '';
		}
	});
	if (stale) {
		// Opened with an AUTH_SECRET_PREVIOUS key: store it again under AUTH_SECRET. Lost fields
		// keep their old ciphertext, in case the right key is added later
		await writeRow(
			key,
			mapPaths(row.value, secretPaths[key], (s, path) =>
				lost.includes(path) ? s : encrypt(decryptWithStatus(s).plain)
			)
		);
	}
	if (lost.length) {
		const message = `AUTH_SECRET changed: cannot decrypt ${key} ${lost.join(', ')}`;
		if (!warned.has(message)) console.warn(message);
		warned.add(message);
		if (key === 'webhook') raw = await resetWebhookSecret(raw);
	}
	const value = merge(defaults[key](), raw) as Shapes[K];
	if (key === 'transcription')
		return { value: cleanTranscription(value as TranscriptionSettings) as Shapes[K], lost };
	return { value, lost };
}

/**
 * Rows from older versions can name a provider that is gone (gemini) and carry its fields. The
 * provider falls back to the default and unknown top-level fields are dropped
 */
function cleanTranscription(t: TranscriptionSettings): TranscriptionSettings {
	const base = defaults.transcription();
	const out = Object.fromEntries(
		Object.entries(t).filter(([k]) => Object.hasOwn(base, k))
	) as unknown as TranscriptionSettings;
	if (!(TRANSCRIBE_PROVIDERS as readonly string[]).includes(out.provider)) {
		out.provider = base.provider;
	}
	return out;
}

export async function getStored<K extends keyof Shapes>(key: K): Promise<Shapes[K]> {
	return (await getStoredWithStatus(key)).value;
}

export async function setStored<K extends keyof Shapes>(key: K, value: Stored[K]) {
	await writeRow(key, mapPaths(value, secretPaths[key], encrypt));
	if (key === 'session') epoch = Promise.resolve((value as SessionSettings).epoch);
}

let epoch: Promise<number> | undefined;

/** Current session epoch, read from the database once and then kept in memory */
export function sessionEpoch(): Promise<number> {
	return (epoch ??= getStored('session')
		.then((s) => s.epoch)
		.catch((e) => {
			epoch = undefined;
			throw e;
		}));
}

/** Invalidates every session signed so far */
export async function bumpSessionEpoch() {
	const { epoch: current } = await getStored('session');
	await setStored('session', { epoch: current + 1 });
}

/**
 * With AUTH_SECRET_PREVIOUS set, stores every value an earlier key encrypted again under
 * AUTH_SECRET: settings rows and integration configs. Runs at start, so the old key can go after.
 */
export async function reencryptStored() {
	if (!AUTH_SECRET_PREVIOUS?.length) return;
	const rows = await db.select({ key: settings.key }).from(settings);
	for (const { key } of rows) {
		if (key in defaults) await getStoredWithStatus(key as keyof Shapes);
	}
	for (const row of await db.select().from(integrations)) {
		let changed = false;
		const config = { ...row.config };
		for (const [k, v] of Object.entries(config)) {
			if (!isEncrypted(v)) continue;
			try {
				const r = decryptWithStatus(v as string);
				if (r.stale) {
					config[k] = encrypt(r.plain);
					changed = true;
				}
			} catch {
				// Unreadable under every key: the integration page asks for it again
			}
		}
		if (changed) {
			await db
				.update(integrations)
				.set({ config, updatedAt: new Date() })
				.where(eq(integrations.id, row.id));
		}
	}
}

/**
 * Fields set through the environment. The webhook secret is locked: INDEX01_WEBHOOK_SECRET wins.
 * The transcription keys are fallbacks, used only while no key is stored
 */
export const envLocks = {
	webhookSecret: !!INDEX01_WEBHOOK_SECRET,
	openaiKey: !!OPENAI_API_KEY
};

const isOpenAI = (url: string) => {
	try {
		return /(^|\.)openai\.com$/.test(new URL(url).hostname);
	} catch {
		return false;
	}
};

/** Blank keys fall back to OPENAI_API_KEY, for openai.com base URLs */
export function withEnvKeys(t: TranscriptionSettings): TranscriptionSettings {
	const s = structuredClone(t);
	if (!s.openai.apiKey && OPENAI_API_KEY && isOpenAI(s.openai.baseUrl)) {
		s.openai.apiKey = OPENAI_API_KEY;
	}
	if (!s.openaiAudio.apiKey && OPENAI_API_KEY && isOpenAI(s.openaiAudio.baseUrl)) {
		s.openaiAudio.apiKey = OPENAI_API_KEY;
	}
	return s;
}

/** Effective settings: stored values with env fallbacks applied */
export async function getSettings<K extends keyof Shapes>(key: K): Promise<Shapes[K]> {
	const value = await getStored(key);
	if (key === 'webhook' && INDEX01_WEBHOOK_SECRET) {
		(value as WebhookSettings).secret = INDEX01_WEBHOOK_SECRET;
	}
	if (key === 'transcription') return withEnvKeys(value as TranscriptionSettings) as Shapes[K];
	return value;
}

export type KeyReadiness = 'ok' | 'lost' | 'missing' | null;

/** Path of each provider's key in TranscriptionSettings, and the field id on /transcription */
export const PROVIDER_KEYS: Record<TranscribeProvider, { path: string; field: string } | null> = {
	openai: { path: 'openai.apiKey', field: 'openai-key' },
	'openai-audio': { path: 'openaiAudio.apiKey', field: 'audio-key' },
	'whisper-cpp': null
};

/**
 * Whether each provider has a key it can use: stored or from the environment (ok), stored but
 * unreadable after an AUTH_SECRET change (lost), or none where one is needed (missing). Null for
 * providers that take no key, and for self-hosted OpenAI compatible servers without one.
 */
export function keyReadiness(
	t: TranscriptionSettings,
	lost: string[]
): Record<TranscribeProvider, KeyReadiness> {
	const effective = withEnvKeys(t);
	const one = (key: string, path: string, needsKey: boolean): KeyReadiness =>
		key ? 'ok' : lost.includes(path) ? 'lost' : needsKey ? 'missing' : null;
	return {
		openai: one(effective.openai.apiKey, 'openai.apiKey', isOpenAI(t.openai.baseUrl)),
		'openai-audio': one(
			effective.openaiAudio.apiKey,
			'openaiAudio.apiKey',
			isOpenAI(t.openaiAudio.baseUrl)
		),
		'whisper-cpp': null
	};
}
