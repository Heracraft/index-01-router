import { fail } from '@sveltejs/kit';
import { TZ } from '$app/env/private';
import {
	envLocks,
	getStored,
	setStored,
	withEnvKeys,
	type GeneralSettings,
	type TranscribeProvider,
	type TranscriptionSettings
} from '#lib/server/settings.ts';
import { PROVIDERS, testTranscription } from '#lib/server/transcribe/index.ts';
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
	const [t, general] = await Promise.all([getStored('transcription'), getStored('general')]);
	const zones = timeZones();
	return {
		providers: PROVIDERS,
		settings: {
			provider: t.provider,
			openai: { baseUrl: t.openai.baseUrl, model: t.openai.model },
			openaiAudio: { baseUrl: t.openaiAudio.baseUrl, model: t.openaiAudio.model },
			gemini: { model: t.gemini.model },
			whisperCpp: { url: t.whisperCpp.url },
			languages: t.languages,
			prompt: t.prompt,
			chunking: t.chunking
		},
		keysSet: {
			openai: !!t.openai.apiKey,
			openaiAudio: !!t.openaiAudio.apiKey,
			gemini: !!t.gemini.apiKey
		},
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
	if (!PROVIDER_IDS.includes(provider)) errors.provider = 'Provider: pick one of the options.';

	const key = (field: string, current: string) =>
		data.get(`${field}.clear`) === '1' ? '' : str(field) || current;

	const url = (field: string, fallback: string, label: string) => {
		const v = str(field) || fallback;
		try {
			const u = new URL(v);
			if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error();
		} catch {
			errors[field] = `${label} must start with http:// or https://.`;
		}
		return v.replace(/\/+$/, '');
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
		errors.languages = `Languages: ${badLang.join(', ')} is not an ISO 639-1 code such as sw or en.`;
	}

	const settings: TranscriptionSettings = {
		provider: (PROVIDER_IDS.includes(provider) ? provider : stored.provider) as TranscribeProvider,
		openai: {
			baseUrl: url('openai.baseUrl', stored.openai.baseUrl, 'Base URL'),
			model: str('openai.model'),
			apiKey: key('openai.apiKey', stored.openai.apiKey)
		},
		openaiAudio: {
			baseUrl: url('openaiAudio.baseUrl', stored.openaiAudio.baseUrl, 'Base URL'),
			model: str('openaiAudio.model'),
			apiKey: key('openaiAudio.apiKey', stored.openaiAudio.apiKey)
		},
		gemini: {
			model: str('gemini.model'),
			apiKey: key('gemini.apiKey', stored.gemini.apiKey)
		},
		whisperCpp: { url: url('whisperCpp.url', stored.whisperCpp.url, 'Server URL') },
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
			errors.timezone = `Timezone: ${timezone} is not an IANA zone such as Africa/Nairobi.`;
		}
	}
	return { settings, timezone, errors };
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
		const signal = AbortSignal.timeout(30_000);
		try {
			const message = await testTranscription(withEnvKeys(settings), { signal });
			return { action: 'test', test: { ok: true, message } };
		} catch (e) {
			return {
				action: 'test',
				test: { ok: false, message: e instanceof Error ? e.message : String(e) }
			};
		}
	}
};
