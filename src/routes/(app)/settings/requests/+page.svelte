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
	/** A badge for anything but the usual outcome, and the reason for a rejection */
	const outcomeOf = (e: (typeof data.events)[number]) => {
		if (e.status >= 300)
			return { badge: `Rejected ${e.status}`, tone: 'err', note: capital(e.reason) };
		if (e.test) return { badge: 'Test', tone: '', note: '' };
		if (e.reason === 'duplicate') return { badge: 'Duplicate', tone: '', note: '' };
		if (e.reason === 'stored transcription')
			return { badge: 'Transcript only', tone: '', note: '' };
		if (!e.signed) return { badge: 'Unsigned', tone: 'warn', note: '' };
		if (e.reason !== 'stored') return { badge: '', tone: '', note: capital(e.reason) };
		return null;
	};
</script>

<svelte:head><title>Requests · Index 01</title></svelte:head>

<div class="shell">
	<SettingsNav items={nav} current="requests" />
	<main id="main" class="col" tabindex="-1">
		<h1 class="hk-sr">Requests</h1>
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
				<ul class="log">
					{#each g.rows as e (e.id)}
						{@const out = outcomeOf(e)}
						<li class:link={!!e.recordingId}>
							{#if e.recordingId}
								<a class="r-t" href={resolve('/(app)/recordings/[id]', { id: e.recordingId })}
									>{formatTime(e.at, tz, true)}</a
								>
							{:else}
								<span class="r-t">{formatTime(e.at, tz, true)}</span>
							{/if}
							<span class="r-g">{e.trigger && !e.test ? triggerLabel(e.trigger) : ''}</span>
							<span class="r-o" title={out?.note || undefined}>
								{#if out?.badge}<span class="obadge {out.tone}">{out.badge}</span>{/if}
								{#if out?.note}<span class="r-m">{out.note}</span>{/if}
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
	.log {
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: 0.8125rem;
	}
	.log li {
		display: grid;
		grid-template-columns: 4.75rem 7rem minmax(0, 1fr) 4rem;
		gap: 0.75rem;
		align-items: center;
		min-height: 2.5rem;
		border-bottom: 1px solid var(--hk-hairline);
		font-variant-numeric: tabular-nums;
	}
	.log li:last-child {
		border-bottom: 0;
	}
	.r-t {
		color: var(--hk-text-3);
	}
	.r-g {
		color: var(--hk-text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.r-o {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}
	.r-m {
		min-width: 0;
		color: var(--hk-text-3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.r-s {
		color: var(--hk-text-3);
		text-align: right;
	}
	.link {
		position: relative;
		cursor: pointer;
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
	@media (max-width: 639.98px) {
		.log li {
			grid-template-columns: 4.25rem 5.75rem minmax(0, 1fr);
			gap: 0.5rem;
		}
		.r-s {
			display: none;
		}
	}
</style>
