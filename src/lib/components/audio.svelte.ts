// One audio element for the whole app: playing a line pauses whatever played before, and the
// recording page's player and the day sheet's pills show the same position.
import { seededBars } from '#lib/entry.ts';

const RATES = [1, 1.5, 2] as const;

class SharedAudio {
	id = $state<string | null>(null);
	playing = $state(false);
	time = $state(0);
	duration = $state(0);
	rate = $state<number>(1);
	#el: HTMLAudioElement | null = null;
	#raf = 0;

	#audio() {
		if (this.#el) return this.#el;
		const el = new Audio();
		el.preload = 'metadata';
		const sync = () => {
			this.time = el.currentTime;
			if (Number.isFinite(el.duration) && el.duration > 0) this.duration = el.duration;
		};
		const tick = () => {
			sync();
			if (!el.paused) this.#raf = requestAnimationFrame(tick);
		};
		el.addEventListener('play', () => {
			this.playing = true;
			cancelAnimationFrame(this.#raf);
			this.#raf = requestAnimationFrame(tick);
		});
		el.addEventListener('pause', () => {
			this.playing = false;
			sync();
		});
		el.addEventListener('ended', () => {
			this.playing = false;
			this.time = 0;
		});
		el.addEventListener('durationchange', sync);
		el.addEventListener('seeked', sync);
		this.#el = el;
		return el;
	}

	#load(id: string, durationMs: number | null) {
		const el = this.#audio();
		if (this.id === id) return el;
		el.pause();
		el.src = `/recordings/${id}/audio`;
		el.playbackRate = this.rate;
		this.id = id;
		this.time = 0;
		this.duration = durationMs ? durationMs / 1000 : 0;
		return el;
	}

	isPlaying = (id: string) => this.id === id && this.playing;

	toggle(id: string, durationMs: number | null) {
		const el = this.#load(id, durationMs);
		if (el.paused) {
			el.play().catch(() => (this.playing = false));
		} else el.pause();
	}

	/** Jump to a fraction of `id`, loading it first when another recording is loaded */
	seek(id: string, durationMs: number | null, fraction: number) {
		const el = this.#load(id, durationMs);
		const total = this.duration || (durationMs ?? 0) / 1000;
		if (!total) return;
		el.currentTime = Math.max(0, Math.min(total, fraction * total));
		this.time = el.currentTime;
	}

	skip(id: string, durationMs: number | null, seconds: number) {
		const total = this.duration || (durationMs ?? 0) / 1000;
		if (!total) return;
		const now = this.id === id ? this.time : 0;
		this.seek(id, durationMs, (now + seconds) / total);
	}

	cycleRate() {
		const i = RATES.indexOf(this.rate as (typeof RATES)[number]);
		this.rate = RATES[(i + 1) % RATES.length]!;
		if (this.#el) this.#el.playbackRate = this.rate;
	}

	/** Position of `id` from 0 to 1, 0 when another recording is loaded */
	progress(id: string, durationMs: number | null) {
		if (this.id !== id) return 0;
		const total = this.duration || (durationMs ?? 0) / 1000;
		return total ? Math.min(1, this.time / total) : 0;
	}
}

export const audio = new SharedAudio();

// Waveform peaks decoded from the audio, cached per recording. Seeded bars stand in until then
const peaks = $state<Record<string, number[]>>({});
// Plain set: which ids were fetched, never read by markup
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const asked = new Set<string>();

export function barsFor(id: string, n: number): number[] {
	const real = peaks[id];
	if (!real) return seededBars(id, n);
	if (real.length === n) return real;
	// Resample to n bars
	return Array.from({ length: n }, (_, i) => real[Math.floor((i * real.length) / n)] ?? 0.2);
}

export async function loadPeaks(id: string, n = 160) {
	if (asked.has(id) || typeof window === 'undefined') return;
	asked.add(id);
	try {
		const res = await fetch(`/recordings/${id}/audio`);
		if (!res.ok) return;
		const buf = await res.arrayBuffer();
		const ctx = new OfflineAudioContext(1, 1, 8000);
		const decoded = await ctx.decodeAudioData(buf);
		const data = decoded.getChannelData(0);
		const step = Math.max(1, Math.floor(data.length / n));
		const raw: number[] = [];
		for (let i = 0; i < n; i++) {
			let sum = 0;
			const from = i * step;
			for (let j = from; j < Math.min(data.length, from + step); j++) sum += data[j]! * data[j]!;
			raw.push(Math.sqrt(sum / step));
		}
		const max = Math.max(...raw, 1e-6);
		peaks[id] = raw.map((v) => 0.12 + 0.88 * Math.pow(v / max, 0.7));
	} catch {
		// Undecodable here: the seeded bars stay
	}
}
