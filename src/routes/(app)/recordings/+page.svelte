<script lang="ts">
	import { resolve } from '$app/paths';
	import EntryRow from '#lib/components/EntryRow.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Rail from '#lib/components/Rail.svelte';
	import { longDay, relativeDay } from '#lib/components/days.ts';
	import { live } from '#lib/components/live.svelte.ts';
	import { dayKey } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const tz = $derived(data.timezone);
	const today = $derived(dayKey(new Date(), tz));

	let q = $state('');
	let seen: string | null = null;
	$effect.pre(() => {
		if (data.q === seen) return;
		seen = data.q;
		q = data.q;
	});

	const groups = $derived.by(() => {
		const out: { key: string; rows: typeof data.recs }[] = [];
		for (const r of data.recs) {
			const key = dayKey(r.recordedAt, tz);
			let g = out.at(-1);
			if (!g || g.key !== key) {
				g = { key, rows: [] };
				out.push(g);
			}
			g.rows.push(r);
		}
		// Days newest first; inside a day, the order the note reads
		for (const g of out) g.rows.reverse();
		return out;
	});
	const base = resolve('/(app)/recordings');
	/** Query string for this page with `over` changed */
	const qs = (over: Record<string, string | null>) => {
		const v = { q: data.q, status: data.filter === 'all' ? null : data.filter, ...over };
		const s = Object.entries(v)
			.filter(([, val]) => !!val)
			.map(([k, val]) => `${k}=${encodeURIComponent(val!)}`)
			.join('&');
		return s ? `?${s}` : '';
	};
	const FILTERS = [
		{ id: 'all', label: 'All', n: () => data.counts.all },
		{ id: 'failed', label: 'Not in a note', n: () => data.counts.failed },
		{ id: 'pending', label: 'In progress', n: () => data.counts.pending },
		{ id: 'done', label: 'Done', n: () => data.counts.done }
	] as const;
	// Typing searches as you go: the GET form navigates, replacing the entry and keeping focus
	let timer: ReturnType<typeof setTimeout> | undefined;
	let searchForm = $state<HTMLFormElement>();
	/** Focus only when the header's search icon brought you here to type */
	function focusEmpty(node: HTMLInputElement) {
		if (live.find && !node.value) node.focus();
		live.find = false;
	}
	function typed() {
		clearTimeout(timer);
		timer = setTimeout(() => searchForm?.requestSubmit(), 250);
	}
</script>

<svelte:head><title>{data.q ? `${data.q} · ` : ''}Search · Index 01</title></svelte:head>

<div class="shell">
	<Rail day={null} today={data.rail.today} calendar={data.rail.calendar} />
	<main id="main" class="col" tabindex="-1">
		<h1 class="hk-sr">Search</h1>
		<form
			bind:this={searchForm}
			class="search"
			role="search"
			method="GET"
			action={base}
			data-sveltekit-replacestate
			data-sveltekit-reset="false"
			onsubmit={() => clearTimeout(timer)}
		>
			{#if data.filter !== 'all'}<input type="hidden" name="status" value={data.filter} />{/if}
			<Icon name="search" size={18} />
			<input
				class="hk-input"
				type="search"
				name="q"
				placeholder="Search everything you said"
				aria-label="Search transcripts"
				bind:value={q}
				oninput={typed}
				autocomplete="off"
				use:focusEmpty
			/>
			{#if q}
				<button
					type="button"
					class="hk-btn-ghost iconbtn sm clear"
					aria-label="Clear search"
					onclick={() => {
						q = '';
						clearTimeout(timer);
						queueMicrotask(() => searchForm?.requestSubmit());
					}}><Icon name="close" size={14} /></button
				>
			{/if}
		</form>
		<nav class="tabs" aria-label="Show">
			{#each FILTERS as f (f.id)}
				{#if f.id === 'all' || f.n() > 0 || data.filter === f.id}
					<a
						href="{base}{qs({ status: f.id === 'all' ? null : f.id, before: null })}"
						class:cur={data.filter === f.id}
						aria-current={data.filter === f.id ? 'page' : undefined}
						>{f.label}<span class="tab-n">{f.n()}</span></a
					>
				{/if}
			{/each}
		</nav>

		{#if data.recs.length === 0}
			<p class="muted">
				{data.q
					? `Nothing matches "${data.q}"`
					: data.before
						? 'No older recordings'
						: 'Nothing here'}
			</p>
		{/if}

		{#each groups as g (g.key)}
			<section class="grp">
				<h2 class="grp-h">
					<a
						href={g.key === today
							? resolve('/(app)')
							: resolve('/(app)/day/[date]', { date: g.key })}
						>{relativeDay(g.key, today) ?? longDay(g.key)}</a
					>
				</h2>
				<ul class="notes">
					{#each g.rows as r (r.id)}
						<EntryRow rec={r} {tz} mark={data.q} />
					{/each}
				</ul>
			</section>
		{/each}

		{#if data.next || data.before}
			<nav class="pager" aria-label="Pages">
				{#if data.before}<a class="hk-btn-secondary hk-btn-sm" href="{base}{qs({ before: null })}"
						>Newest</a
					>{/if}
				{#if data.next}<a
						class="hk-btn-secondary hk-btn-sm"
						href="{base}{qs({ before: data.next })}">Older<Icon name="right" /></a
					>{/if}
			</nav>
		{/if}
	</main>
</div>

<style>
	.pager {
		display: flex;
		gap: 0.5rem;
		margin-top: 1.5rem;
	}
</style>
