// Builds request bodies byte-identical to the Index 01 app's buildWebhookMultipartBody().
// Used by tests and scripts/send-test-webhook.ts. Node built-ins only, no Kit imports.
import { createHmac } from 'node:crypto';

export interface IndexBodyInput {
	boundary: string;
	audio?: Uint8Array;
	/** The app sends `<deliveryId>.m4a`, falling back to `recording.m4a` */
	filename?: string;
	transcription?: string;
	recordedAtMs: number;
	isTest?: boolean;
}

export function buildIndexBody(p: IndexBodyInput): Uint8Array<ArrayBuffer> {
	const enc = new TextEncoder();
	const parts: Uint8Array[] = [];
	const b = p.boundary;
	if (p.audio) {
		parts.push(
			enc.encode(
				`--${b}\r\nContent-Disposition: form-data; name="audio"; filename="${p.filename ?? 'recording.m4a'}"\r\nContent-Type: audio/mp4\r\n\r\n`
			)
		);
		parts.push(p.audio, enc.encode('\r\n'));
	}
	if (p.transcription !== undefined)
		parts.push(
			enc.encode(
				`--${b}\r\nContent-Disposition: form-data; name="transcription"\r\n\r\n${p.transcription}\r\n`
			)
		);
	let meta = '';
	if (p.isTest) meta += `--${b}\r\nContent-Disposition: form-data; name="test"\r\n\r\ntrue\r\n`;
	meta += `--${b}\r\nContent-Disposition: form-data; name="recordedAt"\r\n\r\n${p.recordedAtMs}\r\n`;
	meta += `--${b}\r\nContent-Disposition: form-data; name="client"\r\n\r\nring\r\n`;
	meta += `--${b}--\r\n`;
	parts.push(enc.encode(meta));
	return new Uint8Array(Buffer.concat(parts));
}

export function signIndex(
	secret: string,
	ts: number | string,
	deliveryId: string,
	trigger: string,
	isTest: boolean,
	body: Uint8Array
) {
	return createHmac('sha256', Buffer.from(secret, 'utf8'))
		.update(`v1\n${ts}\n${deliveryId}\n${trigger}\n${isTest ? '1' : '0'}\n`)
		.update(body)
		.digest('hex');
}

/** Fixture A from the protocol notes: a signed test event, verify with nowSec 1700000010 */
export const FIXTURE_A = {
	secret: 'test-secret-0123456789abcdef0123456789abcdef',
	boundary: '3f1c2a9e-7b4d-4e8a-9c1f-5d6e7f8a9b0c',
	timestamp: 1700000000,
	deliveryId: '00000000-0000-4000-8000-000000000001',
	trigger: 'test-event',
	recordedAtMs: 1700000000123,
	transcription: 'Index webhook test event',
	bodyBytes: 460,
	signature: '69b228768ecf3116f764d2b7a0e409b07b1c4247ea0734dd30eb443ab5b977f2'
};

export function fixtureABody() {
	return buildIndexBody({
		boundary: FIXTURE_A.boundary,
		transcription: FIXTURE_A.transcription,
		recordedAtMs: FIXTURE_A.recordedAtMs,
		isTest: true
	});
}

export function fixtureAHeaders(overrides: Record<string, string> = {}) {
	return new Headers({
		'content-type': `multipart/form-data; boundary=${FIXTURE_A.boundary}`,
		'x-index-webhook-version': '1',
		'x-index-trigger': FIXTURE_A.trigger,
		'x-index-test': 'true',
		'x-index-timestamp': String(FIXTURE_A.timestamp),
		'x-index-delivery': FIXTURE_A.deliveryId,
		'x-index-signature': FIXTURE_A.signature,
		'user-agent': 'CoreApp/1.15.0',
		...overrides
	});
}
