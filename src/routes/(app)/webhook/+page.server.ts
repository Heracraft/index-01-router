import { fail } from '@sveltejs/kit';
import {
	envLocks,
	getSettings,
	getStored,
	newWebhookSecret,
	setStored
} from '#lib/server/settings.ts';
import { listWebhookEvents } from '#lib/server/webhook-log.ts';
import { webhookUrl } from '#lib/server/origin.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const [settings, all] = await Promise.all([getSettings('webhook'), listWebhookEvents(50)]);
	const show = url.searchParams.get('show') === 'rejected' ? 'rejected' : 'all';
	const isRejected = (e: { status: number }) => e.status >= 400;
	const events = show === 'rejected' ? all.filter(isRejected) : all;
	const newest = all[0];
	return {
		webhookUrl: webhookUrl(url),
		show,
		counts: { all: all.length, rejected: all.filter(isRejected).length },
		// The newest request, whatever the filter, for the line under the URL
		last: newest
			? { at: newest.at, status: newest.status, reason: newest.reason, test: newest.test }
			: null,
		rotatedAt: settings.rotatedAt ?? null,
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
		// Seen once is enough to clear the "secret was replaced" banner
		const stored = await getStored('webhook');
		if (stored.secretReset) await setStored('webhook', { ...stored, secretReset: false });
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
		const secret = newWebhookSecret();
		await setStored('webhook', {
			...stored,
			secret,
			secretReset: false,
			rotatedAt: new Date().toISOString()
		});
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
