<script lang="ts">
	import { resolve } from '$app/paths';
	import Icon from '#lib/components/Icon.svelte';
	import { dayKey, dayLabel, formatBytes, formatTime, triggerLabel } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const tz = $derived(data.timezone);

	const groups = $derived.by(() => {
		const out: { key: string; label: string; rows: typeof data.events }[] = [];
		for (const e of data.events) {
			const key = dayKey(e.at, tz);
			let g = out.at(-1);
			if (!g || g.key !== key) {
				g = { key, label: dayLabel(e.at, tz), rows: [] };
				out.push(g);
			}
			g.rows.push(e);
		}
		return out;
	});
	const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
	/** Nothing for the usual outcome, the reason otherwise */
	const resultOf = (e: (typeof data.events)[number]) =>
		e.test
			? 'Test event'
			: e.reason === 'stored'
				? ''
				: e.reason === 'stored transcription'
					? 'Transcript only'
					: capital(e.reason);
</script>

<svelte:head><title>Requests · Index 01</title></svelte:head>

<div class="shell shell--one">
	<main id="main" class="col" tabindex="-1">
		<a class="back" href="{resolve('/(app)/settings')}#ring"><Icon name="left" />Settings</a>
		<h1 class="hk-h1-app">Requests</h1>
		<nav class="filters" aria-label="Show">
			<a href={resolve('/(app)/settings/requests')} class:cur={data.show === 'all'}
				>All {data.counts.all}</a
			>
			<a
				href="{resolve('/(app)/settings/requests')}?show=rejected"
				class:cur={data.show === 'rejected'}>Rejected {data.counts.rejected}</a
			>
		</nav>
		{#if data.events.length === 0}
			<p class="muted">{data.show === 'rejected' ? 'No rejected requests' : 'No requests yet'}</p>
		{/if}
		{#each groups as g (g.key)}
			<section class="grp">
				<h2 class="grp-h">{g.label}</h2>
				<ul class="rej log">
					{#each g.rows as e (e.id)}
						<li>
							<span class="r-t">{formatTime(e.at, tz, true)}</span>
							<span class="r-c" class:ok={e.status < 300}>{e.status}</span>
							<span class="what">
								{#if e.recordingId}
									<a href={resolve('/(app)/recordings/[id]', { id: e.recordingId })}
										>{triggerLabel(e.trigger) || 'Recording'}</a
									>
								{:else}
									<span>{triggerLabel(e.trigger)}</span>
								{/if}
								{#if resultOf(e)}<span class:bad={e.status >= 300} class:muted={e.status < 300}
										>{resultOf(e)}</span
									>{/if}
								{#if !e.signed && e.status < 300 && !e.test}<span class="muted">Unsigned</span>{/if}
							</span>
							<span class="r-s">{e.bytes ? formatBytes(e.bytes) : ''}</span>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	</main>
</div>

<style>
	h1 {
		margin: 0 0 1.25rem;
	}
	.filters {
		margin: 0 0 0.5rem;
	}
	.what {
		display: flex;
		flex-wrap: wrap;
		gap: 0 0.625rem;
		min-width: 0;
	}
	.what a {
		color: var(--hk-text);
	}
	.bad {
		color: var(--hk-err);
	}
	.log :global(li) {
		grid-template-columns: 5rem 2.5rem minmax(0, 1fr) auto;
	}
</style>
