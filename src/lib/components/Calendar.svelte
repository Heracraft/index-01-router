<script lang="ts">
	import { resolve } from '$app/paths';
	/* Month of days: a grey dot where recordings were, red where one failed */
	import Icon from './Icon.svelte';
	import { monthGrid, monthLabel } from './days.ts';

	interface Props {
		day: string;
		today: string;
		month: string;
		prevMonth: string;
		nextMonth: string;
		dots: Record<string, { n: number; failed: boolean }>;
	}
	let { day, today, month, prevMonth, nextMonth, dots }: Props = $props();

	const cells = $derived(monthGrid(month));
	const here = $derived(
		day === today ? resolve('/(app)') : resolve('/(app)/day/[date]', { date: day })
	);
	const canNext = $derived(nextMonth <= today.slice(0, 7));
</script>

<div class="cal">
	<div class="cal-head">
		<span class="cal-m">{monthLabel(month)}</span>
		<span class="cal-nav">
			<a
				class="hk-btn-ghost iconbtn sm"
				href="{here}?m={prevMonth}"
				aria-label={monthLabel(prevMonth)}
				data-sveltekit-reset="false"
				data-sveltekit-replacestate><Icon name="left" /></a
			>
			{#if canNext}
				<a
					class="hk-btn-ghost iconbtn sm"
					href="{here}?m={nextMonth}"
					aria-label={monthLabel(nextMonth)}
					data-sveltekit-reset="false"
					data-sveltekit-replacestate><Icon name="right" /></a
				>
			{:else}
				<span class="hk-btn-ghost iconbtn sm" aria-disabled="true"><Icon name="right" /></span>
			{/if}
		</span>
	</div>
	<div class="cal-grid">
		{#each ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as d, i (i)}<em aria-hidden="true">{d}</em>{/each}
		{#each cells as key, i (key ?? `b${i}`)}
			{#if !key}
				<span></span>
			{:else if key > today}
				<span class="future">{Number(key.slice(8))}</span>
			{:else}
				{@const dot = dots[key]}
				<a
					href={key === today ? resolve('/(app)') : resolve('/(app)/day/[date]', { date: key })}
					class:sel={key === day}
					class:has={!!dot}
					aria-current={key === day ? 'date' : undefined}
					aria-label="{key}{dot ? `, ${dot.n} recordings` : ''}{dot?.failed ? ', one failed' : ''}"
					>{Number(key.slice(8))}{#if dot}<b class="cd" class:err={dot.failed}></b>{/if}</a
				>
			{/if}
		{/each}
	</div>
</div>
