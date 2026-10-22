<script lang="ts">
	import { resolve } from '$app/paths';
	/* A day as its note reads: the Notes section with each recording's line in place */
	import EntryRow from './EntryRow.svelte';
	import Icon from './Icon.svelte';
	import Rail from './Rail.svelte';
	import { addDays, longDay, relativeDay, shortDay, weekdayLetter } from './days.ts';
	import type { DayData } from '#lib/server/journal.ts';

	interface Props {
		data: DayData & { timezone: string };
	}
	let { data }: Props = $props();

	const tz = $derived(data.timezone);
	const rel = $derived(relativeDay(data.day, data.today));
	const title = $derived(rel ?? longDay(data.day));
	const weekDays = $derived(Array.from({ length: 7 }, (_, i) => addDays(data.week.start, i)));
	const dayHref = (key: string) =>
		key === data.today ? resolve('/(app)') : resolve('/(app)/day/[date]', { date: key });
	const empty = $derived(data.lines.length === 0);
</script>

<nav class="week" aria-label="Days">
	<a class="hk-btn-ghost iconbtn" href={dayHref(addDays(data.day, -7))} aria-label="Week before"
		><Icon name="left" /></a
	>
	{#each weekDays as key (key)}
		{@const dot = data.calendar.dots[key]}
		<a
			href={key > data.today ? undefined : dayHref(key)}
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
	<Rail day={data.day} today={data.today} calendar={data.calendar} needs={data.needs} {tz} />

	<main id="main" class="col" tabindex="-1">
		{#if data.needs.count}
			<a class="needbar" href="{resolve('/(app)/recordings')}?status=failed"
				><span class="fdot" aria-hidden="true"></span>{data.needs.count}
				{data.needs.count === 1 ? 'recording' : 'recordings'} not in a note<Icon name="right" /></a
			>
		{/if}
		<div class="dayhead">
			<h1 class="hk-h1-app dh-t">{title}</h1>
			{#if data.note?.link}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- obsidian:// opens the vault app -->
				<a class="hk-link open dh-open" href={data.note.link}
					>Open in Obsidian <Icon name="external" size={14} /></a
				>
			{/if}
			<nav class="dh-nav" aria-label="Days">
				<a
					class="hk-btn-ghost iconbtn"
					href={dayHref(data.prev)}
					aria-label={longDay(data.prev)}
					title={shortDay(data.prev)}><Icon name="left" size={18} /></a
				>
				{#if data.next}
					<a
						class="hk-btn-ghost iconbtn"
						href={dayHref(data.next)}
						aria-label={longDay(data.next)}
						title={shortDay(data.next)}><Icon name="right" size={18} /></a
					>
				{:else}
					<span class="hk-btn-ghost iconbtn" aria-disabled="true"
						><Icon name="right" size={18} /></span
					>
				{/if}
			</nav>
		</div>

		<article class="sheet sheet--day">
			{#if data.note?.path}
				<div class="sheet-bar">
					<span class="path"
						>{data.note.path}<span class="path-h">{` › ${data.note.heading}`}</span></span
					>
					{#if data.note.link}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- obsidian:// opens the vault app -->
						<a class="hk-link open" href={data.note.link}
							>Open in Obsidian <Icon name="external" size={14} /></a
						>
					{/if}
				</div>
			{/if}
			<div class="sheet-body">
				<h2 class="hk-sr">{data.note?.heading ?? 'Notes'}</h2>
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
	</main>
</div>
