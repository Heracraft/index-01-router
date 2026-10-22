// Reads for the day sheet: recordings of one day with their deliveries, the day's note from
// Obsidian (when it answers), calendar dots, and failures that never reached a note.
import { and, asc, desc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import { db } from './db/index.ts';
import { deliveries, integrations, recordings, webhookEvents } from './db/schema.ts';
import { obsidianVault } from './integrations/env.ts';
import { listIntegrations } from './integrations/index.ts';
import { obsidianConfig, readNote } from './integrations/obsidian.ts';
import { onChange } from './pipeline.ts';
import { dayKey, parseLanguages, startOfDay } from '../format.ts';
import { renderNotePath } from '../notes/template.ts';
import { parseNote, sectionOf } from '../notes/sheet.ts';
import { mergeSheet } from '../notes/merge.ts';
import type { EntryDelivery, EntryRec } from '../entry.ts';
import type { Integration } from './db/schema.ts';

export const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD `n` days after `key` */
export function addDays(key: string, n: number) {
	const [y, m, d] = key.split('-').map(Number);
	const t = new Date(Date.UTC(y!, m! - 1, d! + n));
	return t.toISOString().slice(0, 10);
}

/** Midnight starting the day `key` in `timeZone` */
export function dayStart(key: string, timeZone: string) {
	const [y, m, d] = key.split('-').map(Number);
	let t = Date.UTC(y!, m! - 1, d!, 12);
	const seen = dayKey(t, timeZone);
	if (seen < key) t += 12 * 3600_000;
	else if (seen > key) t -= 12 * 3600_000;
	return startOfDay(t, timeZone);
}

/** A valid calendar date in the YYYY-MM-DD form */
export function isDayKey(key: string) {
	if (!DAY.test(key)) return false;
	const t = new Date(`${key}T00:00:00Z`);
	return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === key;
}

/** The integration whose note the sheet shows: the first enabled Obsidian one, else the first */
export async function sheetIntegration(): Promise<Integration | null> {
	const all = (await listIntegrations()).filter((i) => i.kind === 'obsidian');
	return all.find((i) => i.enabled) ?? all[0] ?? null;
}

export function notePathFor(integration: Integration, key: string, timeZone: string) {
	try {
		return renderNotePath(obsidianConfig(integration.config).notePath, {
			recordedAt: new Date(dayStart(key, timeZone).getTime() + 12 * 3600_000),
			timeZone
		});
	} catch {
		return null;
	}
}

/** obsidian:// link that opens a vault path */
export function obsidianLink(path: string) {
	const vault = obsidianVault();
	const file = encodeURIComponent(path.replace(/\.md$/i, ''));
	return `obsidian://open?${vault ? `vault=${encodeURIComponent(vault)}&` : ''}file=${file}`;
}

// Note reads, shared for a few seconds and dropped whenever a recording changes, so the sheet a
// live refresh loads shows the line a delivery just wrote
type Read = { at: number; value: string | null | Error };
const reads = new Map<string, Read>();
let watching = false;
const READ_TTL = 5_000;
const FAIL_TTL = 30_000;
const READ_TIMEOUT = 2_500;

export type NoteRead =
	{ state: 'ok'; content: string } | { state: 'missing' } | { state: 'unreachable' };

export async function readNoteCached(integration: Integration, path: string): Promise<NoteRead> {
	if (!watching) {
		watching = true;
		onChange(() => reads.clear());
	}
	const key = `${integration.id}\n${integration.updatedAt.getTime()}\n${path}`;
	const hit = reads.get(key);
	const now = Date.now();
	let value: string | null | Error;
	if (hit && now - hit.at < (hit.value instanceof Error ? FAIL_TTL : READ_TTL)) {
		value = hit.value;
	} else {
		try {
			value = await readNote(integration.config, path, AbortSignal.timeout(READ_TIMEOUT));
		} catch (e) {
			value = e instanceof Error ? e : new Error(String(e));
		}
		reads.set(key, { at: now, value });
	}
	if (value instanceof Error) return { state: 'unreachable' };
	return value === null ? { state: 'missing' } : { state: 'ok', content: value };
}

/** Recordings with their deliveries, in the shape the sheet and the list show */
export async function entryRecs(where: ReturnType<typeof and>, limit = 500): Promise<EntryRec[]> {
	const rows = await db
		.select({
			id: recordings.id,
			recordedAt: recordings.recordedAt,
			durationMs: recordings.durationMs,
			status: recordings.status,
			transcript: recordings.transcript,
			transcriptVersion: recordings.transcriptVersion,
			error: recordings.error,
			attempts: recordings.attempts,
			trigger: recordings.trigger,
			languages: recordings.languages,
			transcribedBy: recordings.transcribedBy,
			audioPath: recordings.audioPath,
			appTranscript: recordings.appTranscript
		})
		.from(recordings)
		.where(where)
		.orderBy(desc(recordings.recordedAt), desc(recordings.id))
		.limit(limit);
	const ids = rows.map((r) => r.id);
	const ds = ids.length
		? await db
				.select({
					id: deliveries.id,
					recordingId: deliveries.recordingId,
					status: deliveries.status,
					error: deliveries.error,
					attempts: deliveries.attempts,
					target: deliveries.target,
					sentVersion: deliveries.sentVersion,
					updatedAt: deliveries.updatedAt,
					name: integrations.name
				})
				.from(deliveries)
				.innerJoin(integrations, eq(deliveries.integrationId, integrations.id))
				.where(inArray(deliveries.recordingId, ids))
				.orderBy(asc(deliveries.createdAt))
		: [];
	return rows.map((r) => ({
		id: r.id,
		recordedAt: r.recordedAt,
		durationMs: r.durationMs,
		status: r.status,
		transcript: r.transcript,
		error: r.error,
		attempts: r.attempts,
		trigger: r.trigger,
		languages: parseLanguages(r.languages),
		transcribedBy: r.transcribedBy,
		hasAudio: !!r.audioPath,
		hasAppTranscript: !!r.appTranscript?.trim(),
		deliveries: ds
			.filter((d) => d.recordingId === r.id)
			.map((d): EntryDelivery => ({
				id: d.id,
				status: d.status,
				error: d.error,
				attempts: d.attempts,
				target: d.target,
				stale: d.status === 'sent' && d.sentVersion < r.transcriptVersion,
				name: d.name,
				updatedAt: d.updatedAt
			}))
	}));
}

/** Recordings per day with a failure flag, for calendar dots */
export async function dayDots(from: Date, to: Date, timeZone: string) {
	const day = sql<string>`to_char(${recordings.recordedAt} at time zone ${timeZone}, 'YYYY-MM-DD')`;
	const rows = await db
		.select({
			day,
			n: sql<number>`count(*)`.mapWith(Number),
			failed: sql<boolean>`bool_or(${recordings.status} = 'failed')`
		})
		.from(recordings)
		.where(and(gte(recordings.recordedAt, from), lt(recordings.recordedAt, to)))
		.groupBy(sql`1`);
	return Object.fromEntries(rows.map((r) => [r.day, { n: r.n, failed: !!r.failed }])) as Record<
		string,
		{ n: number; failed: boolean }
	>;
}

/** Failed recordings outside [start, end), newest first, and how many there are */
export async function notInNote(start: Date, end: Date, limit = 3) {
	const outside = sql`(${recordings.recordedAt} < ${start.toISOString()}::timestamptz or ${recordings.recordedAt} >= ${end.toISOString()}::timestamptz)`;
	const where = and(eq(recordings.status, 'failed'), outside);
	const [recs, [{ n } = { n: 0 }]] = await Promise.all([
		entryRecs(where, limit),
		db
			.select({ n: sql<number>`count(*)`.mapWith(Number) })
			.from(recordings)
			.where(where)
	]);
	return { recs, count: n };
}

/** Time of the newest delivery an integration got through, as a health fact */
export async function lastSent(integrationId: string): Promise<Date | null> {
	const [row] = await db
		.select({ at: deliveries.updatedAt })
		.from(deliveries)
		.where(and(eq(deliveries.integrationId, integrationId), eq(deliveries.status, 'sent')))
		.orderBy(desc(deliveries.updatedAt))
		.limit(1);
	return row?.at ?? null;
}

/** The newest delivery of an integration, whatever its state */
export async function lastDelivery(integrationId: string) {
	const [row] = await db
		.select({ status: deliveries.status, at: deliveries.updatedAt, error: deliveries.error })
		.from(deliveries)
		.where(and(eq(deliveries.integrationId, integrationId), ne(deliveries.status, 'skipped')))
		.orderBy(desc(deliveries.updatedAt))
		.limit(1);
	return row ?? null;
}

/** First line of the webhook's user agent for a recording */
export async function ringClient(recordingId: string) {
	const [row] = await db
		.select({ userAgent: webhookEvents.userAgent })
		.from(webhookEvents)
		.where(eq(webhookEvents.recordingId, recordingId))
		.orderBy(asc(webhookEvents.at))
		.limit(1);
	return row?.userAgent ?? null;
}

/** Month shown in the calendar: `month` (YYYY-MM) when valid, else the month of `key` */
function monthOf(key: string, month: string | null) {
	const shown = month && /^\d{4}-\d{2}$/.test(month) ? month : key.slice(0, 7);
	const [y, m] = shown.split('-').map(Number);
	return {
		month: shown,
		nextMonth: new Date(Date.UTC(y!, m!, 1)).toISOString().slice(0, 7),
		prevMonth: new Date(Date.UTC(y!, m! - 2, 1)).toISOString().slice(0, 7)
	};
}

/** The side rail of pages that are not a day: the calendar with `key` picked, and failures elsewhere */
export async function loadRail(key: string | null, timeZone: string, month: string | null) {
	const today = dayKey(new Date(), timeZone);
	const m = monthOf(key ?? today, month);
	// No day picked: every failure counts
	const start = key ? dayStart(key, timeZone) : new Date(0);
	const end = key ? dayStart(addDays(key, 1), timeZone) : new Date(0);
	const [dots, needs] = await Promise.all([
		dayDots(dayStart(`${m.month}-01`, timeZone), dayStart(`${m.nextMonth}-01`, timeZone), timeZone),
		notInNote(start, end)
	]);
	return { day: key, today, calendar: { ...m, dots }, needs };
}

export type RailData = Awaited<ReturnType<typeof loadRail>>;

/** The day sheet for `key` (YYYY-MM-DD) in `timeZone` */
export async function loadDay(key: string, timeZone: string, month: string | null) {
	const today = dayKey(new Date(), timeZone);
	const start = dayStart(key, timeZone);
	const end = dayStart(addDays(key, 1), timeZone);

	// Calendar month shown, and the week strip: seven days ending at the day, or later when
	// the day is in the past so it does not sit at the edge
	const { month: shownMonth, nextMonth, prevMonth } = monthOf(key, month);
	const monthStart = `${shownMonth}-01`;
	let weekEnd = addDays(key, 3);
	if (weekEnd > today) weekEnd = today;
	if (weekEnd < key) weekEnd = key;
	const weekStart = addDays(weekEnd, -6);
	const from = [monthStart, weekStart].sort()[0]!;
	const to = [`${nextMonth}-01`, addDays(weekEnd, 1)].sort().at(-1)!;

	const [recs, integration, dots, needs] = await Promise.all([
		entryRecs(and(gte(recordings.recordedAt, start), lt(recordings.recordedAt, end))),
		sheetIntegration(),
		dayDots(dayStart(from, timeZone), dayStart(to, timeZone), timeZone),
		notInNote(start, end)
	]);

	const config = integration ? obsidianConfig(integration.config) : null;
	const path = integration ? notePathFor(integration, key, timeZone) : null;
	const read: NoteRead | null =
		integration && path && integration.enabled ? await readNoteCached(integration, path) : null;
	const blocks =
		read?.state === 'ok' && config ? sectionOf(parseNote(read.content), config.heading) : null;
	const lines = mergeSheet(recs, blocks, {
		path,
		entryTemplate: config?.entryTemplate ?? '',
		timeZone
	});

	return {
		day: key,
		today,
		prev: addDays(key, -1),
		next: key < today ? addDays(key, 1) : null,
		note: config
			? {
					path,
					link: path ? obsidianLink(path) : null,
					heading: config.heading,
					state: read?.state ?? 'off'
				}
			: null,
		lines,
		calendar: { month: shownMonth, prevMonth, nextMonth, dots },
		week: { start: weekStart, end: weekEnd },
		needs
	};
}

export type DayData = Awaited<ReturnType<typeof loadDay>>;
