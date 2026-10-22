import {
	getSettings,
	getStored,
	getStoredWithStatus,
	keyReadiness,
	PROVIDER_KEYS,
	SECRET_LABELS
} from '#lib/server/settings.ts';
import { integrationsWithLostSecrets } from '#lib/server/integrations/index.ts';
import { PROVIDERS } from '#lib/server/transcribe/index.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	const [general, { value: transcription, lost }, webhook, lostIntegrations] = await Promise.all([
		getSettings('general'),
		getStoredWithStatus('transcription'),
		getStored('webhook'),
		integrationsWithLostSecrets()
	]);
	const provider = PROVIDERS.find((p) => p.id === transcription.provider);
	const model =
		transcription.provider === 'openai'
			? transcription.openai.model
			: transcription.provider === 'openai-audio'
				? transcription.openaiAudio.model
				: transcription.provider === 'gemini'
					? transcription.gemini.model
					: '';
	return {
		user: { email: locals.session?.email ?? null, name: locals.session?.name ?? null },
		timezone: general.timezone,
		provider: {
			label: provider?.label ?? transcription.provider,
			model: model.trim() || provider?.defaultModel || '',
			ready: keyReadiness(transcription, lost)[transcription.provider] ?? null
		},
		// AUTH_SECRET changed: these stored secrets are gone and need entering again
		lostKeys: lost.map((p) => ({
			label: SECRET_LABELS[p] ?? p,
			field: Object.values(PROVIDER_KEYS).find((k) => k?.path === p)?.field ?? ''
		})),
		lostIntegrations,
		webhookSecretReset: !!webhook.secretReset
	};
};
