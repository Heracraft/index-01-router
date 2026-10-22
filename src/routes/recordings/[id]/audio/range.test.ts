import { describe, expect, it } from 'vitest';
import { parseRange } from './range.ts';

describe('parseRange', () => {
	it('serves the whole file without a usable header', () => {
		expect(parseRange(null, 100)).toBeNull();
		expect(parseRange('bytes=-', 100)).toBeNull();
		expect(parseRange('bytes=0-1,5-9', 100)).toBeNull();
		expect(parseRange('items=0-1', 100)).toBeNull();
	});

	it('reads explicit and open ranges', () => {
		expect(parseRange('bytes=0-1', 100)).toEqual({ start: 0, end: 1 });
		expect(parseRange('bytes=10-', 100)).toEqual({ start: 10, end: 99 });
		expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
	});

	it('reads suffix ranges', () => {
		expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
		expect(parseRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 });
	});

	it('rejects ranges past the end', () => {
		expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable');
		expect(parseRange('bytes=5-2', 100)).toBe('unsatisfiable');
		expect(parseRange('bytes=-0', 100)).toBe('unsatisfiable');
	});
});
