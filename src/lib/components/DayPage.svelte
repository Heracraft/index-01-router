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
	// One section: the header names its heading. Several: each shows its own, as the note reads
	const split = $derived(data.sections.length > 0);
	const sections = $derived(
		split
			? data.sections.filter((x) => x.lines.length)
			: [{ heading: data.note?.heading ?? 'Notes', lines: data.lines, main: true, inNote: true }]
	);
	const empty = $derived(sections.every((x) => x.lines.length === 0));
	/** A week on, but never past today */
	const nextWeekDay = $derived.by(() => {
		const d = addDays(data.day, 7);
		return d > data.today ? data.today : d;
	});
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
			class:today={key === data.today}
			class:future={key > data.today}
			aria-current={key === data.day ? 'date' : undefined}
			aria-label={key === data.today ? `Today, ${longDay(key)}` : longDay(key)}
			><em>{weekdayLetter(key)}</em><span>{Number(key.slice(8))}</span>{#if dot}<b
					class="cd"
					class:err={dot.failed}
				></b>{/if}</a
		>
	{/each}
	{#if data.week.end < data.today}
		<a class="hk-btn-ghost iconbtn" href={dayHref(nextWeekDay)} aria-label="Week after"
			><Icon name="right" /></a
		>
	{:else}
		<span class="hk-btn-ghost iconbtn off" aria-hidden="true"><Icon name="right" /></span>
	{/if}
</nav>

<div class="shell">
	<Rail day={data.day} today={data.today} calendar={data.calendar} needs={data.needs} />

	<main id="main" class="col" tabindex="-1">
		{#if data.needs.count}
			<a class="needline" href="{resolve('/(app)/recordings')}?status=failed"
				><span class="fdot" aria-hidden="true"></span>{data.needs.count} not in a note<Icon
					name="right"
					size={14}
				/></a
			>
		{/if}
		<article class="sheet sheet--day">
			<header class="sheet-head">
				<div class="sh-t">
					<h1 class="hk-h1-app dh-t">{title}</h1>
					{#if data.note?.path}
						<!-- The note alone, the same every day: headings show in the sheet when there are several -->
						<p class="path">{data.note.path}</p>
					{/if}
				</div>
				{#if data.note?.link}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- obsidian:// opens the vault app -->
					<a class="hk-link open dh-open" href={data.note.link} aria-label="Open in Obsidian"
						><span class="open-l">Open in Obsidian</span><Icon name="external" size={14} /></a
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
						<span class="hk-btn-ghost iconbtn off" aria-hidden="true"
							><Icon name="right" size={18} /></span
						>
					{/if}
				</nav>
			</header>
			<div class="sheet-body">
				{#if empty}
					<h2 class="hk-sr">{data.note?.heading ?? 'Notes'}</h2>
					<p class="sheet-empty">{rel === 'Today' ? 'Nothing yet today' : 'Nothing this day'}</p>
				{:else}
					{#each sections as sec (sec.heading)}
						<!-- Every heading in one style, as the note will read once its first line lands -->
						<h2 class={split ? 'nh sec-nh' : 'hk-sr'}>
							{sec.heading}
						</h2>
						<ul class="notes">
							{#each sec.lines as line (line.key)}
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
					{/each}
				{/if}
			</div>
		</article>
	</main>
</div>

<style>
	.sec-nh:not(:first-child) {
		margin-top: 1.5rem;
	}
</style>
