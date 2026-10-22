<script lang="ts">
	/* Play pill with the duration. Plays in place through the shared audio element */
	import Icon from './Icon.svelte';
	import { audio, loadPeaks } from './audio.svelte.ts';
	import { formatDuration } from '#lib/format.ts';

	interface Props {
		id: string;
		durationMs: number | null;
	}
	let { id, durationMs }: Props = $props();
	const on = $derived(audio.isPlaying(id));
	const dur = $derived(formatDuration(durationMs));
	// While this line plays, or sits paused part way, the pill counts the time instead
	const shown = $derived(
		audio.id === id && (audio.playing || audio.time > 0) ? formatDuration(audio.time * 1000) : dur
	);
</script>

<button
	type="button"
	class="pp"
	class:on
	aria-label="{on ? 'Pause' : 'Play'}{dur ? ` ${dur}` : ''}"
	aria-pressed={on}
	onclick={() => {
		audio.toggle(id, durationMs);
		loadPeaks(id);
	}}
>
	<Icon name={on ? 'pause' : 'play'} size={10} />
	{#if dur}<span>{shown}</span>{/if}
</button>
