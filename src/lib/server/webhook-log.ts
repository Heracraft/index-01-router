import { desc, sql, type SQL } from 'drizzle-orm';
import { db } from './db/index.ts';
import { webhookEvents, type WebhookEvent } from './db/schema.ts';
import { notifyWebhookLog } from './webhook-feed.ts';

/** Rows kept of accepted deliveries, signed requests and server errors */
const KEEP = 200;
/** Rows kept of unsigned 4xx rejections, so junk posts cannot push real deliveries out */
const KEEP_REJECTED = 50;

export interface WebhookLogEntry {
	status: number;
	reason: string;
	deliveryId?: string | null;
	trigger?: string | null;
	signed?: boolean;
	test?: boolean;
	bytes?: number;
	userAgent?: string | null;
	recordingId?: string | null;
}

/** Unsigned 4xx: what an unauthenticated stranger can produce */
const rejected = sql`(${webhookEvents.status} between 400 and 499 and not ${webhookEvents.signed})`;
/** Rejected rows shown next to the newest accepted ones */
const SHOW_REJECTED = 10;

/** Records one webhook request and trims each class of row to its limit. Never throws */
export async function logWebhookEvent(entry: WebhookLogEntry) {
	try {
		await db.insert(webhookEvents).values({
			status: entry.status,
			reason: entry.reason.slice(0, 500),
			deliveryId: entry.deliveryId?.slice(0, 300) ?? null,
			trigger: entry.trigger?.slice(0, 100) ?? null,
			signed: entry.signed ?? false,
			test: entry.test ?? false,
			bytes: entry.bytes ?? 0,
			userAgent: entry.userAgent?.slice(0, 300) ?? null,
			recordingId: entry.recordingId ?? null
		});
		await trim(rejected, KEEP_REJECTED);
		await trim(sql`not ${rejected}`, KEEP);
	} catch (e) {
		console.error('webhook log failed', e);
	} finally {
		notifyWebhookLog();
	}
}

async function trim(where: SQL, keep: number) {
	await db.execute(sql`
		delete from ${webhookEvents}
		where ${webhookEvents.id} in (
			select ${webhookEvents.id} from ${webhookEvents}
			where ${where}
			order by ${webhookEvents.at} desc, ${webhookEvents.id} desc
			offset ${keep}
		)`);
}

/**
 * One line naming the cause of a failure, for the Webhook page. Follows `cause` so a drizzle
 * "Failed query" shows the driver error, and leaves out the SQL text and parameters.
 */
export function errorSummary(e: unknown, max = 160): string {
	const parts: string[] = [];
	let cur: unknown = e;
	for (let depth = 0; depth < 4 && cur != null; depth++) {
		const msg = cur instanceof Error ? cur.message : String(cur);
		const code = (cur as { code?: unknown }).code;
		if (msg && !msg.startsWith('Failed query:')) parts.push(msg);
		else if (!(cur instanceof Error && cur.cause)) parts.push('database query failed');
		if (typeof code === 'string' && code && !msg.includes(code)) parts.push(code);
		cur = cur instanceof Error ? cur.cause : undefined;
	}
	const line = parts.join(': ').replace(/\s+/g, ' ').trim() || 'unknown error';
	return line.length > max ? `${line.slice(0, max - 3)}...` : line;
}

/**
 * Newest first: the latest `limit` deliveries and server errors, plus the latest few unsigned
 * rejections, so a burst of junk requests cannot hide real deliveries.
 */
export async function listWebhookEvents(limit = 50): Promise<WebhookEvent[]> {
	const n = Math.max(1, Math.min(limit, KEEP));
	const newest = (where: SQL, count: number) =>
		db
			.select()
			.from(webhookEvents)
			.where(where)
			.orderBy(desc(webhookEvents.at), desc(webhookEvents.id))
			.limit(count);
	const [kept, junk] = await Promise.all([
		newest(sql`not ${rejected}`, n),
		newest(rejected, Math.min(n, SHOW_REJECTED))
	]);
	return [...kept, ...junk].sort(
		(a, b) => b.at.getTime() - a.at.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
	);
}
