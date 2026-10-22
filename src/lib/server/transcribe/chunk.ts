// Pause detection and chunk planning, ported from teksafari/toolbar. Pure functions over 16 kHz
// mono PCM, so they run in unit tests without ffmpeg. Long code-switched clips lose whole
// sentences at language switches; cutting at pauses into chunks of at most 30 s fixes most of it.

export const SAMPLE_RATE = 16_000;
/** 30 ms analysis frames */
export const FRAME_S = 0.03;
const FRAME = Math.round(SAMPLE_RATE * FRAME_S);

export interface Span {
	/** seconds */
	start: number;
	end: number;
}

export interface Chunk extends Span {
	/** True when the chunk starts inside the previous one (hard cut, no pause found) */
	overlap: boolean;
	/** Voiced spans inside [start, end], in seconds from the start of the file */
	voiced: Span[];
}

const round = (s: number) => Math.round(s * 1000) / 1000;

/** RMS level in dBFS of each 30 ms frame of signed 16-bit PCM */
export function frameLevels(pcm: Int16Array): Float32Array {
	const k = Math.floor(pcm.length / FRAME);
	const out = new Float32Array(k);
	for (let i = 0; i < k; i++) {
		let sum = 0;
		for (let j = i * FRAME, z = j + FRAME; j < z; j++) {
			const s = pcm[j]! / 32768;
			sum += s * s;
		}
		out[i] = 20 * Math.log10(Math.sqrt(sum / FRAME) + 1e-9);
	}
	return out;
}

function percentile(sorted: Float32Array, p: number): number {
	if (!sorted.length) return -180;
	const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
	return sorted[i]!;
}

/**
 * Adaptive energy detector: a frame is quiet when it is below the local 10th percentile plus
 * 0.35 x (95th - 10th percentile) over a 10 s window. A fixed dB threshold fails on quiet
 * microphones. The threshold is computed once per second of audio.
 */
export function quietFrames(levels: Float32Array, windowS = 10): Uint8Array {
	const k = levels.length;
	const quiet = new Uint8Array(k);
	const half = Math.round(windowS / FRAME_S / 2);
	const block = Math.round(1 / FRAME_S);
	for (let b = 0; b < k; b += block) {
		const centre = Math.min(k - 1, b + Math.floor(block / 2));
		const win = levels.slice(Math.max(0, centre - half), Math.min(k, centre + half + 1)).sort();
		const lo = percentile(win, 0.1);
		const hi = percentile(win, 0.95);
		// One level throughout (digital silence, or a steady tone) has no speech contrast
		const thr = hi - lo < 6 ? (hi < -50 ? Infinity : -Infinity) : lo + 0.35 * (hi - lo);
		for (let i = b; i < Math.min(k, b + block); i++) quiet[i] = levels[i]! < thr ? 1 : 0;
	}
	return quiet;
}

/** Runs of quiet frames of at least `minPause` seconds */
export function findPauses(pcm: Int16Array, minPause = 0.3): { pauses: Span[]; duration: number } {
	const quiet = quietFrames(frameLevels(pcm));
	const pauses: Span[] = [];
	for (let i = 0; i < quiet.length;) {
		if (!quiet[i]) {
			i++;
			continue;
		}
		let j = i;
		while (j < quiet.length && quiet[j]) j++;
		if ((j - i) * FRAME_S >= minPause)
			pauses.push({ start: round(i * FRAME_S), end: round(j * FRAME_S) });
		i = j;
	}
	return { pauses, duration: pcm.length / SAMPLE_RATE };
}

/** Voiced spans of [a, b]: the complement of the pauses */
export function voicedIn(pauses: Span[], a: number, b: number): Span[] {
	const out: Span[] = [];
	let t = a;
	for (const p of pauses) {
		if (p.end <= a || p.start >= b) continue;
		if (p.start > t) out.push({ start: round(t), end: round(Math.min(p.start, b)) });
		t = Math.max(t, p.end);
	}
	if (t < b) out.push({ start: round(t), end: round(b) });
	return out.filter((v) => v.end - v.start >= FRAME_S);
}

/**
 * Contiguous chunks of at most `maxS` seconds. From each chunk start, cut at the centre of the
 * longest pause whose centre falls between max(minS, maxS / 2) and maxS seconds later. With no
 * pause there, cut hard at maxS and start the next chunk 1 s earlier (the repeated words are
 * dropped when the texts are joined). Chunks with no voiced frames are dropped: they cost money
 * and invite "Thank you." hallucinations.
 */
export function planChunks(pauses: Span[], duration: number, maxS = 30, minS = 4): Chunk[] {
	const raw: { start: number; end: number; overlap: boolean }[] = [];
	let start = 0;
	let overlap = false;
	const hardOverlap = Math.min(1, maxS / 10);
	while (duration - start > maxS) {
		const lo = start + Math.max(minS, maxS / 2);
		const hi = start + maxS;
		let best: Span | null = null;
		for (const p of pauses) {
			const c = (p.start + p.end) / 2;
			if (c < lo || c > hi) continue;
			if (!best || p.end - p.start > best.end - best.start) best = p;
		}
		if (best) {
			const cut = round((best.start + best.end) / 2);
			raw.push({ start, end: cut, overlap });
			start = cut;
			overlap = false;
		} else {
			raw.push({ start, end: round(start + maxS), overlap });
			start = round(start + maxS - hardOverlap);
			overlap = true;
		}
	}
	raw.push({ start, end: round(duration), overlap });
	return raw
		.map((c) => ({ ...c, voiced: voicedIn(pauses, c.start, c.end) }))
		.filter((c) => c.voiced.length > 0 && c.end - c.start > 0.05);
}

/** Seconds of voice in a chunk */
export const voicedSeconds = (c: Chunk) => c.voiced.reduce((n, v) => n + v.end - v.start, 0);

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Drop the words at the start of `next` that repeat the end of `prev` (a hard cut gives the two
 * chunks about one second of shared audio). Matches 1 to 12 words, longest first.
 */
export function dropOverlap(prev: string, next: string): string {
	const a = prev.split(/\s+/).filter(Boolean);
	const b = next.split(/\s+/).filter(Boolean);
	for (let k = Math.min(12, a.length, b.length); k >= 1; k--) {
		let same = true;
		for (let i = 0; i < k; i++) {
			if (norm(a[a.length - k + i]!) !== norm(b[i]!) || !norm(b[i]!)) {
				same = false;
				break;
			}
		}
		// One shared short word is as likely a coincidence as an overlap
		if (same && (k > 1 || norm(b[0]!).length > 3)) return b.slice(k).join(' ');
	}
	return next;
}

/** Join chunk texts in order, dropping repeated words after hard cuts */
export function joinTexts(parts: { text: string; overlap: boolean }[]): string {
	const out: string[] = [];
	let prev = '';
	for (const p of parts) {
		const text = p.overlap ? dropOverlap(prev, p.text) : p.text;
		prev = p.text;
		if (text.trim()) out.push(text.trim());
	}
	return out.join(' ');
}

/**
 * Language codes ordered by the voiced seconds they were detected in. A chunk's seconds are
 * split over its languages, earlier ones (the provider's main language) weighted higher.
 */
export function rankLanguages(hits: { languages: string[]; seconds: number }[]): string[] {
	const score = new Map<string, number>();
	for (const h of hits) {
		const n = h.languages.length;
		const total = (n * (n + 1)) / 2;
		h.languages.forEach((l, i) => {
			score.set(l, (score.get(l) ?? 0) + (Math.max(h.seconds, 0.001) * (n - i)) / total);
		});
	}
	return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
}
