// Index 01 webhook, protocol v1. Reply fast with short plain text: the app shows the first 200
// characters of error bodies in its Recent runs. Duplicates get 200 because the app logs 409 as a
// failure and never retries.
import { text } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { recordings } from '#lib/server/db/schema.ts';
import { createRecording } from '#lib/server/ingest.ts';
import {
	MAX_AUDIO_BYTES,
	isTestEvent,
	readIndexForm,
	resolveDeliveryId
} from '#lib/server/index01/parse.ts';
import {
	hasSignatureHeaders,
	precheckIndexHeaders,
	verifyIndexSignature,
	type IndexSignedHeaders
} from '#lib/server/index01/verify.ts';
import { getSettings } from '#lib/server/settings.ts';
import { errorSummary, logWebhookEvent, type WebhookLogEntry } from '#lib/server/webhook-log.ts';
import type { RequestHandler } from './$types';

/**
 * Multipart overhead allowed on top of the audio limit. Matches BODY_SIZE_LIMIT=51M in the
 * Dockerfile and compose.yaml; a lower adapter limit also ends in 413 through readBody.
 */
const MAX_BODY_BYTES = MAX_AUDIO_BYTES + 1024 * 1024;

export const POST: RequestHandler = async ({ request }) => {
	const headers = request.headers;
	const log: WebhookLogEntry = {
		status: 0,
		reason: '',
		trigger: headers.get('x-index-trigger'),
		deliveryId: headers.get('x-index-delivery'),
		userAgent: headers.get('user-agent'),
		test: headers.get('x-index-test') === 'true' || headers.get('x-index-trigger') === 'test-event',
		bytes: Number(headers.get('content-length')) || 0
	};
	const reply = async (status: number, reason: string, body = reason) => {
		await logWebhookEvent({ ...log, status, reason });
		return text(body, { status });
	};

	try {
		// Everything that needs only the headers runs before the body is read
		const version = headers.get('x-index-webhook-version');
		if (version !== null && version !== '1') return await reply(400, 'unsupported webhook version');

		const settings = await getSettings('webhook');
		let signed: IndexSignedHeaders | null = null;
		if (hasSignatureHeaders(headers)) {
			const pre = precheckIndexHeaders(headers, settings.secret, { toleranceSec: 300 });
			if (!pre.ok) return await reply(pre.status, pre.reason);
			signed = pre;
		} else if (settings.requireSignature) {
			return await reply(401, 'signature required');
		}

		const contentType = headers.get('content-type') ?? '';
		if (!contentType.toLowerCase().startsWith('multipart/form-data'))
			return await reply(415, 'expected multipart/form-data');
		if (log.bytes! > MAX_BODY_BYTES) return await reply(413, 'payload too large');

		const raw = await readBody(request, MAX_BODY_BYTES);
		if (!raw) return await reply(413, 'payload too large');
		log.bytes = raw.byteLength;

		let headerId: string | null = null;
		if (signed) {
			const v = verifyIndexSignature(signed, raw, settings.secret);
			if (!v.ok) return await reply(v.status, v.reason);
			log.signed = true;
			headerId = v.deliveryId;
		}

		// Signed resend of a stored recording: answer before parsing. An incomplete row (audio
		// expected, none stored) goes on so this delivery can supply the audio.
		if (headerId) {
			const existing = await findByDelivery(headerId);
			if (existing && !(existing.audioMime && !existing.audioPath)) {
				log.recordingId = existing.id;
				return await reply(200, 'duplicate');
			}
		}

		let form: FormData;
		try {
			form = await new Response(raw, { headers: { 'content-type': contentType } }).formData();
		} catch {
			return await reply(400, 'malformed multipart body');
		}
		const payload = readIndexForm(form);

		if (isTestEvent(headers, payload.testField)) {
			log.test = true;
			return await reply(200, 'test event', 'ok test');
		}

		if (!payload.audio && !payload.transcription)
			return await reply(400, 'no audio or transcription');

		let audioBytes: Uint8Array | null = null;
		if (payload.audio) {
			if (payload.audio.size > MAX_AUDIO_BYTES) return await reply(413, 'audio over 50 MB');
			const declared = headers.get('x-audio-size');
			if (declared !== null && Number(declared) !== payload.audio.size)
				return await reply(
					400,
					`audio size mismatch: header ${declared}, got ${payload.audio.size}`
				);
			audioBytes = new Uint8Array(await payload.audio.arrayBuffer());
		}

		const recordedAtMs = payload.recordedAtMs ?? Date.now();
		const deliveryId = resolveDeliveryId({
			headerId,
			filename: payload.audio?.name,
			transcription: payload.transcription,
			recordedAtMs,
			audioBytes
		});
		if (!deliveryId) return await reply(400, 'no delivery id');
		log.deliveryId = deliveryId;
		// Apps before 1.10 send no trigger and only had the hold gesture
		const trigger = log.trigger || 'single-click-hold';
		log.trigger = trigger;

		const { recording, duplicate, completed } = await createRecording({
			deliveryId,
			source: 'ring',
			trigger,
			signed: !!log.signed,
			recordedAt: new Date(recordedAtMs),
			audio: audioBytes
				? { bytes: audioBytes, mime: payload.audio!.type || 'audio/mp4' }
				: undefined,
			appTranscript: payload.transcription
		});
		log.recordingId = recording.id;
		if (duplicate) return await reply(200, 'duplicate');
		if (completed) return await reply(200, 'stored audio for an earlier delivery', 'ok');
		return await reply(200, audioBytes ? 'stored' : 'stored transcription', 'ok');
	} catch (e) {
		console.error('index01 webhook failed', e);
		// The cause goes to the Webhook page; the phone only sees "internal error"
		return await reply(500, `internal error: ${errorSummary(e)}`, 'internal error');
	}
};

/**
 * Reads the body up to `max` bytes. Null when it is larger, including when adapter-node's
 * BODY_SIZE_LIMIT stops it first (a SvelteKitError with status 413).
 */
async function readBody(request: Request, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
	if (!request.body) return new Uint8Array(new ArrayBuffer(0));
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > max) {
				await reader.cancel().catch(() => {});
				return null;
			}
			chunks.push(value);
		}
	} catch (e) {
		if ((e as { status?: unknown } | null)?.status === 413) return null;
		throw e;
	}
	const raw = new Uint8Array(size);
	let offset = 0;
	for (const c of chunks) {
		raw.set(c, offset);
		offset += c.byteLength;
	}
	return raw;
}

async function findByDelivery(deliveryId: string) {
	const [row] = await db
		.select({ id: recordings.id, audioMime: recordings.audioMime, audioPath: recordings.audioPath })
		.from(recordings)
		.where(eq(recordings.deliveryId, deliveryId))
		.limit(1);
	return row ?? null;
}
