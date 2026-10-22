// Sends an Index 01 webhook request built like the app does (protocol v1).
//
//   node --experimental-strip-types scripts/send-test-webhook.ts --url http://localhost:5173/api/index01/webhook \
//     --secret "$SECRET" --file ring.m4a [--trigger single-click-hold] [--transcription text]
//
// Options:
//   --url URL            webhook endpoint (required)
//   --secret S           signing secret; omit to send unsigned
//   --file PATH          audio part (audio/mp4); omit for transcription only
//   --transcription T    transcription part
//   --trigger T          X-Index-Trigger, default single-click-hold
//   --test               send a test event (trigger test-event, X-Index-Test, test=true)
//   --delivery ID        delivery id, default ring_0-<n>-<uuid>; reuse it to test duplicates
//   --recorded-at MS     recordedAt epoch ms, default now
//   --timestamp SEC      X-Index-Timestamp override, default now
//   --tamper             flip one body byte after signing
//   --audio-size N       X-Audio-Size override
//   --expect STATUS      exit 1 unless the response has this status (default: any 2xx)
//   --expect-body TEXT   exit 1 unless the response body equals TEXT
// Prints "<status> <body>" and the delivery id on stderr.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { buildIndexBody, signIndex } from '../src/lib/server/index01/fixtures/build.ts';

const { values: a } = parseArgs({
	options: {
		url: { type: 'string' },
		secret: { type: 'string' },
		file: { type: 'string' },
		transcription: { type: 'string' },
		trigger: { type: 'string' },
		test: { type: 'boolean', default: false },
		delivery: { type: 'string' },
		'recorded-at': { type: 'string' },
		timestamp: { type: 'string' },
		tamper: { type: 'boolean', default: false },
		'audio-size': { type: 'string' },
		expect: { type: 'string' },
		'expect-body': { type: 'string' }
	}
});

if (!a.url) {
	console.error('--url is required');
	process.exit(2);
}

const isTest = a.test;
const trigger = isTest ? 'test-event' : (a.trigger ?? 'single-click-hold');
const deliveryId =
	a.delivery ?? (isTest ? randomUUID() : `ring_0-${Date.now() % 1000}-${randomUUID()}`);
const audio = a.file ? new Uint8Array(await readFile(a.file)) : undefined;
const transcription = isTest ? (a.transcription ?? 'Index webhook test event') : a.transcription;
const boundary = randomUUID();
const body = buildIndexBody({
	boundary,
	audio,
	filename: audio ? `${deliveryId}.m4a` : undefined,
	transcription,
	recordedAtMs: a['recorded-at'] ? Number(a['recorded-at']) : Date.now(),
	isTest
});

const headers: Record<string, string> = {
	'content-type': `multipart/form-data; boundary=${boundary}`,
	'x-index-webhook-version': '1',
	'x-index-trigger': trigger,
	'user-agent': 'CoreApp/send-test-webhook',
	accept: 'application/json'
};
if (isTest) headers['x-index-test'] = 'true';
if (audio) headers['x-audio-size'] = a['audio-size'] ?? String(audio.byteLength);
if (a.secret) {
	const ts = a.timestamp ?? String(Math.floor(Date.now() / 1000));
	headers['x-index-timestamp'] = ts;
	headers['x-index-delivery'] = deliveryId;
	headers['x-index-signature'] = signIndex(a.secret, ts, deliveryId, trigger, isTest, body);
}
if (a.tamper) body[body.length - 20] ^= 1;

const res = await fetch(a.url, { method: 'POST', headers, body });
const text = await res.text();
console.log(`${res.status} ${text}`);
// Unsigned requests carry the id only in the audio filename
const sentId = a.secret || audio ? deliveryId : 'none (unsigned, no audio)';
console.error(
	`delivery ${sentId}${audio ? `, ${path.basename(a.file!)} ${audio.byteLength} bytes` : ''}`
);

const okStatus = a.expect ? res.status === Number(a.expect) : res.ok;
const okBody = a['expect-body'] === undefined || text === a['expect-body'];
if (!okStatus || !okBody) {
	console.error(
		`expected ${a.expect ?? '2xx'}${a['expect-body'] !== undefined ? ` "${a['expect-body']}"` : ''}`
	);
	process.exit(1);
}
