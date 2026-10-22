<script lang="ts">
	import { resolve } from '$app/paths';
	/* Left rail of the journal pages: the month, and recordings that never reached a note */
	import Calendar from './Calendar.svelte';
	import { relativeDay } from './days.ts';
	import { dayKey, formatDateTime, formatTime } from '#lib/format.ts';
	import { entryState, type EntryRec } from '#lib/entry.ts';

	interface Props {
		/** Picked day, or null for none */
		day: string | null;
		today: string;
		calendar: {
			month: string;
			prevMonth: string;
			nextMonth: string;
			dots: Record<string, { n: number; failed: boolean }>;
		};
		needs: { recs: EntryRec[]; count: number };
		tz: string;
		/** Recording open on this page, left out of the list */
		current?: string;
	}
	let { day, today, calendar, needs, tz, current }: Props = $props();

	const when = (at: Date | string) => {
		const r = relativeDay(dayKey(at, tz), today);
		return r ? `${r}, ${formatTime(at, tz)}` : formatDateTime(at, tz);
	};
	const cause = (rec: EntryRec) => {
		const s = entryState(rec);
		return s.kind === 'failed' ? s.cause : 'Failed';
	};
	const recs = $derived(needs.recs.filter((r) => r.id !== current));
</script>

<aside class="rail">
	<Calendar
		{day}
		{today}
		month={calendar.month}
		prevMonth={calendar.prevMonth}
		nextMonth={calendar.nextMonth}
		dots={calendar.dots}
	/>
	{#if recs.length}
		<div class="needs">
			<h2 class="rail-h">Not in a note</h2>
			{#each recs as r (r.id)}
				<a href={resolve('/(app)/recordings/[id]', { id: r.id })} class="need"
					><span class="need-d">{when(r.recordedAt)}</span><span class="need-r">{cause(r)}</span></a
				>
			{/each}
			{#if needs.count > needs.recs.length}
				<a class="hk-link need-all" href="{resolve('/(app)/recordings')}?status=failed"
					>Show all {needs.count}</a
				>
			{/if}
		</div>
	{/if}
</aside>
