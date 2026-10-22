import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
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
 * Inserts the row (the delivery id is the idempotency key), stores the audio, probes its
 * duration and hands the recording to the pipeline. A known delivery id returns the existing
 * row with duplicate: true and touches nothing.
 */
export async function createRecording(
	input: CreateRecordingInput
): Promise<{ recording: Recording; duplicate: boolean }> {
	const id = randomUUID();
	const appTranscript = input.appTranscript?.trim() || null;
	// Without audio the app transcript is the transcript; the pipeline only routes it
	const textOnly = !input.audio && !!appTranscript;
	const [inserted] = await db
		.insert(recordings)
		.values({
			id,
			deliveryId: input.deliveryId,
			source: input.source,
			trigger: input.trigger,
			signed: input.signed,
			recordedAt: input.recordedAt,
			audioMime: input.audio?.mime ?? null,
			appTranscript,
			transcript: textOnly ? appTranscript : null,
			transcribedBy: textOnly ? 'index-app' : null
		})
		.onConflictDoNothing({ target: recordings.deliveryId })
		.returning();

	if (!inserted) {
		const [existing] = await db
			.select()
			.from(recordings)
			.where(eq(recordings.deliveryId, input.deliveryId));
		if (!existing) throw new Error(`Recording for delivery ${input.deliveryId} vanished`);
		return { recording: existing, duplicate: true };
	}

	let recording = inserted;
	if (input.audio) {
		let saved: { path: string; bytes: number } | undefined;
		try {
			saved = await saveAudio(id, input.recordedAt, input.audio.bytes, input.audio.mime);
			const durationMs = await probeDurationMs(absolutePath(saved.path));
			[recording] = await db
				.update(recordings)
				.set({
					audioPath: saved.path,
					audioBytes: saved.bytes,
					durationMs,
					updatedAt: new Date()
				})
				.where(eq(recordings.id, id))
				.returning();
		} catch (e) {
			// Drop the row so a resend of the same delivery can succeed
			if (saved) await deleteAudio(saved.path).catch(() => {});
			await db.delete(recordings).where(eq(recordings.id, id));
			throw e;
		}
	}

	try {
		enqueue(id);
	} catch (e) {
		// The row is stored as received; the worker resumes it on its next start
		console.error(`enqueue failed for ${id}`, e);
	}
	return { recording, duplicate: false };
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
