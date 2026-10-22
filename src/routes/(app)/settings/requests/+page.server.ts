import { inArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { recordings } from '#lib/server/db/schema.ts';
import { listWebhookEvents } from '#lib/server/webhook-log.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const all = await listWebhookEvents(50);
	const show = url.searchParams.get('show') === 'rejected' ? 'rejected' : 'all';
	const isRejected = (e: { status: number }) => e.status >= 400;
	const events = show === 'rejected' ? all.filter(isRejected) : all;
	// What each request made: the start of its recording's transcript, so a row leads with it
	const ids = [...new Set(events.map((e) => e.recordingId).filter((id): id is string => !!id))];
	const recs = ids.length
		? await db
				.select({ id: recordings.id, transcript: recordings.transcript, status: recordings.status })
				.from(recordings)
				.where(inArray(recordings.id, ids))
		: [];
	const byId = new Map(recs.map((r) => [r.id, r]));
	return {
		show,
		counts: { all: all.length, rejected: all.filter(isRejected).length },
		events: events.map((e) => {
			const rec = e.recordingId ? byId.get(e.recordingId) : undefined;
			return {
				id: e.id,
				at: e.at,
				status: e.status,
				reason: e.reason,
				deliveryId: e.deliveryId,
				trigger: e.trigger,
				signed: e.signed,
				test: e.test,
				bytes: e.bytes,
				recordingId: rec ? e.recordingId : null,
				said: rec?.transcript?.trim().slice(0, 160) || null,
				recStatus: rec?.status ?? null
			};
		})
	};
};
