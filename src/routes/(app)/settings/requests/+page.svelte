<script lang="ts">
	import { resolve } from '$app/paths';
	import SettingsNav from '#lib/components/SettingsNav.svelte';
	import { longDay, relativeDay } from '#lib/components/days.ts';
	import { dayKey, formatBytes, formatTime, triggerLabel } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const tz = $derived(data.timezone);
	const today = $derived(dayKey(new Date(), tz));

	const groups = $derived.by(() => {
		const out: { key: string; label: string; rows: typeof data.events }[] = [];
		for (const e of data.events) {
			const key = dayKey(e.at, tz);
			let g = out.at(-1);
			if (!g || g.key !== key) {
				g = { key, label: relativeDay(key, today) ?? longDay(key), rows: [] };
				out.push(g);
			}
			g.rows.push(e);
		}
		return out;
	});
	const nav = [
		{ id: 'note', label: 'Daily note' },
		{ id: 'transcription', label: 'Transcription' },
		{ id: 'ring', label: 'Ring' },
		{ id: 'general', label: 'General' }
	];
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

<div class="shell">
	<SettingsNav items={nav} current="requests" />
	<main id="main" class="col" tabindex="-1">
		<h1 class="hk-h1-app page-h">Requests</h1>
		<nav class="tabs" aria-label="Show">
			<a
				href={resolve('/(app)/settings/requests')}
				class:cur={data.show === 'all'}
				aria-current={data.show === 'all' ? 'page' : undefined}
				>All<span class="tab-n">{data.counts.all}</span></a
			>
			<a
				href="{resolve('/(app)/settings/requests')}?show=rejected"
				class:cur={data.show === 'rejected'}
				aria-current={data.show === 'rejected' ? 'page' : undefined}
				>Rejected<span class="tab-n">{data.counts.rejected}</span></a
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
						{@const bad = e.status >= 300}
						{@const trig = e.trigger ? triggerLabel(e.trigger) : ''}
						{@const res = resultOf(e) || (e.signed || e.test ? '' : 'Unsigned')}
						<li class:link={!!e.recordingId}>
							{#if e.recordingId}
								<a class="r-t" href={resolve('/(app)/recordings/[id]', { id: e.recordingId })}
									>{formatTime(e.at, tz, true)}</a
								>
							{:else}
								<span class="r-t">{formatTime(e.at, tz, true)}</span>
							{/if}
							<span class="what">
								<!-- A rejected request has no trigger: its reason takes that column -->
								<span class="r-g" class:bad={!trig && bad}>{trig || res}</span>
								{#if trig && res !== trig}<span class="r-m" class:bad>{res}</span>{/if}
							</span>
							<span class="r-c">{e.status === 200 ? '' : e.status}</span>
							<span class="r-s">{e.bytes ? formatBytes(e.bytes) : ''}</span>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	</main>
</div>

<style>
	.page-h {
		margin: 0 0 1rem;
	}
	.bad,
	.r-g.bad {
		color: var(--hk-err);
	}
	.what {
		display: flex;
		gap: 0 0.75rem;
		min-width: 0;
	}
	.r-g {
		flex: none;
		min-width: 6.5rem;
		color: var(--hk-text-2);
	}
	.r-m {
		min-width: 0;
		color: var(--hk-text-3);
	}
	.link {
		position: relative;
	}
	a.r-t {
		text-decoration: none;
	}
	a.r-t::after {
		content: '';
		position: absolute;
		inset: 0;
	}
	.link:hover {
		background: var(--hk-hover);
	}
	.log :global(li) {
		grid-template-columns: 4.75rem minmax(0, 1fr) 2.5rem 4rem;
	}
	@media (max-width: 639.98px) {
		.log :global(li) {
			grid-template-columns: 4.25rem minmax(0, 1fr) 2.25rem;
		}
		.what {
			flex-wrap: wrap;
		}
		.r-g {
			width: auto;
		}
	}
</style>
