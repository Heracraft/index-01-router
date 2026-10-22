import { describe, expect, it } from 'vitest';
import { parseNote, sectionOf } from './sheet.ts';

const NOTE = `---
tags: daily
---
# 2026-10-21

## Tasks
- [ ] Call the plumber
- [x] Pay rent

## Notes
- 08:30 Coffee with Amina
- 08:47 Recordar enviar el informe
  a Lucía antes del viernes
Plain line without a time

## Journal
Quiet morning.
`;

describe('parseNote', () => {
	it('reads headings, tasks, timed items with continuations, and paragraphs', () => {
		const blocks = parseNote(NOTE);
		expect(blocks[0]).toEqual({ type: 'heading', level: 1, text: '2026-10-21' });
		const notes = sectionOf(blocks, 'notes')!;
		expect(notes).toHaveLength(2);
		expect(notes[0]).toMatchObject({ type: 'item', time: '08:30', text: 'Coffee with Amina' });
		expect(notes[1]).toMatchObject({
			time: '08:47',
			text: 'Recordar enviar el informe a Lucía antes del viernes Plain line without a time'
		});
		const tasks = sectionOf(blocks, 'Tasks')!;
		expect(tasks.map((b) => b.type !== 'heading' && b.task)).toEqual([false, true]);
	});

	it('stops a section at the next heading of its level, and misses a heading that is not there', () => {
		const blocks = parseNote('## Notes\n- 9:05 a\n### Sub\n- b\n## Other\n- c');
		expect(sectionOf(blocks, 'Notes')).toHaveLength(3);
		expect(sectionOf(blocks, 'Notes')![0]).toMatchObject({ time: '09:05' });
		expect(sectionOf(blocks, 'Missing')).toBeNull();
	});
});
