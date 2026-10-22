import { error, fail, redirect } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { deliveries, integrations, recordings, webhookEvents } from '#lib/server/db/schema.ts';
import { deleteRecording } from '#lib/server/ingest.ts';
import { editTranscript, redeliver, retryRecording } from '#lib/server/pipeline.ts';
import {
	entryRecs,
	loadRail,
	notePathFor,
	obsidianLink,
	readNoteCached
} from '#lib/server/journal.ts';
import { entryRaw, parseNote, sectionOf } from '#lib/notes/sheet.ts';
import { dayKey, formatTime } from '#lib/format.ts';
import {
	integrationMatches,
	listIntegrations,
	listIntegrationsForUI,
	skipReason
} from '#lib/server/integrations/index.ts';
import { obsidianConfig } from '#lib/server/integrations/obsidian.ts';
import { getSettings } from '#lib/server/settings.ts';
import { renderEntry } from '#lib/notes/template.ts';
import { parseLanguages } from '#lib/format.ts';
import type { Actions, PageServerLoad } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const load: PageServerLoad = async ({ params, url }) => {
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
	const entryFor = (config: Record<string, unknown>, transcript = rec.transcript ?? '') => {
		try {
			return renderEntry(obsidianConfig(config).entryTemplate, {
				recordedAt: rec.recordedAt,
				timeZone: general.timezone || 'UTC',
				transcript,
				languages: parseLanguages(rec.languages),
				trigger: rec.trigger,
				durationMs: rec.durationMs
			});
		} catch {
			return transcript;
		}
	};
	// The note after a resend: the entry already there (its old text is not kept, so "…") and
	// the new one under it, as the append places them
	const resendPreview = (config: Record<string, unknown>) => {
		const earlier = entryFor(config, '…');
		const next = entryFor(config);
		const gap = /^\s*([-*+]|\d+\.)\s/.test(next) ? '\n' : '\n\n';
		const head = earlier + gap;
		return { body: head + next, from: head.split('\n').length - 1 };
	};

	const timeZone = general.timezone || 'UTC';
	const day = dayKey(rec.recordedAt, timeZone);
	const [[entry], rail] = await Promise.all([
		entryRecs(eq(recordings.id, rec.id), 1),
		loadRail(day, timeZone, url.searchParams.get('m'))
	]);

	// "In the note": the note each delivery writes to, read from Obsidian when it answers, with
	// this recording's line marked, or where it would go when it is not there yet
	const resolvedAll = await listIntegrations();
	const targets = rows.length
		? rows.map((d) => ({ integrationId: d.integrationId, delivery: d }))
		: all
				.filter((i) => integrationMatches(i, rec.trigger))
				.map((i) => ({ integrationId: i.id, delivery: null }));
	const contexts = await Promise.all(
		targets.map(async ({ integrationId, delivery }) => {
			const integration = resolvedAll.find((i) => i.id === integrationId);
			if (!integration || integration.kind !== 'obsidian') return null;
			const config = obsidianConfig(integration.config);
			const path = delivery?.target ?? notePathFor(integration, day, timeZone);
			const entryText = entryFor(integration.config);
			const sent = delivery?.status === 'sent';
			const read = path ? await readNoteCached(integration, path) : null;
			type Line = {
				time: string | null;
				text: string;
				task: boolean | null;
				mark: 'this' | 'pending' | null;
			};
			const said = !!rec.transcript?.trim();
			const mine = said ? parseNote(entryText).find((b) => b.type !== 'heading') : undefined;
			const own: Line = {
				// No words yet: the line is its time alone, the page says the rest
				time: said ? (mine?.time ?? null) : formatTime(rec.recordedAt, timeZone),
				text: said ? (mine?.text ?? rec.transcript ?? '') : '',
				task: null,
				mark: sent ? 'this' : 'pending'
			};
			let lines: Line[] = [own];
			let before = false;
			let after = false;
			const blocks =
				read?.state === 'ok' ? sectionOf(parseNote(read.content), config.heading) : null;
			if (blocks) {
				const items = blocks.filter((b) => b.type !== 'heading');
				const want = entryRaw(entryText);
				// The line may be written already while its send is still unconfirmed: mark it in
				// place rather than show it twice
				let at = items.findIndex((b) => b.raw === want);
				if (sent && at < 0 && own.time) {
					at = items.findIndex((b) => b.time === own.time);
				}
				const all: Line[] = items.map((b) => ({
					time: b.time,
					text: b.text,
					task: b.task,
					mark: null
				}));
				if (at >= 0) all[at] = { ...all[at]!, mark: sent ? 'this' : 'pending' };
				if (at < 0) {
					// Not in the note: where the append would put it, by time
					at = own.time ? all.findIndex((l) => l.time !== null && l.time > own.time!) : -1;
					if (at < 0) at = all.length;
					all.splice(at, 0, own);
				}
				// The line with one neighbour each side
				const from = Math.max(0, at - 1);
				const to = Math.min(all.length, at + 2);
				lines = all.slice(from, to);
				before = from > 0;
				after = to < all.length;
			}
			return {
				integrationId,
				name: integration.name,
				path,
				link: path ? obsidianLink(path) : null,
				heading: config.heading,
				state: read?.state ?? 'off',
				sent,
				lines,
				before,
				after
			};
		})
	);

	const appTranscript = rec.appTranscript?.trim() || null;
	return {
		day,
		rail,
		entry: entry!,
		contexts: contexts.filter((c) => c !== null),
		recording: {
			id: rec.id,
			deliveryId: rec.deliveryId,
			source: rec.source,
			trigger: rec.trigger,
			signed: rec.signed,
			recordedAt: rec.recordedAt,
			receivedAt: rec.receivedAt,
			updatedAt: rec.updatedAt,
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
			const integration = all.find((i) => i.id === d.integrationId);
			const error = d.status === 'skipped' ? skipReason(integration) : d.error;
			// A skipped row delivers only once its integration takes this recording
			const deliverable =
				d.status !== 'skipped' || (!!integration && integrationMatches(integration, rec.trigger));
			return { ...d, error, stale, deliverable, preview: stale ? resendPreview(config) : null };
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
	edit: async ({ request, params }) => {
		const text = String((await request.formData()).get('transcript') ?? '');
		try {
			await editTranscript(params.id, text);
		} catch (e) {
			return fail(409, { action: 'edit', error: message(e) });
		}
		return { action: 'edit' };
	},
	delete: async ({ params }) => {
		await deleteRecording(params.id);
		redirect(303, '/');
	}
};
