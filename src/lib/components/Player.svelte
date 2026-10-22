<script lang="ts">
	/* Recording player: ink play button, waveform from the audio, time and speed. Sticky under
	   the header. Shares the app's one audio element with the day sheet */
	import { onMount } from 'svelte';
	import Icon from './Icon.svelte';
	import Waveform from './Waveform.svelte';
	import { audio, loadPeaks } from './audio.svelte.ts';
	import { formatDuration } from '#lib/format.ts';

	interface Props {
		id: string;
		durationMs: number | null;
	}
	let { id, durationMs }: Props = $props();

	const on = $derived(audio.isPlaying(id));
	const here = $derived(audio.id === id);
	const total = $derived(here && audio.duration ? audio.duration * 1000 : durationMs);
	const rate = $derived(audio.rate === 1 ? '1×' : `${audio.rate}×`);

	let width = $state(600);
	const bars = $derived(Math.max(24, Math.min(110, Math.floor(width / 5))));
	onMount(() => {
		loadPeaks(id);
	});
</script>

<div class="player" bind:clientWidth={width}>
	<button
		type="button"
		class="pbtn"
		aria-label={on ? 'Pause' : 'Play'}
		onclick={() => audio.toggle(id, durationMs)}
	>
		<Icon name={on ? 'pause' : 'play'} size={16} />
	</button>
	<Waveform {id} {durationMs} {bars} height={34} />
	<span class="ptime"
		><b>{formatDuration(here ? audio.time * 1000 : 0)}</b><span class="dur"
			>&nbsp;/ {formatDuration(total)}</span
		></span
	>
	<button
		type="button"
		class="speed"
		aria-label="Speed {rate}"
		title="Speed"
		onclick={() => audio.cycleRate()}>{rate}</button
	>
</div>
