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

	it('marks only the exceptions', () => {
		expect(
			entryMeta({
				...base,
				trigger: 'double-click-hold',
				languages: ['en', 'sw'],
				transcribedBy: 'index-app'
			})
		).toEqual(['Double click', 'App transcript', 'English, Swahili']);
	});

	it('draws the same bars for the same id', () => {
		expect(seededBars('abc', 10)).toEqual(seededBars('abc', 10));
		expect(seededBars('abc', 10).every((h) => h >= 0.2 && h <= 1)).toBe(true);
	});
});
