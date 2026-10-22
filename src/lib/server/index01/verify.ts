import { createHmac, timingSafeEqual } from 'node:crypto';

export type IndexVerifyResult =
	| { ok: true; deliveryId: string; trigger: string; isTest: boolean; timestamp: number }
	| { ok: false; status: 400 | 401; reason: string };

export const SIGNATURE_HEADERS = ['x-index-signature', 'x-index-timestamp', 'x-index-delivery'];

/** True when the request carries any of the signing headers, so it must verify */
export function hasSignatureHeaders(headers: Headers) {
	return SIGNATURE_HEADERS.some((h) => headers.has(h));
}

export interface IndexSignedHeaders {
	version: string;
	sig: string;
	tsText: string;
	deliveryId: string;
	trigger: string;
	isTest: boolean;
	timestamp: number;
}

export type IndexPrecheckResult =
	({ ok: true } & IndexSignedHeaders) | { ok: false; status: 400 | 401; reason: string };

/**
 * The checks that need only the headers: version, presence, secret, timestamp window and
 * signature format. Run it before reading the body so unsigned junk is rejected cheaply.
 */
export function precheckIndexHeaders(
	headers: Headers,
	secret: string,
	opts: { toleranceSec?: number; nowSec?: number } = {}
): IndexPrecheckResult {
	const tolerance = opts.toleranceSec ?? 300;
	const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
	const version = headers.get('x-index-webhook-version');
	if (version !== '1') return { ok: false, status: 400, reason: 'unsupported webhook version' };
	const sig = headers.get('x-index-signature') ?? '';
	const tsText = headers.get('x-index-timestamp') ?? '';
	const deliveryId = headers.get('x-index-delivery') ?? '';
	const trigger = headers.get('x-index-trigger') ?? '';
	const isTest = headers.get('x-index-test') === 'true';
	if (!sig || !tsText || !deliveryId)
		return { ok: false, status: 401, reason: 'missing signature headers' };
	if (!secret) return { ok: false, status: 401, reason: 'no signing secret configured' };
	if (!/^\d{1,12}$/.test(tsText)) return { ok: false, status: 400, reason: 'malformed timestamp' };
	const timestamp = Number(tsText);
	if (Math.abs(now - timestamp) > tolerance)
		return { ok: false, status: 401, reason: 'timestamp outside tolerance' };
	if (!/^[0-9a-f]{64}$/.test(sig)) return { ok: false, status: 401, reason: 'malformed signature' };
	return { ok: true, version, sig, tsText, deliveryId, trigger, isTest, timestamp };
}

/**
 * Index 01 webhook signature, protocol v1. HMAC-SHA256 with the secret as UTF-8 over
 * "v1\n<ts>\n<delivery>\n<trigger>\n<0|1>\n" followed by the raw multipart body.
 * `pre` comes from a successful precheckIndexHeaders.
 */
export function verifyIndexSignature(
	pre: IndexSignedHeaders,
	raw: Uint8Array,
	secret: string
): IndexVerifyResult {
	const prefix = `v${pre.version}\n${pre.tsText}\n${pre.deliveryId}\n${pre.trigger}\n${pre.isTest ? '1' : '0'}\n`;
	const expected = createHmac('sha256', Buffer.from(secret, 'utf8'))
		.update(Buffer.from(prefix, 'utf8'))
		.update(raw)
		.digest();
	const given = Buffer.from(pre.sig, 'hex');
	if (given.length !== expected.length || !timingSafeEqual(given, expected))
		return { ok: false, status: 401, reason: 'bad signature' };
	const { deliveryId, trigger, isTest, timestamp } = pre;
	return { ok: true, deliveryId, trigger, isTest, timestamp };
}

/** Header precheck plus signature, for callers that already hold the body */
export function verifyIndexWebhook(
	headers: Headers,
	raw: Uint8Array,
	secret: string,
	opts: { toleranceSec?: number; nowSec?: number } = {}
): IndexVerifyResult {
	const pre = precheckIndexHeaders(headers, secret, opts);
	if (!pre.ok) return pre;
	return verifyIndexSignature(pre, raw, secret);
}
