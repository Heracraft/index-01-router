import { describe, expect, it } from 'vitest';
import {
	dropOverlap,
	findPauses,
	joinTexts,
	planChunks,
	rankLanguages,
	SAMPLE_RATE,
	voicedIn
} from './chunk.ts';

/**
 * Speech-like noise: syllables at `db` dBFS with 50 ms dips between them for `on` seconds, then
 * a noise floor for `off` seconds, repeated
 */
function synth(pattern: [on: number, off: number][], db = -20, floor = -70) {
	const total = pattern.reduce((n, [a, b]) => n + a + b, 0);
	const pcm = new Int16Array(Math.round(total * SAMPLE_RATE));
	let i = 0;
	let seed = 1;
	const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
	for (const [on, off] of pattern) {
		for (const [len, level] of [
			[on, db],
			[off, floor]
		] as const) {
			const amp = 10 ** (level / 20) * 32767 * Math.SQRT2;
			const dip = level === db ? 10 ** ((db - 25) / 20) * 32767 : amp;
			for (let k = 0; k < Math.round(len * SAMPLE_RATE); k++)
				pcm[i++] = Math.round(rnd() * (k % 4000 >= 3200 ? dip : amp));
		}
	}
	return pcm;
}

describe('findPauses', () => {
	it('finds the gaps between bursts', () => {
		const { pauses, duration } = findPauses(
			synth([
				[5, 1],
				[5, 1],
				[5, 0]
			])
		);
		expect(duration).toBeCloseTo(17, 1);
		expect(pauses.length).toBe(2);
		expect(pauses[0]!.start).toBeGreaterThan(4.8);
		expect(pauses[0]!.end).toBeLessThan(6.2);
	});

	it('treats digital silence as one pause', () => {
		const { pauses } = findPauses(new Int16Array(SAMPLE_RATE * 5));
		expect(pauses).toEqual([{ start: 0, end: expect.closeTo(5, 1) }]);
	});
});

describe('planChunks', () => {
	it('keeps short audio whole', () => {
		const chunks = planChunks([], 20);
		expect(chunks).toEqual([
			{ start: 0, end: 20, overlap: false, voiced: [{ start: 0, end: 20 }] }
		]);
	});

	it('cuts at the longest pause between 15 and 30 s', () => {
		const pauses = [
			{ start: 10, end: 12 },
			{ start: 18, end: 18.5 },
			{ start: 24, end: 25.2 }
		];
		const chunks = planChunks(pauses, 50);
		expect(chunks.map((c) => [c.start, c.end, c.overlap])).toEqual([
			[0, 24.6, false],
			[24.6, 50, false]
		]);
	});

	it('cuts hard with 1 s overlap when there is no pause', () => {
		const chunks = planChunks([], 65);
		expect(chunks.map((c) => [c.start, c.end, c.overlap])).toEqual([
			[0, 30, false],
			[29, 59, true],
			[58, 65, true]
		]);
	});

	it('drops chunks with no voice', () => {
		const chunks = planChunks([{ start: 20, end: 60 }], 60);
		expect(chunks.length).toBe(1);
		expect(chunks[0]!.voiced).toEqual([{ start: 0, end: 20 }]);
	});

	it('plans chunks on synthetic speech', () => {
		const pcm = synth(Array.from({ length: 10 }, () => [5.5, 0.8] as [number, number]));
		const { pauses, duration } = findPauses(pcm);
		const chunks = planChunks(pauses, duration);
		expect(chunks.length).toBeGreaterThanOrEqual(3);
		for (const c of chunks) {
			expect(c.end - c.start).toBeLessThanOrEqual(30);
			expect(c.overlap).toBe(false);
		}
	});
});

describe('voicedIn', () => {
	it('is the complement of the pauses', () => {
		expect(voicedIn([{ start: 2, end: 3 }], 0, 5)).toEqual([
			{ start: 0, end: 2 },
			{ start: 3, end: 5 }
		]);
	});
});

describe('dropOverlap', () => {
	it('removes repeated words at a hard cut', () => {
		expect(dropOverlap('we will meet at the office', 'the office tomorrow morning')).toBe(
			'tomorrow morning'
		);
	});
	it('ignores case and punctuation', () => {
		expect(dropOverlap('Tutaonana kesho.', 'kesho, asubuhi')).toBe('asubuhi');
	});
	it('keeps one shared short word', () => {
		expect(dropOverlap('I saw a cat', 'cat ran')).toBe('cat ran');
		expect(dropOverlap('see you at', 'at noon')).toBe('at noon');
	});
});

describe('joinTexts', () => {
	it('joins chunks and drops overlaps only after hard cuts', () => {
		expect(
			joinTexts([
				{ text: 'one two three', overlap: false },
				{ text: 'three four', overlap: false },
				{ text: 'four five six', overlap: true },
				{ text: '', overlap: false }
			])
		).toBe('one two three three four five six');
	});
});

describe('rankLanguages', () => {
	it('ranks by voiced seconds, first language weighted higher', () => {
		expect(
			rankLanguages([
				{ languages: ['en'], seconds: 10 },
				{ languages: ['sw', 'en'], seconds: 40 },
				{ languages: ['es'], seconds: 5 }
			])
		).toEqual(['sw', 'en', 'es']);
	});
	it('is empty when no chunk names a language', () => {
		expect(rankLanguages([{ languages: [], seconds: 10 }])).toEqual([]);
	});
});
