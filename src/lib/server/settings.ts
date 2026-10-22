import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { db } from './db/index.ts';
import { settings } from './db/schema.ts';
import { decrypt, encrypt } from './crypto.ts';
import { INDEX01_WEBHOOK_SECRET, OPENAI_API_KEY, GEMINI_API_KEY } from '$app/env/private';

export type TranscribeProvider = 'openai' | 'openai-audio' | 'gemini' | 'whisper-cpp';

export interface TranscriptionSettings {
	provider: TranscribeProvider;
	/** openai: any OpenAI compatible /audio/transcriptions server (OpenAI, Groq, speaches) */
	openai: { baseUrl: string; apiKey: string; model: string };
	/** openai-audio: chat completions with input_audio, the audio is piped into an LLM */
	openaiAudio: { baseUrl: string; apiKey: string; model: string };
	gemini: { apiKey: string; model: string };
	/** whisper.cpp server, POST {url}/inference */
	whisperCpp: { url: string };
	/** ISO 639-1 hints for code switched audio, e.g. ['sw', 'en']. Empty means detect */
	languages: string[];
	/** Vocabulary and context: names, jargon */
	prompt: string;
	/** Split at pauses into chunks of at most 30 s before sending */
	chunking: boolean;
}

export interface GeneralSettings {
	/** IANA zone used for daily notes and for showing times */
	timezone: string;
}

export interface WebhookSettings {
	secret: string;
	/** Reject unsigned requests */
	requireSignature: boolean;
}

interface Shapes {
	transcription: TranscriptionSettings;
	general: GeneralSettings;
	webhook: WebhookSettings;
}

const defaults: { [K in keyof Shapes]: () => Shapes[K] } = {
	transcription: () => ({
		provider: 'openai',
		openai: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-transcribe' },
		openaiAudio: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-audio' },
		gemini: { apiKey: '', model: 'gemini-2.5-flash' },
		whisperCpp: { url: 'http://whisper:8080' },
		languages: [],
		prompt: '',
		chunking: true
	}),
	general: () => ({ timezone: process.env.TZ || 'UTC' }),
	webhook: () => ({ secret: randomBytes(32).toString('base64url'), requireSignature: true })
};

/** Paths of string fields stored encrypted */
const secretPaths: { [K in keyof Shapes]: string[] } = {
	transcription: ['openai.apiKey', 'openaiAudio.apiKey', 'gemini.apiKey'],
	general: [],
	webhook: ['secret']
};

function mapPaths(value: unknown, paths: string[], fn: (s: string) => string) {
	const copy = structuredClone(value) as Record<string, unknown>;
	for (const path of paths) {
		const keys = path.split('.');
		let node = copy;
		for (const k of keys.slice(0, -1)) node = (node?.[k] ?? {}) as Record<string, unknown>;
		const last = keys.at(-1)!;
		if (typeof node[last] === 'string' && node[last]) node[last] = fn(node[last] as string);
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

/** Stored values merged over defaults, secrets decrypted. Env overrides are NOT applied here */
export async function getStored<K extends keyof Shapes>(key: K): Promise<Shapes[K]> {
	const [row] = await db.select().from(settings).where(eq(settings.key, key));
	if (!row) {
		const value = defaults[key]();
		// Persist generated values (the webhook secret) so they stay stable
		if (key === 'webhook') await setStored(key, value);
		return value;
	}
	return merge(defaults[key](), mapPaths(row.value, secretPaths[key], decrypt)) as Shapes[K];
}

export async function setStored<K extends keyof Shapes>(key: K, value: Shapes[K]) {
	const stored = mapPaths(value, secretPaths[key], encrypt);
	await db
		.insert(settings)
		.values({ key, value: stored })
		.onConflictDoUpdate({ target: settings.key, set: { value: stored, updatedAt: new Date() } });
}

/** Fields set through the environment. The UI shows them read only */
export const envLocks = {
	webhookSecret: !!INDEX01_WEBHOOK_SECRET,
	openaiKey: !!OPENAI_API_KEY,
	geminiKey: !!GEMINI_API_KEY
};

const isOpenAI = (url: string) => {
	try {
		return /(^|\.)openai\.com$/.test(new URL(url).hostname);
	} catch {
		return false;
	}
};

/** Blank keys fall back to OPENAI_API_KEY (for openai.com base URLs) and GEMINI_API_KEY */
export function withEnvKeys(t: TranscriptionSettings): TranscriptionSettings {
	const s = structuredClone(t);
	if (!s.openai.apiKey && OPENAI_API_KEY && isOpenAI(s.openai.baseUrl)) {
		s.openai.apiKey = OPENAI_API_KEY;
	}
	if (!s.openaiAudio.apiKey && OPENAI_API_KEY && isOpenAI(s.openaiAudio.baseUrl)) {
		s.openaiAudio.apiKey = OPENAI_API_KEY;
	}
	if (!s.gemini.apiKey && GEMINI_API_KEY) s.gemini.apiKey = GEMINI_API_KEY;
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
