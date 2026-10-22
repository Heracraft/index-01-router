import {
	pgTable,
	pgEnum,
	uuid,
	text,
	integer,
	boolean,
	jsonb,
	timestamp,
	index,
	uniqueIndex
} from 'drizzle-orm/pg-core';

const now = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/**
 * received     audio stored, waiting for a transcription slot
 * transcribing provider call in flight
 * routing      transcript saved, deliveries in flight
 * done         every delivery succeeded (or there were none)
 * failed       transcription failed, or at least one delivery failed after retries
 */
export const recordingStatus = pgEnum('recording_status', [
	'received',
	'transcribing',
	'routing',
	'done',
	'failed'
]);

export const recordings = pgTable(
	'recordings',
	{
		id: uuid().primaryKey().defaultRandom(),
		/** X-Index-Delivery, the audio filename stem, or upload_<uuid> */
		deliveryId: text().notNull(),
		source: text({ enum: ['ring', 'upload'] }).notNull(),
		/** single-click-hold | double-click-hold | upload */
		trigger: text().notNull(),
		signed: boolean().notNull().default(false),
		recordedAt: timestamp({ withTimezone: true }).notNull(),
		receivedAt: now(),
		/** Relative to DATA_DIR, e.g. audio/2026/10/<id>.m4a. Null for transcription-only payloads */
		audioPath: text(),
		audioMime: text(),
		audioBytes: integer(),
		durationMs: integer(),
		/** Transcript the phone app sent along, kept as a fallback */
		appTranscript: text(),
		transcript: text(),
		/** Goes up by one each time `transcript` changes; deliveries record the one they sent */
		transcriptVersion: integer().notNull().default(0),
		/** Comma separated ISO 639-1 codes, most spoken first */
		languages: text(),
		/** provider:model that produced `transcript` */
		transcribedBy: text(),
		transcribeMs: integer(),
		status: recordingStatus().notNull().default('received'),
		error: text(),
		attempts: integer().notNull().default(0),
		updatedAt: now()
	},
	(t) => [
		uniqueIndex('recordings_delivery_id').on(t.deliveryId),
		// Keyset paging of the list seeks on (recordedAt, id)
		index('recordings_recorded_at_id').on(t.recordedAt, t.id),
		index('recordings_status').on(t.status)
	]
);

export const integrations = pgTable('integrations', {
	id: uuid().primaryKey().defaultRandom(),
	kind: text({ enum: ['obsidian'] }).notNull(),
	name: text().notNull(),
	enabled: boolean().notNull().default(true),
	/** Triggers this integration receives. Empty means all */
	triggers: text().array().notNull().default([]),
	/** Kind specific config. Secret fields are encrypted with #lib/server/crypto.ts */
	config: jsonb().$type<Record<string, unknown>>().notNull(),
	createdAt: now(),
	updatedAt: now()
});

export const deliveryStatus = pgEnum('delivery_status', ['pending', 'sent', 'failed', 'skipped']);

export const deliveries = pgTable(
	'deliveries',
	{
		id: uuid().primaryKey().defaultRandom(),
		recordingId: uuid()
			.notNull()
			.references(() => recordings.id, { onDelete: 'cascade' }),
		integrationId: uuid()
			.notNull()
			.references(() => integrations.id, { onDelete: 'cascade' }),
		status: deliveryStatus().notNull().default('pending'),
		attempts: integer().notNull().default(0),
		/** Where it landed, e.g. the note path */
		target: text(),
		/** recordings.transcriptVersion this delivery last sent. Lower than the recording's: stale */
		sentVersion: integer().notNull().default(0),
		error: text(),
		createdAt: now(),
		updatedAt: now()
	},
	(t) => [uniqueIndex('deliveries_recording_integration').on(t.recordingId, t.integrationId)]
);

/** Every request that reached the webhook, accepted or not. Trimmed by webhook-log.ts */
export const webhookEvents = pgTable(
	'webhook_events',
	{
		id: uuid().primaryKey().defaultRandom(),
		at: now(),
		status: integer().notNull(),
		reason: text().notNull(),
		deliveryId: text(),
		trigger: text(),
		signed: boolean().notNull().default(false),
		test: boolean().notNull().default(false),
		bytes: integer().notNull().default(0),
		userAgent: text(),
		recordingId: uuid().references(() => recordings.id, { onDelete: 'set null' })
	},
	(t) => [index('webhook_events_at').on(t.at)]
);

/** Key value store for the Settings pages, see #lib/server/settings.ts */
export const settings = pgTable('settings', {
	key: text().primaryKey(),
	value: jsonb().notNull(),
	updatedAt: now()
});

export type Recording = typeof recordings.$inferSelect;
export type Integration = typeof integrations.$inferSelect;
export type Delivery = typeof deliveries.$inferSelect;
export type WebhookEvent = typeof webhookEvents.$inferSelect;
