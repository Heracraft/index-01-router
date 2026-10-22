import { fail } from '@sveltejs/kit';
import { TZ } from '$app/env/private';
import {
	envLocks,
	getStored,
	getStoredWithStatus,
	keyReadiness,
	setStored,
	withEnvKeys,
	type GeneralSettings,
	type TranscribeProvider,
	type TranscriptionSettings
} from '#lib/server/settings.ts';
import { CHUNK_SECONDS, PROVIDERS } from '#lib/server/transcribe/index.ts';
import { probeTranscription } from '#lib/server/transcribe/probe.ts';
import { isLanguageCode } from '#lib/format.ts';
import type { Actions, PageServerLoad } from './$types';

function timeZones() {
	try {
		return Intl.supportedValuesOf('timeZone');
	} catch {
		return ['UTC'];
	}
}

export const load: PageServerLoad = async () => {
	const [{ value: t, lost }, general] = await Promise.all([
		getStoredWithStatus('transcription'),
		getStored('general')
	]);
	const zones = timeZones();
	return {
		providers: PROVIDERS,
		settings: {
			provider: t.provider,
			openai: { baseUrl: t.openai.baseUrl, model: t.openai.model },
			openaiAudio: { baseUrl: t.openaiAudio.baseUrl, model: t.openaiAudio.model },
			whisperCpp: { url: t.whisperCpp.url },
			languages: t.languages,
			prompt: t.prompt,
			chunking: t.chunking
		},
		keysSet: {
			openai: !!t.openai.apiKey,
			openaiAudio: !!t.openaiAudio.apiKey
		},
		// Stored, but AUTH_SECRET no longer opens them
		keysLost: {
			openai: lost.includes('openai.apiKey'),
			openaiAudio: lost.includes('openaiAudio.apiKey')
		},
		ready: keyReadiness(t, lost),
		chunkSeconds: CHUNK_SECONDS,
		envLocks,
		generalTimezone: general.timezone,
		envTimezone: TZ,
		timeZones: zones.includes(general.timezone) ? zones : [general.timezone, ...zones]
	};
};

const PROVIDER_IDS = PROVIDERS.map((p) => p.id) as string[];
type Errors = Record<string, string>;

/**
 * Form fields over the stored settings. Blank keys keep the stored key; `<key>.clear` drops it.
 * A blank model is stored blank, so the provider's default applies
 */
async function readForm(request: Request) {
	const data = await request.formData();
	const stored = await getStored('transcription');
	const str = (k: string) => String(data.get(k) ?? '').trim();
	const errors: Errors = {};

	const provider = str('provider');
	if (!PROVIDER_IDS.includes(provider)) errors.provider = 'Pick one of the providers.';

	const key = (field: string, current: string) =>
		data.get(`${field}.clear`) === '1' ? '' : str(field) || current;

	const url = (field: string, fallback: string) => {
		const v = str(field) || fallback;
		try {
			const u = new URL(v);
			if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error();
		} catch {
			errors[field] = 'Must start with http:// or https://.';
		}
		return v.replace(/\/+$/, '');
	};

	// The whisper.cpp server is hosted separately and has no default: blank until the provider
	// is whisper.cpp, then required. A form without the field keeps the stored URL
	const whisperUrl = () => {
		const field = 'whisperCpp.url';
		const v = data.has(field) ? str(field) : stored.whisperCpp.url;
		if (v) return url(field, v);
		if (provider === 'whisper-cpp') errors[field] = 'Required.';
		return '';
	};

	const languages = [
		...new Set(
			data
				.getAll('languages')
				.map((v) => String(v).trim().toLowerCase())
				.filter(Boolean)
		)
	];
	const badLang = languages.filter((l) => !isLanguageCode(l));
	if (badLang.length) {
		errors.languages = `${badLang.join(', ')} is not an ISO 639-1 code such as sw or en.`;
	}

	const settings: TranscriptionSettings = {
		provider: (PROVIDER_IDS.includes(provider) ? provider : stored.provider) as TranscribeProvider,
		openai: {
			baseUrl: url('openai.baseUrl', stored.openai.baseUrl),
			model: str('openai.model'),
			apiKey: key('openai.apiKey', stored.openai.apiKey)
		},
		openaiAudio: {
			baseUrl: url('openaiAudio.baseUrl', stored.openaiAudio.baseUrl),
			model: str('openaiAudio.model'),
			apiKey: key('openaiAudio.apiKey', stored.openaiAudio.apiKey)
		},
		whisperCpp: { url: whisperUrl() },
		languages: badLang.length ? stored.languages : languages,
		prompt: String(data.get('prompt') ?? '').replace(/\r\n?/g, '\n'),
		chunking: data.get('chunking') === 'on'
	};

	const timezone = str('timezone');
	const zones = timeZones();
	if (timezone && !zones.includes(timezone)) {
		try {
			new Intl.DateTimeFormat('en-US', { timeZone: timezone });
		} catch {
			errors.timezone = `${timezone} is not an IANA zone such as Africa/Nairobi.`;
		}
	}
	return { settings, timezone, errors };
}

/** The form field a provider error is about: the key, the URL, or the model */
function fieldOf(provider: TranscribeProvider, message: string): string | null {
	const prefix =
		provider === 'openai' ? 'openai' : provider === 'openai-audio' ? 'openaiAudio' : 'whisperCpp';
	if (/Key rejected|No API key/i.test(message))
		return provider === 'whisper-cpp' ? null : `${prefix}.apiKey`;
	if (/not offered|model/i.test(message) && provider !== 'whisper-cpp') return `${prefix}.model`;
	if (/Could not reach|Not a URL|did not answer|answered 404|server URL/i.test(message))
		return provider === 'whisper-cpp' ? 'whisperCpp.url' : `${prefix}.baseUrl`;
	return null;
}

export const actions: Actions = {
	save: async ({ request }) => {
		const { settings, timezone, errors } = await readForm(request);
		if (Object.keys(errors).length) return fail(400, { action: 'save', errors });
		await setStored('transcription', settings);
		if (timezone) {
			// Store the zone only as an override, so a later change to TZ still applies
			const general: Partial<GeneralSettings> = await getStored('general');
			if (timezone === TZ) delete general.timezone;
			else general.timezone = timezone;
			await setStored('general', general);
		}
		return { action: 'save', saved: true };
	},
	test: async ({ request }) => {
		const { settings, errors } = await readForm(request);
		if (Object.keys(errors).length) return fail(400, { action: 'test', errors });
		const signal = AbortSignal.timeout(60_000);
		try {
			const r = await probeTranscription(withEnvKeys(settings), { signal });
			return { action: 'test', test: { ok: true as const, ...r } };
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			return {
				action: 'test',
				test: { ok: false as const, message, field: fieldOf(settings.provider, message) }
			};
		}
	}
};
