import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from './db/index.ts';
import { recordings, type Recording } from './db/schema.ts';
import { absolutePath, deleteAudio, probeDurationMs, saveAudio } from './storage.ts';
import { enqueue } from './pipeline.ts';

export interface CreateRecordingInput {
	deliveryId: string;
	source: 'ring' | 'upload';
	trigger: string;
	signed: boolean;
	recordedAt: Date;
	audio?: { bytes: Uint8Array; mime: string };
	appTranscript?: string | null;
}

/**
 * Stores the audio and probes its duration, then inserts the row with the delivery id as the
 * idempotency key, so a committed row always has its audio. A known delivery id returns the
 * existing row with duplicate: true. The exception is a row that expected audio and has none
 * (left by a crash in an older version): this delivery's audio completes it, and the result
 * has completed: true.
 */
export async function createRecording(
	input: CreateRecordingInput
): Promise<{ recording: Recording; duplicate: boolean; completed?: boolean }> {
	const id = randomUUID();
	const appTranscript = input.appTranscript?.trim() || null;
	// Without audio the app transcript is the transcript; the pipeline only routes it
	const textOnly = !input.audio && !!appTranscript;

	let audio: { path: string; bytes: number; durationMs: number | null } | null = null;
	if (input.audio) {
		const saved = await saveAudio(id, input.recordedAt, input.audio.bytes, input.audio.mime);
		try {
			audio = { ...saved, durationMs: await probeDurationMs(absolutePath(saved.path)) };
		} catch (e) {
			await deleteAudio(saved.path).catch(() => {});
			throw e;
		}
	}
	const dropAudio = async () => {
		if (audio) await deleteAudio(audio.path).catch(() => {});
	};

	let inserted: Recording | undefined;
	try {
		[inserted] = await db
			.insert(recordings)
			.values({
				id,
				deliveryId: input.deliveryId,
				source: input.source,
				trigger: input.trigger,
				signed: input.signed,
				recordedAt: input.recordedAt,
				audioMime: input.audio?.mime ?? null,
				audioPath: audio?.path ?? null,
				audioBytes: audio?.bytes ?? null,
				durationMs: audio?.durationMs ?? null,
				appTranscript,
				transcript: textOnly ? appTranscript : null,
				transcribedBy: textOnly ? 'index-app' : null
			})
			.onConflictDoNothing({ target: recordings.deliveryId })
			.returning();
	} catch (e) {
		await dropAudio();
		throw e;
	}

	if (!inserted) {
		let completed: Recording | undefined;
		try {
			const [existing] = await db
				.select()
				.from(recordings)
				.where(eq(recordings.deliveryId, input.deliveryId));
			if (!existing) throw new Error(`Recording for delivery ${input.deliveryId} vanished`);
			if (audio && existing.audioMime && !existing.audioPath) {
				// The WHERE makes two concurrent resends attach at most one file
				[completed] = await db
					.update(recordings)
					.set({
						audioPath: audio.path,
						audioBytes: audio.bytes,
						durationMs: audio.durationMs,
						audioMime: input.audio!.mime,
						status: 'received',
						error: null,
						attempts: 0,
						updatedAt: new Date()
					})
					.where(and(eq(recordings.id, existing.id), isNull(recordings.audioPath)))
					.returning();
			}
			if (!completed) {
				await dropAudio();
				return { recording: existing, duplicate: true };
			}
		} catch (e) {
			await dropAudio();
			throw e;
		}
		startPipeline(completed.id);
		return { recording: completed, duplicate: false, completed: true };
	}

	startPipeline(id);
	return { recording: inserted, duplicate: false };
}

function startPipeline(id: string) {
	try {
		enqueue(id);
	} catch (e) {
		// The row is stored as received; the worker resumes it on its next start
		console.error(`enqueue failed for ${id}`, e);
	}
}

/** Removes the row (deliveries cascade) and its audio file. False when it did not exist */
export async function deleteRecording(id: string) {
	const [row] = await db.delete(recordings).where(eq(recordings.id, id)).returning();
	if (!row) return false;
	if (row.audioPath) {
		try {
			await deleteAudio(row.audioPath);
		} catch (e) {
			console.error(`could not delete audio for ${id}`, e);
		}
	}
	return true;
}
