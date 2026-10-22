<script lang="ts">
	import { resolve } from '$app/paths';
	/* Left rail of the journal pages: the month, and one row counting recordings that never
	   reached a note */
	import Calendar from './Calendar.svelte';
	import Icon from './Icon.svelte';

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
		/** Failures to count; left out where the page lists them itself */
		needs?: { count: number } | null;
	}
	let { day, today, calendar, needs = null }: Props = $props();
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
	{#if needs?.count}
		<a class="need" href="{resolve('/(app)/recordings')}?status=failed"
			><span class="fdot" aria-hidden="true"></span><span class="need-n"
				>{needs.count} not in a note</span
			><Icon name="right" size={14} /></a
		>
	{/if}
</aside>
