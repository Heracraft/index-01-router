import { describe, expect, it } from 'vitest';
import { formatCursor, parseCursor } from './cursor.ts';

const id = '0b6f4c1e-8a2d-4f3b-9c5e-1d2a3b4c5d6e';

describe('parseCursor', () => {
	it('round trips a cursor with microseconds', () => {
		const at = '2026-10-22T08:15:30.123456Z';
		expect(parseCursor(formatCursor(at, id))).toEqual({ at, id });
	});

	it('lowercases the id', () => {
		expect(parseCursor(`2026-10-22T08:15:30Z_${id.toUpperCase()}`)?.id).toBe(id);
	});

	it('ignores missing or malformed values', () => {
		expect(parseCursor(null)).toBeNull();
		expect(parseCursor('')).toBeNull();
		expect(parseCursor('2026-10-22T08:15:30Z')).toBeNull();
		expect(parseCursor(`yesterday_${id}`)).toBeNull();
		expect(parseCursor('2026-10-22T08:15:30Z_not-a-uuid')).toBeNull();
		expect(parseCursor(`2026-13-45T99:99:99Z_${id}`)).toBeNull();
		expect(parseCursor(`2026-10-22T08:15:30Z_${id}'; drop table recordings`)).toBeNull();
	});
});
