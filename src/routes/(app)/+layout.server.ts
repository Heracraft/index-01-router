import {
	getSettings,
	getStored,
	getStoredWithStatus,
	PROVIDER_KEYS,
	SECRET_LABELS
} from '#lib/server/settings.ts';
import { integrationsWithLostSecrets } from '#lib/server/integrations/index.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
	const [general, { lost }, webhook, lostIntegrations] = await Promise.all([
		getSettings('general'),
		getStoredWithStatus('transcription'),
		getStored('webhook'),
		integrationsWithLostSecrets()
	]);
	return {
		/** The theme picked on this device, mirrored from localStorage into a cookie */
		theme: ((t) => (t === 'light' || t === 'dark' ? t : 'system'))(cookies.get('hk-theme')) as
			'system' | 'light' | 'dark',
		user: { email: locals.session?.email ?? null, name: locals.session?.name ?? null },
		timezone: general.timezone,
		// AUTH_SECRET changed: these stored secrets are gone and need entering again
		lostKeys: lost.map((p) => ({
			label: SECRET_LABELS[p] ?? p,
			field: Object.values(PROVIDER_KEYS).find((k) => k?.path === p)?.field ?? ''
		})),
		lostIntegrations,
		webhookSecretReset: !!webhook.secretReset
	};
};
