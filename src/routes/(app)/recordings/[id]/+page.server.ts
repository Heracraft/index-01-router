import { error, fail, redirect } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { deliveries, integrations, recordings, webhookEvents } from '#lib/server/db/schema.ts';
import { deleteRecording } from '#lib/server/ingest.ts';
import { redeliver, retryRecording } from '#lib/server/pipeline.ts';
import {
	integrationMatches,
	listIntegrationsForUI,
	skipReason
} from '#lib/server/integrations/index.ts';
import { obsidianConfig } from '#lib/server/integrations/obsidian.ts';
import { getSettings } from '#lib/server/settings.ts';
import { renderEntry } from '#lib/notes/template.ts';
import { parseLanguages } from '#lib/format.ts';
import type { Actions, PageServerLoad } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const load: PageServerLoad = async ({ params }) => {
	if (!UUID.test(params.id)) error(404, 'Recording not found');
	const [rec] = await db.select().from(recordings).where(eq(recordings.id, params.id));
	if (!rec) error(404, 'Recording not found');

	const [rows, [event], all, general] = await Promise.all([
		db
			.select({
				id: deliveries.id,
				status: deliveries.status,
				attempts: deliveries.attempts,
				target: deliveries.target,
				sentVersion: deliveries.sentVersion,
				error: deliveries.error,
				updatedAt: deliveries.updatedAt,
				integrationId: integrations.id,
				name: integrations.name,
				kind: integrations.kind,
				config: integrations.config
			})
			.from(deliveries)
			.innerJoin(integrations, eq(deliveries.integrationId, integrations.id))
			.where(eq(deliveries.recordingId, rec.id))
			.orderBy(asc(deliveries.createdAt)),
		db
			.select({ userAgent: webhookEvents.userAgent })
			.from(webhookEvents)
			.where(eq(webhookEvents.recordingId, rec.id))
			.orderBy(asc(webhookEvents.at))
			.limit(1),
		listIntegrationsForUI(),
		getSettings('general')
	]);

	// The entry a resend of the current transcript would append, rendered as delivery would
	const entryFor = (config: Record<string, unknown>) => {
		try {
			return renderEntry(obsidianConfig(config).entryTemplate, {
				recordedAt: rec.recordedAt,
				timeZone: general.timezone || 'UTC',
				transcript: rec.transcript ?? '',
				languages: parseLanguages(rec.languages),
				trigger: rec.trigger,
				durationMs: rec.durationMs
			});
		} catch {
			return rec.transcript ?? '';
		}
	};

	const appTranscript = rec.appTranscript?.trim() || null;
	return {
		recording: {
			id: rec.id,
			deliveryId: rec.deliveryId,
			source: rec.source,
			trigger: rec.trigger,
			signed: rec.signed,
			recordedAt: rec.recordedAt,
			receivedAt: rec.receivedAt,
			hasAudio: !!rec.audioPath,
			audioMime: rec.audioMime,
			audioBytes: rec.audioBytes,
			durationMs: rec.durationMs,
			transcript: rec.transcript,
			languages: parseLanguages(rec.languages),
			transcribedBy: rec.transcribedBy,
			transcribeMs: rec.transcribeMs,
			status: rec.status,
			error: rec.error,
			attempts: rec.attempts,
			// Shown only when it says something the transcript does not
			appTranscript:
				appTranscript && appTranscript !== rec.transcript?.trim() ? appTranscript : null
		},
		userAgent: event?.userAgent ?? null,
		// Enabled integrations that take this recording's trigger
		matching: all
			.filter((i) => integrationMatches(i, rec.trigger))
			.map(({ id, name }) => ({ id, name })),
		// Stale: sent before the transcript last changed
		deliveries: rows.map(({ sentVersion, config, ...d }) => {
			const stale = d.status === 'sent' && sentVersion < rec.transcriptVersion;
			// Read from the integration as it is now, so older rows show the same short reason
			const error =
				d.status === 'skipped' ? skipReason(all.find((i) => i.id === d.integrationId)) : d.error;
			return { ...d, error, stale, preview: stale ? entryFor(config) : null };
		})
	};
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const actions: Actions = {
	transcribe: async ({ params }) => {
		try {
			await retryRecording(params.id, 'transcribe');
		} catch (e) {
			return fail(409, { action: 'transcribe', error: message(e) });
		}
		return { action: 'transcribe' };
	},
	route: async ({ params }) => {
		try {
			await retryRecording(params.id, 'route');
		} catch (e) {
			return fail(409, { action: 'route', error: message(e) });
		}
		return { action: 'route' };
	},
	redeliver: async ({ request, params }) => {
		const id = String((await request.formData()).get('delivery') ?? '');
		const [d] = UUID.test(id)
			? await db
					.select({ recordingId: deliveries.recordingId })
					.from(deliveries)
					.where(eq(deliveries.id, id))
			: [];
		if (!d || d.recordingId !== params.id) {
			return fail(404, { action: 'redeliver', error: 'Delivery not found' });
		}
		try {
			await redeliver(id);
		} catch (e) {
			return fail(409, { action: 'redeliver', error: message(e) });
		}
		return { action: 'redeliver' };
	},
	delete: async ({ params }) => {
		await deleteRecording(params.id);
		redirect(303, '/');
	}
};
