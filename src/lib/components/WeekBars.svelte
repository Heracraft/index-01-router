<script lang="ts">
	/* Seven day bars under a weekly count: muted zinc, today in the accent (kit rule for single
	   series bars). No axis: the stat above carries the number */
	interface Props {
		/** One entry per day from Monday to today */
		days: { label: string; count: number }[];
	}
	let { days }: Props = $props();

	const max = $derived(Math.max(1, ...days.map((d) => d.count)));
	const summary = $derived(days.map((d) => `${d.label} ${d.count}`).join(', '));
</script>

<div class="bars" role="img" aria-label={summary}>
	{#each days as d, i (i)}
		<span
			class="bar"
			class:today={i === days.length - 1}
			class:zero={d.count === 0}
			style:height="{Math.max(2, Math.round((d.count / max) * 16))}px"
			title="{d.label} {d.count}"
		></span>
	{/each}
</div>

<style>
	.bars {
		display: flex;
		align-items: flex-end;
		gap: 3px;
		height: 16px;
		margin-top: 0.5rem;
	}
	.bar {
		width: 4px;
		border-radius: 1px;
		background: var(--hk-text-4);
	}
	.bar.zero {
		background: var(--hk-border);
	}
	.bar.today {
		background: var(--hk-accent);
	}
</style>
