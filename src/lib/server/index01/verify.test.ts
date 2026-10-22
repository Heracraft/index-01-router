import { describe, expect, it } from 'vitest';
import { hasSignatureHeaders, verifyIndexWebhook } from './verify.ts';
import {
	FIXTURE_A,
	buildIndexBody,
	fixtureABody,
	fixtureAHeaders,
	signIndex
} from './fixtures/build.ts';

const now = FIXTURE_A.timestamp + 10;
const secret = FIXTURE_A.secret;

describe('verifyIndexWebhook', () => {
	it('builds the documented fixture body and signature', () => {
		const body = fixtureABody();
		expect(body.byteLength).toBe(FIXTURE_A.bodyBytes);
		expect(
			signIndex(secret, FIXTURE_A.timestamp, FIXTURE_A.deliveryId, 'test-event', true, body)
		).toBe(FIXTURE_A.signature);
	});

	it('accepts the documented fixture', () => {
		const r = verifyIndexWebhook(fixtureAHeaders(), fixtureABody(), secret, { nowSec: now });
		expect(r).toEqual({
			ok: true,
			deliveryId: FIXTURE_A.deliveryId,
			trigger: 'test-event',
			isTest: true,
			timestamp: FIXTURE_A.timestamp
		});
	});

	it('rejects a wrong secret', () => {
		const r = verifyIndexWebhook(fixtureAHeaders(), fixtureABody(), secret + 'x', { nowSec: now });
		expect(r).toMatchObject({ ok: false, status: 401, reason: 'bad signature' });
	});

	it('rejects a tampered body', () => {
		const body = fixtureABody();
		body[body.length - 10] ^= 1;
		const r = verifyIndexWebhook(fixtureAHeaders(), body, secret, { nowSec: now });
		expect(r).toMatchObject({ ok: false, reason: 'bad signature' });
	});

	it.each([
		['x-index-delivery', '00000000-0000-4000-8000-000000000002'],
		['x-index-trigger', 'single-click-hold'],
		['x-index-test', 'false'],
		['x-index-timestamp', String(FIXTURE_A.timestamp + 1)]
	])('rejects a changed signed header %s', (name, value) => {
		const r = verifyIndexWebhook(fixtureAHeaders({ [name]: value }), fixtureABody(), secret, {
			nowSec: now
		});
		expect(r).toMatchObject({ ok: false, status: 401, reason: 'bad signature' });
	});

	it('rejects an uppercase or truncated signature', () => {
		for (const sig of [FIXTURE_A.signature.toUpperCase(), FIXTURE_A.signature.slice(0, 62)]) {
			const r = verifyIndexWebhook(
				fixtureAHeaders({ 'x-index-signature': sig }),
				fixtureABody(),
				secret,
				{
					nowSec: now
				}
			);
			expect(r).toMatchObject({ ok: false, status: 401, reason: 'malformed signature' });
		}
	});

	it('enforces the 300 s tolerance both ways', () => {
		const body = fixtureABody();
		expect(
			verifyIndexWebhook(fixtureAHeaders(), body, secret, { nowSec: FIXTURE_A.timestamp + 300 }).ok
		).toBe(true);
		expect(
			verifyIndexWebhook(fixtureAHeaders(), body, secret, { nowSec: FIXTURE_A.timestamp - 300 }).ok
		).toBe(true);
		expect(
			verifyIndexWebhook(fixtureAHeaders(), body, secret, { nowSec: FIXTURE_A.timestamp + 301 })
		).toMatchObject({ ok: false, reason: 'timestamp outside tolerance' });
		expect(
			verifyIndexWebhook(fixtureAHeaders(), body, secret, { nowSec: FIXTURE_A.timestamp - 301 })
		).toMatchObject({ ok: false, reason: 'timestamp outside tolerance' });
	});

	it('rejects missing headers, bad version, malformed timestamp, empty secret', () => {
		const body = fixtureABody();
		const h = fixtureAHeaders();
		h.delete('x-index-delivery');
		expect(verifyIndexWebhook(h, body, secret, { nowSec: now })).toMatchObject({
			status: 401,
			reason: 'missing signature headers'
		});
		expect(
			verifyIndexWebhook(fixtureAHeaders({ 'x-index-webhook-version': '2' }), body, secret, {
				nowSec: now
			})
		).toMatchObject({ status: 400, reason: 'unsupported webhook version' });
		expect(
			verifyIndexWebhook(fixtureAHeaders({ 'x-index-timestamp': '17e8' }), body, secret, {
				nowSec: now
			})
		).toMatchObject({ status: 400, reason: 'malformed timestamp' });
		expect(verifyIndexWebhook(fixtureAHeaders(), body, '', { nowSec: now })).toMatchObject({
			status: 401
		});
	});

	it('verifies a body with audio', () => {
		const audio = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x0d, 0x0a, 0x2d, 0x2d]);
		const delivery = 'ring_abc-3-uuid';
		const body = buildIndexBody({
			boundary: FIXTURE_A.boundary,
			audio,
			filename: `${delivery}.m4a`,
			transcription: 'Habari, this is a test.',
			recordedAtMs: 1700000000123
		});
		const sig = signIndex(secret, FIXTURE_A.timestamp, delivery, 'single-click-hold', false, body);
		const h = new Headers({
			'x-index-webhook-version': '1',
			'x-index-trigger': 'single-click-hold',
			'x-index-timestamp': String(FIXTURE_A.timestamp),
			'x-index-delivery': delivery,
			'x-index-signature': sig
		});
		expect(verifyIndexWebhook(h, body, secret, { nowSec: now })).toMatchObject({
			ok: true,
			isTest: false
		});
	});

	it('detects signature headers', () => {
		expect(hasSignatureHeaders(fixtureAHeaders())).toBe(true);
		expect(hasSignatureHeaders(new Headers({ 'x-index-timestamp': '1' }))).toBe(true);
		expect(hasSignatureHeaders(new Headers({ 'x-index-trigger': 'single-click-hold' }))).toBe(
			false
		);
	});
});
