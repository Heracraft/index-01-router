import { describe, expect, it } from 'vitest';
import { formatDate, isValidTimeZone } from './time.ts';

describe('formatDate', () => {
	const d = new Date('2026-10-22T09:05:03Z');

	it('formats every token', () => {
		expect(formatDate(d, 'YYYY-MM-DD HH:mm:ss', 'UTC')).toBe('2026-10-22 09:05:03');
		expect(formatDate(d, 'ddd dddd MMM MMMM', 'UTC')).toBe('Thu Thursday Oct October');
	});

	it('copies bracketed text and unknown letters', () => {
		expect(formatDate(d, '[Week of] YYYY/MM/DD [at] HH', 'UTC')).toBe('Week of 2026/10/22 at 09');
		expect(formatDate(d, 'Daily/YYYY/MM-MMM/YYYY-MM-DD', 'UTC')).toBe(
			'Daily/2026/10-Oct/2026-10-22'
		);
	});

	it('moves to the next day east of UTC near midnight', () => {
		const late = new Date('2026-10-22T21:30:00Z');
		expect(formatDate(late, 'YYYY-MM-DD HH:mm', 'UTC')).toBe('2026-10-22 21:30');
		expect(formatDate(late, 'YYYY-MM-DD HH:mm dddd', 'Africa/Nairobi')).toBe(
			'2026-10-23 00:30 Friday'
		);
	});

	it('stays on the previous day west of UTC', () => {
		const early = new Date('2026-10-23T03:59:59Z');
		expect(formatDate(early, 'YYYY-MM-DD HH:mm:ss', 'America/New_York')).toBe(
			'2026-10-22 23:59:59'
		);
	});

	it('crosses a year boundary', () => {
		const nye = new Date('2026-12-31T23:30:00Z');
		expect(formatDate(nye, 'YYYY-MM-DD', 'Asia/Tokyo')).toBe('2027-01-01');
		expect(formatDate(nye, 'YYYY-MM-DD', 'Pacific/Honolulu')).toBe('2026-12-31');
	});

	it('prints midnight as 00, never 24', () => {
		expect(formatDate(new Date('2026-10-22T00:00:00Z'), 'HH:mm', 'UTC')).toBe('00:00');
		expect(formatDate(new Date('2026-10-21T21:00:00Z'), 'HH:mm', 'Africa/Nairobi')).toBe('00:00');
	});

	it('handles half hour zones and DST', () => {
		expect(formatDate(new Date('2026-10-22T18:45:00Z'), 'YYYY-MM-DD HH:mm', 'Asia/Kolkata')).toBe(
			'2026-10-23 00:15'
		);
		// Europe/Berlin leaves DST on 2026-10-25 at 01:00 UTC
		expect(formatDate(new Date('2026-10-25T00:30:00Z'), 'HH:mm', 'Europe/Berlin')).toBe('02:30');
		expect(formatDate(new Date('2026-10-25T01:30:00Z'), 'HH:mm', 'Europe/Berlin')).toBe('02:30');
	});

	it('rejects unknown zones and invalid dates', () => {
		expect(() => formatDate(d, 'YYYY', 'Mars/Olympus')).toThrow(RangeError);
		expect(() => formatDate(new Date('nope'), 'YYYY', 'UTC')).toThrow(RangeError);
		expect(isValidTimeZone('Africa/Nairobi')).toBe(true);
		expect(isValidTimeZone('Mars/Olympus')).toBe(false);
	});
});
