import { desc, sql } from 'drizzle-orm';
import { db } from './db/index.ts';
import { webhookEvents, type WebhookEvent } from './db/schema.ts';

const KEEP = 200;

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

/** Records one webhook request and trims the table to the latest 200. Never throws */
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
		await db.execute(sql`
			delete from ${webhookEvents}
			where ${webhookEvents.id} in (
				select ${webhookEvents.id} from ${webhookEvents}
				order by ${webhookEvents.at} desc, ${webhookEvents.id} desc
				offset ${KEEP}
			)`);
	} catch (e) {
		console.error('webhook log failed', e);
	}
}

/** Newest first */
export async function listWebhookEvents(limit = 50): Promise<WebhookEvent[]> {
	return db
		.select()
		.from(webhookEvents)
		.orderBy(desc(webhookEvents.at), desc(webhookEvents.id))
		.limit(Math.max(1, Math.min(limit, KEEP)));
}
