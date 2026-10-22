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
import { hasSignatureHeaders, verifyIndexWebhook } from '#lib/server/index01/verify.ts';
import { getSettings } from '#lib/server/settings.ts';
import { logWebhookEvent, type WebhookLogEntry } from '#lib/server/webhook-log.ts';
import type { RequestHandler } from './$types';

/** Multipart overhead allowed on top of the audio limit before the body is even read */
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
		if (log.bytes! > MAX_BODY_BYTES) return await reply(413, 'payload too large');
		const raw = new Uint8Array(await request.arrayBuffer());
		log.bytes = raw.byteLength;
		if (raw.byteLength > MAX_BODY_BYTES) return await reply(413, 'payload too large');

		const version = headers.get('x-index-webhook-version');
		if (version !== null && version !== '1') return await reply(400, 'unsupported webhook version');

		const settings = await getSettings('webhook');
		let headerId: string | null = null;
		if (hasSignatureHeaders(headers)) {
			const v = verifyIndexWebhook(headers, raw, settings.secret, { toleranceSec: 300 });
			if (!v.ok) return await reply(v.status, v.reason);
			log.signed = true;
			headerId = v.deliveryId;
		} else if (settings.requireSignature) {
			return await reply(401, 'signature required');
		}

		// Signed resend: answer before parsing
		if (headerId) {
			const existing = await findByDelivery(headerId);
			if (existing) {
				log.recordingId = existing;
				return await reply(200, 'duplicate');
			}
		}

		const contentType = headers.get('content-type') ?? '';
		if (!contentType.toLowerCase().startsWith('multipart/form-data'))
			return await reply(415, 'expected multipart/form-data');
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

		const { recording, duplicate } = await createRecording({
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
		return await reply(200, audioBytes ? 'stored' : 'stored transcription', 'ok');
	} catch (e) {
		console.error('index01 webhook failed', e);
		return await reply(500, 'internal error');
	}
};

async function findByDelivery(deliveryId: string) {
	const [row] = await db
		.select({ id: recordings.id })
		.from(recordings)
		.where(eq(recordings.deliveryId, deliveryId))
		.limit(1);
	return row?.id ?? null;
}
