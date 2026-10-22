import { describe, expect, it } from 'vitest';
import { entryMeta, entryState, seededBars, type EntryRec } from './entry.ts';

const base: EntryRec = {
	id: 'r1',
	recordedAt: new Date(),
	durationMs: 5000,
	status: 'done',
	transcript: 'Hello',
	error: null,
	attempts: 1,
	trigger: 'single-click-hold',
	languages: ['en'],
	transcribedBy: 'openai:gpt-transcribe',
	hasAudio: true,
	hasAppTranscript: false,
	deliveries: []
};

describe('entryState', () => {
	it('is silent for a line that landed', () => {
		expect(entryState(base)).toEqual({ kind: 'done' });
		expect(entryMeta(base)).toEqual([]);
	});

	it('retries a failed delivery and deletes unreadable audio', () => {
		const st = entryState({
			...base,
			status: 'failed',
			deliveries: [
				{
					id: 'd1',
					status: 'failed',
					error: 'Obsidian did not answer in time',
					attempts: 3,
					target: null,
					stale: false,
					name: 'Daily note',
					updatedAt: new Date()
				}
			]
		});
		expect(st).toMatchObject({
			kind: 'failed',
			step: 'deliver',
			fix: { action: 'redeliver', delivery: 'd1' }
		});
		expect(
			entryState({
				...base,
				status: 'failed',
				transcript: null,
				error: 'OpenAI 400: Audio file might be corrupted'
			})
		).toMatchObject({ step: 'transcribe', cause: 'Audio unreadable', fix: { action: 'delete' } });
	});

	it('marks one exception, never how it came in', () => {
		expect(
			entryMeta({
				...base,
				trigger: 'double-click-hold',
				languages: ['en', 'sw'],
				transcribedBy: 'index-app'
			})
		).toEqual(['English, Swahili']);
		expect(entryMeta({ ...base, trigger: 'double-click-hold' })).toEqual([]);
	});

	it('puts the outcome first and lets No speech speak for itself', () => {
		expect(
			entryMeta({
				...base,
				trigger: 'upload',
				deliveries: [
					{
						id: 'd1',
						status: 'sent',
						error: null,
						attempts: 1,
						target: 'Daily/x.md',
						stale: true,
						name: 'Daily note',
						updatedAt: new Date()
					}
				]
			})
		).toEqual(['Edited']);
		expect(entryMeta({ ...base, transcript: null, trigger: 'upload' })).toEqual([]);
		expect(
			entryMeta({ ...base, status: 'transcribing', transcript: null, trigger: 'upload' })
		).toEqual([]);
	});

	it('draws the same bars for the same id', () => {
		expect(seededBars('abc', 10)).toEqual(seededBars('abc', 10));
		expect(seededBars('abc', 10).every((h) => h >= 0.2 && h <= 1)).toBe(true);
	});
});
