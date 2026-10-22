import { randomUUID } from 'node:crypto';
import { fail } from '@sveltejs/kit';
import { and, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { recordings } from '#lib/server/db/schema.ts';
import { createRecording } from '#lib/server/ingest.ts';
import { formatCursor, parseCursor } from '#lib/server/cursor.ts';
import { webhookUrl } from '#lib/server/origin.ts';
import { getSettings } from '#lib/server/settings.ts';
import {
	dayKey,
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

/** recordedAt in UTC with microseconds, so a cursor matches the stored value exactly */
const cursorAt = sql<string>`to_char(${recordings.recordedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
export const load: PageServerLoad = async ({ url }) => {
	const raw = url.searchParams.get('status') ?? 'all';
	const filter: Filter = (FILTERS as readonly string[]).includes(raw) ? (raw as Filter) : 'all';
	const before = parseCursor(url.searchParams.get('before'));
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
			done: sql<number>`count(*) filter (where ${recordings.status} = 'done')`.mapWith(Number),
			pending:
				sql<number>`count(*) filter (where ${inArray(recordings.status, PENDING_STATUSES)})`.mapWith(
					Number
				),
			total: count()
		})
		.from(recordings);

	// Recordings per day this week, Monday first, in the general timezone
	const dayExpr = sql<string>`to_char(${recordings.recordedAt} at time zone ${timezone}, 'YYYY-MM-DD')`;
	const perDay = await db
		.select({ day: dayExpr, n: count() })
		.from(recordings)
		.where(sql`${recordings.recordedAt} >= ${week.toISOString()}::timestamptz`)
		.groupBy(sql`1`);
	const byDay = new Map(perDay.map((d) => [d.day, d.n]));
	const weekDays: { label: string; count: number }[] = [];
	const todayKey = dayKey(now, timezone);
	for (let i = 0; i < 7; i++) {
		// Noon of each day steps cleanly over DST changes
		const at = new Date(week.getTime() + i * 86400_000 + 12 * 3600_000);
		const key = dayKey(at, timezone);
		const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: timezone })
			.format(at)
			.slice(0, 3);
		weekDays.push({ label: weekday, count: byDay.get(key) ?? 0 });
		if (key === todayKey) break;
	}

	const rows = await db
		.select({
			id: recordings.id,
			recordedAt: recordings.recordedAt,
			trigger: recordings.trigger,
			source: recordings.source,
			durationMs: recordings.durationMs,
			status: recordings.status,
			error: recordings.error,
			attempts: recordings.attempts,
			languages: recordings.languages,
			cursorAt,
			// The list shows one line; the full text stays on the detail page
			head: sql<string | null>`left(${recordings.transcript}, 400)`,
			// Drizzle leaves columns unqualified in a one-table select, so the subqueries name theirs
			failedTargets: sql<string[] | null>`(
				select array_agg(i.name order by d.created_at)
				from deliveries d join integrations i on i.id = d.integration_id
				where d.recording_id = "recordings"."id" and d.status = 'failed'
			)`,
			failedError: sql<string | null>`(
				select d.error from deliveries d
				where d.recording_id = "recordings"."id" and d.status = 'failed'
				order by d.created_at limit 1
			)`,
			// Deliveries in flight: the highest attempt and its last error, for a retrying row
			deliveryAttempt: sql<number>`coalesce((
				select max(d.attempts) from deliveries d
				where d.recording_id = "recordings"."id" and d.status = 'pending'
			), 0)`.mapWith(Number),
			deliveryError: sql<string | null>`(
				select d.error from deliveries d
				where d.recording_id = "recordings"."id" and d.status = 'pending' and d.error is not null
				order by d.attempts desc limit 1
			)`
		})
		.from(recordings)
		.where(
			and(
				where,
				before
					? sql`(${recordings.recordedAt}, ${recordings.id}) < (${before.at}::timestamptz, ${before.id}::uuid)`
					: undefined
			)
		)
		.orderBy(desc(recordings.recordedAt), desc(recordings.id))
		.limit(PAGE + 1);

	const more = rows.length > PAGE;
	if (more) rows.length = PAGE;
	const last = rows.at(-1);

	return {
		filter,
		before: before ? new Date(before.at) : null,
		nextCursor: more && last ? formatCursor(last.cursorAt, last.id) : null,
		stats,
		weekDays,
		// The empty state shows it, so the first recording is one paste away
		webhookUrl: stats.total === 0 ? webhookUrl(url) : null,
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		recordings: rows.map(({ head, languages, cursorAt, failedTargets, ...r }) => ({
			...r,
			failedTargets: failedTargets ?? [],
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
