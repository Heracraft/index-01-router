import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it } from 'vitest';
import {
	containsEntry,
	continuesList,
	entryOrder,
	findHeadingPath,
	insertInOrder,
	notePerDay,
	obsidianConfig,
	OBSIDIAN_DEFAULTS,
	separatorBefore,
	toDeliverError
} from './obsidian.ts';
import { DeliverError } from './types.ts';

describe('findHeadingPath', () => {
	const map = {
		'2026-10-22': { Tasks: {}, Notes: { Later: {} }, Journal: {} },
		Other: { notes: {} }
	};

	it('returns the full path at any depth', () => {
		expect(findHeadingPath(map, 'Notes')).toEqual(['2026-10-22', 'Notes']);
		expect(findHeadingPath(map, 'Later')).toEqual(['2026-10-22', 'Notes', 'Later']);
		expect(findHeadingPath({ Notes: {} }, 'Notes')).toEqual(['Notes']);
	});

	it('prefers an exact match, then ignores case', () => {
		expect(findHeadingPath({ notes: {}, x: { Notes: {} } }, 'Notes')).toEqual(['x', 'Notes']);
		expect(findHeadingPath({ a: { NOTES: {} } }, 'Notes')).toEqual(['a', 'NOTES']);
	});

	it('returns null when absent', () => {
		expect(findHeadingPath({ a: { b: {} } }, 'Notes')).toBeNull();
		expect(findHeadingPath({}, 'Notes')).toBeNull();
	});
});

describe('separatorBefore', () => {
	it('leaves one blank line before appended text', () => {
		expect(separatorBefore('')).toBe('');
		expect(separatorBefore('a')).toBe('\n\n');
		expect(separatorBefore('a\n')).toBe('\n');
		expect(separatorBefore('a\n\n')).toBe('');
	});
});

describe('continuesList', () => {
	it('extends a list that ends the section', () => {
		expect(continuesList('- a\n- b\n', '- c')).toBe(true);
		expect(continuesList('Intro\n\n- a\n  more\n', '- c')).toBe(true);
		expect(continuesList('1. a\n', '- c')).toBe(true);
	});

	it('starts a new block otherwise', () => {
		expect(continuesList('', '- c')).toBe(false);
		expect(continuesList('- a\n\nSome text\n', '- c')).toBe(false);
		expect(continuesList('- a\n\n### Later\n- b\n', '- c')).toBe(false);
		expect(continuesList('- a\n', 'Plain entry')).toBe(false);
	});
});

describe('containsEntry', () => {
	it('matches whole lines only', () => {
		const body = '- 10:00 Buy milk and eggs\n';
		expect(containsEntry(body, '- 10:00 Buy milk and eggs')).toBe(true);
		expect(containsEntry(body, '- 10:00 Buy milk')).toBe(false);
		expect(containsEntry('- OK then\n', '- OK')).toBe(false);
		expect(containsEntry('- a\n- OK\n- b', '- OK')).toBe(true);
		expect(containsEntry('x - OK', '- OK')).toBe(false);
	});

	it('matches a multi-line entry and ignores CRLF', () => {
		const entry = '- 10:00 Line one\n  Line two';
		expect(containsEntry('- 09:00 a\r\n- 10:00 Line one\r\n  Line two\r\n', entry)).toBe(true);
		expect(containsEntry('- 10:00 Line one\n  Line three\n', entry)).toBe(false);
	});

	it('does not match the first line of a longer item', () => {
		expect(containsEntry('- 10:00 Buy milk\n  and eggs\n', '- 10:00 Buy milk')).toBe(false);
		expect(containsEntry('- 10:00 Buy milk\n- 10:01 x\n', '- 10:00 Buy milk')).toBe(true);
	});

	it('treats special characters literally', () => {
		expect(containsEntry('- (a) [b] $c.*\n', '- (a) [b] $c.*')).toBe(true);
		expect(containsEntry('- (a) [b] $cx\n', '- (a) [b] $c.')).toBe(false);
	});
});

describe('notePerDay', () => {
	it('needs year, month and day in a date token', () => {
		expect(notePerDay('{{date:YYYY-MM-DD}}.md')).toBe(true);
		expect(notePerDay('Daily/{{date}}.md')).toBe(true);
		expect(notePerDay('{{date:YYYY}}/{{date:YYYY-MM-DD dddd}}.md')).toBe(true);
		expect(notePerDay('Inbox.md')).toBe(false);
		expect(notePerDay('{{date:YYYY-MM}}.md')).toBe(false);
	});
});

describe('entryOrder', () => {
	it('reads the time after the literal prefix', () => {
		const key = entryOrder('- {{time:HH:mm}} {{transcript}}')!;
		expect(key('- 09:05 hi')).toBe('0905');
		expect(key('- [ ] task')).toBeNull();
		expect(key('  - 09:05 nested')).toBeNull();
		expect(entryOrder('- {{time}} {{transcript}}')!('- 23:59 x')).toBe('2359');
		expect(entryOrder('**{{time:HH.mm.ss}}** {{transcript}}')!('**07.08.09** x')).toBe('070809');
	});

	it('ranks date tokens before time whatever their order in the format', () => {
		const key = entryOrder('- {{time:HH:mm DD.MM.YYYY}} {{transcript}}')!;
		expect(key('- 09:00 22.10.2026 x')).toBe('202610220900');
	});

	it('is null without a leading time token or with named parts', () => {
		expect(entryOrder('- {{transcript}} {{time}}')).toBeNull();
		expect(entryOrder('{{transcript}}')).toBeNull();
		expect(entryOrder('- {{time:ddd HH:mm}} {{transcript}}')).toBeNull();
	});

	it('needs a date in the format when the note is not daily', () => {
		expect(entryOrder('- {{time}} {{transcript}}', false)).toBeNull();
		expect(entryOrder('- {{time:YYYY-MM-DD HH:mm}} {{transcript}}', false)).not.toBeNull();
	});
});

describe('insertInOrder', () => {
	const key = entryOrder('- {{time:HH:mm}} {{transcript}}')!;

	it('puts an earlier entry before the first later one', () => {
		expect(insertInOrder('- 09:02 short two\n', '- 09:00 long one', key)).toBe(
			'- 09:00 long one\n- 09:02 short two\n'
		);
		expect(
			insertInOrder('- 08:00 a\n- 09:30 b\n  more b\n- 10:00 c\n', '- 09:00 x\n  y', key)
		).toBe('- 08:00 a\n- 09:00 x\n  y\n- 09:30 b\n  more b\n- 10:00 c\n');
	});

	it('returns null when the entry is the latest', () => {
		expect(insertInOrder('- 08:00 a\n- 09:00 b\n', '- 09:00 c', key)).toBeNull();
		expect(insertInOrder('', '- 09:00 c', key)).toBeNull();
	});

	it('ignores other lines and stops at a sub-heading', () => {
		expect(insertInOrder('Intro\n- [ ] task\n- 11:00 b\n', '- 10:00 a', key)).toBe(
			'Intro\n- [ ] task\n- 10:00 a\n- 11:00 b\n'
		);
		expect(insertInOrder('- 08:00 a\n\n# Later\n- 11:00 b\n', '- 10:00 x', key)).toBeNull();
	});

	it('keeps a paragraph entry apart', () => {
		const para = entryOrder('{{time}} {{transcript}}')!;
		expect(insertInOrder('11:00 b\n', '10:00 a', para)).toBe('10:00 a\n\n11:00 b\n');
	});
});

describe('obsidianConfig', () => {
	it('reads the old default new note template as the current one', () => {
		expect(obsidianConfig({ newNoteTemplate: '## Notes\n' }).newNoteTemplate).toBe(
			OBSIDIAN_DEFAULTS.newNoteTemplate
		);
		expect(obsidianConfig({ newNoteTemplate: '# Day\n\n## Notes\n' }).newNoteTemplate).toBe(
			'# Day\n\n## Notes\n'
		);
	});

	it('fills defaults and strips heading hashes', () => {
		const c = obsidianConfig({
			url: ' http://x/mcp/ ',
			apiKey: 'k',
			heading: '## Log',
			notePath: ''
		});
		expect(c).toEqual({ ...OBSIDIAN_DEFAULTS, url: 'http://x/mcp/', apiKey: 'k', heading: 'Log' });
	});

	it('keeps an empty new note template and reads boolean strings', () => {
		const c = obsidianConfig({ newNoteTemplate: '', insecureTls: 'true' });
		expect(c.newNoteTemplate).toBe('');
		expect(c.insecureTls).toBe(true);
	});
});

describe('toDeliverError', () => {
	const url = 'http://obsidian/mcp/';
	const refused = Object.assign(new TypeError('fetch failed'), {
		cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' })
	});

	it('marks auth and missing endpoints as final', () => {
		expect(toDeliverError(new StreamableHTTPError(401, 'no'), url)).toMatchObject({
			retryable: false,
			message: 'Obsidian rejected the API key'
		});
		expect(toDeliverError(new StreamableHTTPError(404, 'no'), url).retryable).toBe(false);
	});

	it('retries network errors and server errors', () => {
		expect(toDeliverError(refused, url)).toMatchObject({
			retryable: true,
			message: `Cannot reach ${url} (ECONNREFUSED)`
		});
		expect(toDeliverError(new StreamableHTTPError(503, 'busy'), url).retryable).toBe(true);
	});

	it('explains certificate failures', () => {
		const tls = Object.assign(new TypeError('fetch failed'), {
			cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }
		});
		const e = toDeliverError(tls, url);
		expect(e.retryable).toBe(false);
		expect(e.field).toBe('insecureTls');
		expect(e.message).toContain('Tick Accept a self-signed certificate');
	});

	it('passes DeliverError through', () => {
		const e = new DeliverError('x', false);
		expect(toDeliverError(e, url)).toBe(e);
	});
});
