<script lang="ts">
	import { resolve } from '$app/paths';
	/* A day as its note reads: the Notes section with each recording's line in place */
	import Calendar from './Calendar.svelte';
	import EntryRow from './EntryRow.svelte';
	import Icon from './Icon.svelte';
	import { addDays, longDay, relativeDay, shortDay, weekdayLetter } from './days.ts';
	import { formatDateTime, formatTime, dayKey } from '#lib/format.ts';
	import { entryState } from '#lib/entry.ts';
	import type { DayData } from '#lib/server/journal.ts';

	interface Props {
		data: DayData & { timezone: string };
	}
	let { data }: Props = $props();

	const tz = $derived(data.timezone);
	const rel = $derived(relativeDay(data.day, data.today));
	const title = $derived(rel ?? longDay(data.day));
	const weekDays = $derived(Array.from({ length: 7 }, (_, i) => addDays(data.week.start, i)));
	const needWhen = (at: Date | string) => {
		const key = dayKey(at, tz);
		const r = relativeDay(key, data.today);
		return r ? `${r}, ${formatTime(at, tz)}` : formatDateTime(at, tz);
	};
	const failCause = (rec: (typeof data.needs.recs)[number]) => {
		const s = entryState(rec);
		return s.kind === 'failed' ? s.cause : 'Failed';
	};
	const empty = $derived(data.lines.length === 0);
</script>

<nav class="week" aria-label="Days">
	<a
		class="hk-btn-ghost iconbtn"
		href={resolve('/(app)/day/[date]', { date: addDays(data.day, -7) })}
		aria-label="Week before"><Icon name="left" /></a
	>
	{#each weekDays as key (key)}
		{@const dot = data.calendar.dots[key]}
		<a
			href={key > data.today
				? undefined
				: key === data.today
					? resolve('/(app)')
					: resolve('/(app)/day/[date]', { date: key })}
			class="wd"
			class:sel={key === data.day}
			class:future={key > data.today}
			aria-current={key === data.day ? 'date' : undefined}
			aria-label={longDay(key)}
			><em>{weekdayLetter(key)}</em><span>{Number(key.slice(8))}</span>{#if dot}<b
					class="cd"
					class:err={dot.failed}
				></b>{/if}</a
		>
	{/each}
</nav>

<div class="shell">
	<aside class="rail">
		<Calendar
			day={data.day}
			today={data.today}
			month={data.calendar.month}
			prevMonth={data.calendar.prevMonth}
			nextMonth={data.calendar.nextMonth}
			dots={data.calendar.dots}
		/>
		{#if data.needs.count}
			<div class="needs">
				<h2 class="rail-h">Not in a note</h2>
				{#each data.needs.recs as r (r.id)}
					<a href={resolve('/(app)/recordings/[id]', { id: r.id })} class="need"
						><span class="need-d">{needWhen(r.recordedAt)}</span><span class="need-r"
							>{failCause(r)}</span
						></a
					>
				{/each}
				{#if data.needs.count > data.needs.recs.length}
					<a class="hk-link need-all" href="{resolve('/(app)/recordings')}?status=failed"
						>Show all {data.needs.count}</a
					>
				{/if}
			</div>
		{/if}
	</aside>

	<main id="main" class="col" tabindex="-1">
		{#if data.needs.count}
			<a class="needbar" href="{resolve('/(app)/recordings')}?status=failed"
				><span class="ring-err" aria-hidden="true"></span>{data.needs.count}
				{data.day === data.today ? 'earlier' : 'other'}
				{data.needs.count === 1 ? 'recording' : 'recordings'} not in a note<Icon name="right" /></a
			>
		{/if}
		<div class="dayhead">
			<h1 class="hk-h1-app dh-t">
				<span>{title}</span>{#if rel}<span class="dh-sub">{longDay(data.day)}</span>{/if}
			</h1>
			{#if data.note?.link}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- obsidian:// opens the vault app -->
				<a class="hk-link open dh-open" href={data.note.link}
					>Open in Obsidian <Icon name="external" size={14} /></a
				>
			{/if}
			<div class="dh-nav">
				<a
					class="hk-btn-secondary hk-btn-sm"
					href={resolve('/(app)/day/[date]', { date: data.prev })}
					><Icon name="left" />{shortDay(data.prev)}</a
				>
				{#if data.next}
					<a
						class="hk-btn-secondary hk-btn-sm"
						href={data.next === data.today
							? resolve('/(app)')
							: resolve('/(app)/day/[date]', { date: data.next })}
						>{shortDay(data.next)}<Icon name="right" /></a
					>
				{:else}
					<button class="hk-btn-secondary hk-btn-sm" disabled
						>{shortDay(addDays(data.day, 1))}<Icon name="right" /></button
					>
				{/if}
			</div>
		</div>

		<article class="sheet sheet--day">
			{#if data.note?.path}
				<div class="sheet-bar">
					<span class="path">{data.note.path}</span>
					{#if data.note.link}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- obsidian:// opens the vault app -->
						<a class="hk-link open" href={data.note.link}
							>Open in Obsidian <Icon name="external" size={14} /></a
						>
					{/if}
				</div>
			{/if}
			<div class="sheet-body">
				<h2 class="nh">{data.note?.heading ?? 'Notes'}</h2>
				{#if empty}
					<p class="sheet-empty">{rel === 'Today' ? 'Nothing yet today' : 'Nothing this day'}</p>
				{:else}
					<ul class="notes">
						{#each data.lines as line (line.key)}
							{#if line.type === 'typed'}
								<li class="e e--typed">
									<span class="e-t">{line.time ?? ''}</span>
									<div class="e-b">
										<p class="e-x">
											{#if line.task !== null}<span class="task" class:on={line.task}
												></span>{/if}{line.text}
										</p>
									</div>
								</li>
							{:else}
								<EntryRow rec={line.rec} {tz} />
							{/if}
						{/each}
					</ul>
				{/if}
			</div>
		</article>

		<a class="prevday" href={resolve('/(app)/day/[date]', { date: data.prev })}
			><Icon name="left" />{longDay(data.prev)}</a
		>
	</main>
</div>
