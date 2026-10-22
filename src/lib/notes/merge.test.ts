import { describe, expect, it } from 'vitest';
import { mergeSheet } from './merge.ts';
import { parseNote, sectionOf } from './sheet.ts';
import type { EntryRec } from '../entry.ts';

const rec = (id: string, hhmm: string, over: Partial<EntryRec> = {}): EntryRec => ({
	id,
	recordedAt: new Date(`2026-10-21T${hhmm}:00Z`),
	durationMs: 5000,
	status: 'done',
	transcript: `Said at ${hhmm}`,
	error: null,
	attempts: 1,
	trigger: 'single-click-hold',
	languages: ['en'],
	transcribedBy: 'openai:gpt-transcribe',
	hasAudio: true,
	hasAppTranscript: false,
	deliveries: [
		{
			id: `d${id}`,
			status: 'sent',
			error: null,
			attempts: 1,
			target: 'Daily/2026-10-21.md',
			stale: false,
			name: 'Daily note',
			updatedAt: new Date()
		}
	],
	...over
});
const opts = {
	path: 'Daily/2026-10-21.md',
	entryTemplate: '- {{time:HH:mm}} {{transcript}}',
	timeZone: 'UTC'
};
const section = (md: string) => sectionOf(parseNote(md), 'Notes');

describe('mergeSheet', () => {
	it('matches lines to the recordings that wrote them and keeps typed lines in place', () => {
		const lines = mergeSheet(
			[rec('a', '08:47'), rec('b', '21:15')],
			section('## Notes\n- 08:30 Coffee\n- 08:47 Said at 08:47\n- 21:15 Said at 21:15'),
			opts
		);
		expect(lines.map((l) => (l.type === 'typed' ? `t ${l.time}` : `r ${l.rec.id}`))).toEqual([
			't 08:30',
			'r a',
			'r b'
		]);
	});

	it('places a failed recording by time and in-flight ones at the end', () => {
		const failed = rec('f', '12:00', { status: 'failed', transcript: null, deliveries: [] });
		const flying = rec('w', '09:00', { status: 'received', transcript: null, deliveries: [] });
		const lines = mergeSheet(
			[failed, flying, rec('a', '08:47')],
			section('## Notes\n- 08:47 Said at 08:47\n- 14:00 Lunch'),
			opts
		);
		expect(lines.map((l) => l.key)).toEqual(['a', 'f', 't1', 'w']);
	});

	it('matches an edited transcript to its line by minute, so it does not show twice', () => {
		const edited = rec('e', '10:00', { transcript: 'New words' });
		const lines = mergeSheet([edited], section('## Notes\n- 10:00 Old words'), opts);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatchObject({ type: 'rec', key: 'e' });
	});

	it('shows recordings alone when the note could not be read', () => {
		const lines = mergeSheet([rec('b', '21:15'), rec('a', '08:47')], null, opts);
		expect(lines.map((l) => l.key)).toEqual(['a', 'b']);
	});
});
