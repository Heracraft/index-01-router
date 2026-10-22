<script lang="ts">
	/* Bars of a recording, filled up to the play position. Click or drag to seek, arrows skip 5 s */
	import { audio, barsFor } from './audio.svelte.ts';
	import { formatDuration } from '#lib/format.ts';

	interface Props {
		id: string;
		durationMs: number | null;
		bars?: number;
		class?: string;
		/** Bar height range in px */
		height?: number;
	}
	let { id, durationMs, bars = 72, class: cls = 'wave', height = 36 }: Props = $props();

	const heights = $derived(barsFor(id, bars));
	const at = $derived(audio.progress(id, durationMs));
	const total = $derived(audio.id === id && audio.duration ? audio.duration * 1000 : durationMs);

	let el = $state<HTMLDivElement>();
	let dragging = false;
	function seekTo(e: PointerEvent) {
		if (!el) return;
		const r = el.getBoundingClientRect();
		audio.seek(id, durationMs, (e.clientX - r.left) / r.width);
	}
</script>

<div
	bind:this={el}
	class={cls}
	role="slider"
	tabindex="0"
	aria-label="Position"
	aria-valuemin={0}
	aria-valuemax={Math.round((total ?? 0) / 1000)}
	aria-valuenow={Math.round((at * (total ?? 0)) / 1000)}
	aria-valuetext="{formatDuration(at * (total ?? 0))} of {formatDuration(total)}"
	onpointerdown={(e) => {
		dragging = true;
		el?.setPointerCapture(e.pointerId);
		seekTo(e);
	}}
	onpointermove={(e) => dragging && seekTo(e)}
	onpointerup={() => (dragging = false)}
	onpointercancel={() => (dragging = false)}
	onkeydown={(e) => {
		if (e.key === 'ArrowRight') audio.skip(id, durationMs, 5);
		else if (e.key === 'ArrowLeft') audio.skip(id, durationMs, -5);
		else return;
		e.preventDefault();
	}}
>
	{#each heights as h, i (i)}
		<i class:on={(i + 0.5) / heights.length <= at} style:height="{Math.max(2, h * height)}px"></i>
	{/each}
</div>
