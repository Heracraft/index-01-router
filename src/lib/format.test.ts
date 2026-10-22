import { describe, expect, it } from 'vitest';
import {
	dayKey,
	dayLabel,
	firstLine,
	formatBytes,
	formatDateTime,
	formatDay,
	formatDuration,
	formatElapsed,
	formatTime,
	httpTone,
	isLanguageCode,
	languageName,
	parseLanguages,
	startOfDay,
	startOfWeek,
	statusLabel,
	triggerLabel
} from './format.ts';

describe('dates in a zone', () => {
	const at = new Date('2026-10-22T21:30:05Z');

	it('formats wall clock time in the zone', () => {
		expect(formatTime(at, 'Africa/Nairobi')).toBe('00:30');
		expect(formatTime(at, 'UTC', true)).toBe('21:30:05');
		expect(dayKey(at, 'Africa/Nairobi')).toBe('2026-10-23');
		expect(dayKey(at, 'UTC')).toBe('2026-10-22');
	});

	it('shows the year only when it differs', () => {
		expect(formatDay(at, 'UTC', at)).toBe('Oct 22');
		expect(formatDay(at, 'UTC', new Date('2027-01-02T00:00:00Z'))).toBe('Oct 22, 2026');
		expect(formatDateTime(at, 'UTC', { now: at })).toBe('Oct 22, 21:30');
	});

	it('finds midnight in the zone', () => {
		expect(startOfDay(at, 'UTC').toISOString()).toBe('2026-10-22T00:00:00.000Z');
		expect(startOfDay(at, 'Africa/Nairobi').toISOString()).toBe('2026-10-22T21:00:00.000Z');
		expect(startOfDay(at, 'America/New_York').toISOString()).toBe('2026-10-22T04:00:00.000Z');
	});

	it('handles a DST change day', () => {
		// Berlin leaves summer time on 2026-10-25 at 03:00 local
		const d = new Date('2026-10-25T12:00:00Z');
		expect(startOfDay(d, 'Europe/Berlin').toISOString()).toBe('2026-10-24T22:00:00.000Z');
	});

	it('starts the week on Monday', () => {
		// 2026-10-22 is a Thursday
		expect(startOfWeek(at, 'UTC').toISOString()).toBe('2026-10-19T00:00:00.000Z');
		const monday = new Date('2026-10-19T08:00:00Z');
		expect(startOfWeek(monday, 'UTC').toISOString()).toBe('2026-10-19T00:00:00.000Z');
		const sunday = new Date('2026-10-25T23:00:00Z');
		expect(startOfWeek(sunday, 'UTC').toISOString()).toBe('2026-10-19T00:00:00.000Z');
	});

	it('labels nearby days', () => {
		const now = new Date('2026-10-22T10:00:00Z');
		expect(dayLabel(now, 'UTC', now)).toBe('Today');
		expect(dayLabel(new Date('2026-10-21T23:59:00Z'), 'UTC', now)).toBe('Yesterday');
		expect(dayLabel(new Date('2026-10-19T10:00:00Z'), 'UTC', now)).toBe('Oct 19');
	});

	it('falls back to UTC for an unknown zone', () => {
		expect(formatTime(at, 'Mars/Olympus')).toBe('21:30');
	});
});

describe('numbers', () => {
	it('formats audio length', () => {
		expect(formatDuration(null)).toBe('');
		expect(formatDuration(0)).toBe('0:00');
		expect(formatDuration(42_400)).toBe('0:42');
		expect(formatDuration(725_000)).toBe('12:05');
		expect(formatDuration(3_723_000)).toBe('1:02:03');
	});

	it('formats elapsed time', () => {
		expect(formatElapsed(820)).toBe('820 ms');
		expect(formatElapsed(4_210)).toBe('4.2 s');
		expect(formatElapsed(42_000)).toBe('42 s');
		expect(formatElapsed(192_000)).toBe('3 min 12 s');
		expect(formatElapsed(undefined)).toBe('');
	});

	it('formats bytes', () => {
		expect(formatBytes(512)).toBe('512 B');
		expect(formatBytes(41_200)).toBe('41 KB');
		expect(formatBytes(3_210_000)).toBe('3.2 MB');
		expect(formatBytes(24_000_000)).toBe('24 MB');
	});

	it('picks a tone per status code', () => {
		expect(httpTone(200)).toBe('ok');
		expect(httpTone(401)).toBe('warn');
		expect(httpTone(500)).toBe('err');
	});
});

describe('text', () => {
	it('parses stored languages', () => {
		expect(parseLanguages('sw, EN,,')).toEqual(['sw', 'en']);
		expect(parseLanguages(null)).toEqual([]);
	});

	it('names languages', () => {
		expect(languageName('sw')).toBe('Swahili');
		expect(languageName('zz')).toBe('zz');
		expect(isLanguageCode('sw')).toBe(true);
		expect(isLanguageCode('SW')).toBe(false);
		expect(isLanguageCode('swahili')).toBe(false);
	});

	it('takes the first line and cuts at a word', () => {
		expect(firstLine('\n  Hello there \nsecond')).toBe('Hello there');
		expect(firstLine('')).toBe('');
		const long = 'word '.repeat(50);
		const out = firstLine(long, 40);
		expect(out.endsWith('…')).toBe(true);
		expect(out.length).toBeLessThanOrEqual(41);
	});

	it('labels triggers and statuses', () => {
		expect(triggerLabel('double-click-hold')).toBe('Double click');
		expect(triggerLabel('something-new')).toBe('something-new');
		expect(statusLabel('routing')).toBe('Delivering');
	});
});
