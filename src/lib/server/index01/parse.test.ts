import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { filenameStem, isTestEvent, readIndexForm, resolveDeliveryId } from './parse.ts';
import { FIXTURE_A, buildIndexBody, fixtureABody } from './fixtures/build.ts';

const form = (body: Uint8Array<ArrayBuffer>, boundary = FIXTURE_A.boundary) =>
	new Response(body, {
		headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }
	}).formData();

describe('readIndexForm', () => {
	it('reads the test event fixture', async () => {
		const p = readIndexForm(await form(fixtureABody()));
		expect(p).toEqual({
			audio: null,
			transcription: 'Index webhook test event',
			recordedAtMs: 1700000000123,
			testField: true,
			client: 'ring'
		});
	});

	it('reads audio, keeps bytes and filename', async () => {
		const audio = new Uint8Array([1, 2, 3, 13, 10, 45, 45, 4]);
		const body = buildIndexBody({
			boundary: FIXTURE_A.boundary,
			audio,
			filename: 'ring_7-12-abc.m4a',
			recordedAtMs: 1
		});
		const p = readIndexForm(await form(body));
		expect(p.audio?.name).toBe('ring_7-12-abc.m4a');
		expect(p.audio?.type).toBe('audio/mp4');
		expect(new Uint8Array(await p.audio!.arrayBuffer())).toEqual(audio);
		expect(p.transcription).toBeNull();
		expect(p.testField).toBe(false);
	});

	it('treats blank transcription and bad recordedAt as missing', async () => {
		const fd = new FormData();
		fd.set('transcription', '  \r\n');
		fd.set('recordedAt', 'yesterday');
		const p = readIndexForm(fd);
		expect(p.transcription).toBeNull();
		expect(p.recordedAtMs).toBeNull();
	});
});

describe('isTestEvent', () => {
	it('checks header, trigger and field', () => {
		expect(isTestEvent(new Headers({ 'x-index-test': 'true' }), false)).toBe(true);
		expect(isTestEvent(new Headers({ 'x-index-trigger': 'test-event' }), false)).toBe(true);
		expect(isTestEvent(new Headers(), true)).toBe(true);
		expect(isTestEvent(new Headers({ 'x-index-trigger': 'single-click-hold' }), false)).toBe(false);
	});
});

describe('resolveDeliveryId', () => {
	it('prefers the signed header', () => {
		expect(
			resolveDeliveryId({ headerId: 'd-1', filename: 'ring_1-2-x.m4a', recordedAtMs: 5 })
		).toBe('d-1');
	});

	it('uses the audio filename stem when unsigned', () => {
		expect(resolveDeliveryId({ filename: 'ring_1-2-uuid.m4a', recordedAtMs: 5 })).toBe(
			'ring_1-2-uuid'
		);
		expect(resolveDeliveryId({ filename: 'manual_recording-abc.m4a', recordedAtMs: 5 })).toBe(
			'manual_recording-abc'
		);
	});

	it('falls back to text-<recordedAt>-<sha12> for transcription only', () => {
		const t = 'Nimefika, see you at 5';
		const hash = createHash('sha256').update(t).digest('hex').slice(0, 12);
		expect(resolveDeliveryId({ transcription: t, recordedAtMs: 1700000000123 })).toBe(
			`text-1700000000123-${hash}`
		);
	});

	it('hashes audio when the filename is generic', () => {
		const audioBytes = new Uint8Array([1, 2, 3]);
		const id = resolveDeliveryId({ filename: 'recording.m4a', audioBytes, recordedAtMs: 9 });
		expect(id).toMatch(/^audio-9-[0-9a-f]{12}$/);
	});

	it('returns null with nothing to key on', () => {
		expect(resolveDeliveryId({ recordedAtMs: 9 })).toBeNull();
	});

	it('rejects path-like or odd filenames as ids', () => {
		expect(filenameStem('../../etc/passwd')).toBe('passwd');
		expect(filenameStem('a b.m4a')).toBeNull();
		expect(filenameStem('Recording.M4A')).toBeNull();
		expect(filenameStem('')).toBeNull();
	});
});
