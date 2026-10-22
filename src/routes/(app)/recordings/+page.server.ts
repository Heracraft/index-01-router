import { and, eq, ilike, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { recordings } from '#lib/server/db/schema.ts';
import { entryRecs, loadRail } from '#lib/server/journal.ts';
import { getSettings } from '#lib/server/settings.ts';
import { PENDING_STATUSES } from '#lib/format.ts';
import type { PageServerLoad } from './$types';

const PAGE = 50;
const FILTERS = ['all', 'pending', 'failed', 'done'] as const;
type Filter = (typeof FILTERS)[number];

function filterWhere(filter: Filter): SQL | undefined {
	if (filter === 'pending') return inArray(recordings.status, PENDING_STATUSES);
	if (filter === 'failed') return eq(recordings.status, 'failed');
	if (filter === 'done') return eq(recordings.status, 'done');
	return undefined;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Every recording, searched and filtered, newest first. Days stay one tap away */
export const load: PageServerLoad = async ({ url }) => {
	const raw = url.searchParams.get('status') ?? 'all';
	const filter: Filter = (FILTERS as readonly string[]).includes(raw) ? (raw as Filter) : 'all';
	const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
	const beforeRaw = url.searchParams.get('before');
	const before = beforeRaw && !Number.isNaN(Date.parse(beforeRaw)) ? new Date(beforeRaw) : null;
	const search = q ? ilike(recordings.transcript, `%${escapeLike(q)}%`) : undefined;
	// Rows retried from this list stay in it, so you see them land
	const keep = (url.searchParams.get('keep') ?? '')
		.split(',')
		.filter((id) => /^[0-9a-f-]{36}$/.test(id))
		.slice(0, 50);
	const where = filterWhere(filter);
	const shown = where && keep.length ? or(where, inArray(recordings.id, keep)) : where;

	const { timezone } = await getSettings('general');
	const [recs, [counts], rail] = await Promise.all([
		entryRecs(and(shown, search, before ? lt(recordings.recordedAt, before) : undefined), PAGE + 1),
		db
			.select({
				all: sql<number>`count(*)`.mapWith(Number),
				failed: sql<number>`count(*) filter (where ${recordings.status} = 'failed')`.mapWith(
					Number
				),
				pending:
					sql<number>`count(*) filter (where ${inArray(recordings.status, PENDING_STATUSES)})`.mapWith(
						Number
					),
				done: sql<number>`count(*) filter (where ${recordings.status} = 'done')`.mapWith(Number)
			})
			.from(recordings)
			.where(search),
		loadRail(null, timezone, url.searchParams.get('m'))
	]);
	const more = recs.length > PAGE;
	if (more) recs.length = PAGE;
	const last = recs.at(-1);
	return {
		q,
		filter,
		before: before?.toISOString() ?? null,
		next: more && last ? new Date(last.recordedAt).toISOString() : null,
		counts: counts
			? {
					all: counts.all,
					failed: counts.failed,
					pending: counts.pending,
					done: counts.done
				}
			: { all: 0, failed: 0, pending: 0, done: 0 },
		recs,
		rail
	};
};
