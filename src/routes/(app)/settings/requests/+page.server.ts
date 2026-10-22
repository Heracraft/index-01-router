import { listWebhookEvents } from '#lib/server/webhook-log.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const all = await listWebhookEvents(50);
	const show = url.searchParams.get('show') === 'rejected' ? 'rejected' : 'all';
	const isRejected = (e: { status: number }) => e.status >= 400;
	const events = show === 'rejected' ? all.filter(isRejected) : all;
	return {
		show,
		counts: { all: all.length, rejected: all.filter(isRejected).length },
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
