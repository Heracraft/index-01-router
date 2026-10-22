import { randomUUID } from 'node:crypto';
import { fail } from '@sveltejs/kit';
import { count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { deliveries, recordings } from '#lib/server/db/schema.ts';
import { createRecording } from '#lib/server/ingest.ts';
import { getSettings } from '#lib/server/settings.ts';
import {
	firstLine,
	parseLanguages,
	PENDING_STATUSES,
	startOfDay,
	startOfWeek
} from '#lib/format.ts';
import type { Actions, PageServerLoad } from './$types';

const PAGE = 50;
const FILTERS = ['all', 'pending', 'failed', 'done'] as const;
type Filter = (typeof FILTERS)[number];

function filterWhere(filter: Filter): SQL | undefined {
	if (filter === 'pending') return inArray(recordings.status, PENDING_STATUSES);
	if (filter === 'failed') return eq(recordings.status, 'failed');
	if (filter === 'done') return eq(recordings.status, 'done');
	return undefined;
}

export const load: PageServerLoad = async ({ url }) => {
	const raw = url.searchParams.get('status') ?? 'all';
	const filter: Filter = (FILTERS as readonly string[]).includes(raw) ? (raw as Filter) : 'all';
	const limit = Math.min(
		Math.max(PAGE, Number.parseInt(url.searchParams.get('limit') ?? '', 10) || PAGE),
		1000
	);
	const { timezone } = await getSettings('general');
	const now = new Date();
	const today = startOfDay(now, timezone);
	const week = startOfWeek(now, timezone);
	const where = filterWhere(filter);

	const [stats] = await db
		.select({
			today:
				sql<number>`count(*) filter (where ${recordings.recordedAt} >= ${today.toISOString()}::timestamptz)`.mapWith(
					Number
				),
			week: sql<number>`count(*) filter (where ${recordings.recordedAt} >= ${week.toISOString()}::timestamptz)`.mapWith(
				Number
			),
			failed: sql<number>`count(*) filter (where ${recordings.status} = 'failed')`.mapWith(Number),
			pending:
				sql<number>`count(*) filter (where ${inArray(recordings.status, PENDING_STATUSES)})`.mapWith(
					Number
				),
			total: count()
		})
		.from(recordings);

	const [{ matching }] = await db.select({ matching: count() }).from(recordings).where(where);

	const rows = await db
		.select({
			id: recordings.id,
			recordedAt: recordings.recordedAt,
			trigger: recordings.trigger,
			source: recordings.source,
			durationMs: recordings.durationMs,
			status: recordings.status,
			error: recordings.error,
			languages: recordings.languages,
			// The list shows one line; the full text stays on the detail page
			head: sql<string | null>`left(${recordings.transcript}, 400)`,
			failedDeliveries: sql<number>`(
				select count(*) from ${deliveries}
				where ${deliveries.recordingId} = ${recordings.id} and ${deliveries.status} = 'failed'
			)`.mapWith(Number)
		})
		.from(recordings)
		.where(where)
		.orderBy(desc(recordings.recordedAt), desc(recordings.id))
		.limit(limit);

	return {
		filter,
		limit,
		matching,
		stats,
		recordings: rows.map(({ head, languages, ...r }) => ({
			...r,
			line: firstLine(head, 200),
			languages: parseLanguages(languages)
		}))
	};
};

const EXTENSION_MIME: Record<string, string> = {
	m4a: 'audio/mp4',
	mp4: 'audio/mp4',
	aac: 'audio/aac',
	mp3: 'audio/mpeg',
	wav: 'audio/wav',
	ogg: 'audio/ogg',
	oga: 'audio/ogg',
	opus: 'audio/ogg',
	webm: 'audio/webm',
	flac: 'audio/flac'
};

/** The browser's type when it is audio, else a guess from the extension */
function audioMime(file: File) {
	if (file.type.startsWith('audio/')) return file.type;
	const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
	if (file.type === 'video/mp4' || file.type === 'video/webm' || file.type === 'video/ogg') {
		return file.type.replace('video/', 'audio/');
	}
	return EXTENSION_MIME[ext] ?? null;
}

export const actions: Actions = {
	upload: async ({ request }) => {
		const data = await request.formData();
		const file = data.get('audio');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { upload: 'Pick an audio file.' });
		}
		const mime = audioMime(file);
		if (!mime) {
			return fail(400, {
				upload: `${file.name} is not audio. Use m4a, mp3, wav, ogg, webm or flac.`
			});
		}
		const lastModified = Number(data.get('lastModified'));
		const recordedAt =
			Number.isFinite(lastModified) && lastModified > 946684800000 && lastModified <= Date.now()
				? new Date(lastModified)
				: new Date();
		try {
			const { recording } = await createRecording({
				source: 'upload',
				trigger: 'upload',
				deliveryId: `upload_${randomUUID()}`,
				signed: false,
				recordedAt,
				audio: { bytes: new Uint8Array(await file.arrayBuffer()), mime }
			});
			return { uploaded: recording.id };
		} catch (e) {
			console.error('upload failed', e);
			return fail(500, { upload: `Could not store ${file.name}: ${(e as Error).message}` });
		}
	}
};
