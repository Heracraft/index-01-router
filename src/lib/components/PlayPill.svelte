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
</script>

<button
	type="button"
	class="pp"
	class:on
	class:pp--icon={!dur}
	aria-label="{on ? 'Pause' : 'Play'}{dur ? ` ${dur}` : ''}"
	aria-pressed={on}
	onclick={() => {
		audio.toggle(id, durationMs);
		loadPeaks(id);
	}}
>
	<Icon name={on ? 'pause' : 'play'} size={10} />
	{#if dur}<span>{dur}</span>{/if}
</button>
