import { randomBytes } from 'node:crypto';
import { fail } from '@sveltejs/kit';
import { PUBLIC_URL } from '$app/env/private';
import { envLocks, getSettings, getStored, setStored } from '#lib/server/settings.ts';
import { listWebhookEvents } from '#lib/server/webhook-log.ts';
import type { Actions, PageServerLoad } from './$types';

const PATH = '/api/index01/webhook';

export const load: PageServerLoad = async ({ url }) => {
	const [settings, events] = await Promise.all([getSettings('webhook'), listWebhookEvents(50)]);
	const origin = (PUBLIC_URL ?? url.origin).replace(/\/+$/, '');
	return {
		webhookUrl: origin + PATH,
		secretLocked: envLocks.webhookSecret,
		// Masked until Reveal: the last 4 characters identify it against the app's copy
		secretHint: settings.secret.slice(-4),
		requireSignature: settings.requireSignature,
		events: events.map((e) => ({
			id: e.id,
			at: e.at,
			status: e.status,
			reason: e.reason,
			deliveryId: e.deliveryId,
			trigger: e.trigger,
			signed: e.signed,
			test: e.test,
			bytes: e.bytes,
			recordingId: e.recordingId
		}))
	};
};

export const actions: Actions = {
	reveal: async () => {
		const { secret } = await getSettings('webhook');
		return { action: 'reveal', secret };
	},
	rotate: async () => {
		if (envLocks.webhookSecret) {
			return fail(409, {
				action: 'rotate',
				error: 'INDEX01_WEBHOOK_SECRET sets the secret. Change it there.'
			});
		}
		const stored = await getStored('webhook');
		const secret = randomBytes(32).toString('base64url');
		await setStored('webhook', { ...stored, secret });
		return { action: 'rotate', secret };
	},
	signature: async ({ request }) => {
		const data = await request.formData();
		const stored = await getStored('webhook');
		await setStored('webhook', {
			...stored,
			requireSignature: data.get('requireSignature') === 'on'
		});
		return { action: 'signature' };
	}
};
