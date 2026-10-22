<script lang="ts">
	import { resolve } from '$app/paths';
	import Icon from '#lib/components/Icon.svelte';
	import RequestRow from '#lib/components/RequestRow.svelte';
	import SettingsNav from '#lib/components/SettingsNav.svelte';
	import { longDay, relativeDay } from '#lib/components/days.ts';
	import { dayKey, formatTime, triggerLabel } from '#lib/format.ts';
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
	type Ev = (typeof data.events)[number];
	/** What happened, first: the words it brought, or why it was turned away */
	const leadOf = (e: Ev): { text: string; tone: 'err' | 'dim' | 'muted' | '' } => {
		// Red only while fresh enough to act on; the code carries the rest
		if (e.status >= 300)
			return {
				text: capital(e.reason),
				tone: Date.now() - new Date(e.at).getTime() < 60 * 60 * 1000 ? 'err' : 'dim'
			};
		if (e.test) return { text: 'Test request', tone: 'muted' };
		if (e.said) return { text: e.said, tone: '' };
		if (e.recStatus === 'failed') return { text: 'No transcript', tone: 'muted' };
		if (e.recStatus === 'done') return { text: 'No speech', tone: 'muted' };
		if (e.recStatus === 'received') return { text: 'Waiting', tone: 'muted' };
		if (e.recStatus === 'routing') return { text: 'Sending to the note', tone: 'muted' };
		if (e.recordingId) return { text: 'Transcribing', tone: 'muted' };
		return { text: capital(e.reason), tone: 'muted' };
	};
	/** One quiet fact, the most unusual: a duplicate, a transcript alone, no signature, or a
	    trigger other than the usual click */
	const tagsOf = (e: Ev) =>
		[
			e.reason === 'duplicate' ? 'Duplicate' : '',
			e.reason === 'stored transcription' ? 'Transcript only' : '',
			e.status < 300 && !e.test && !e.signed ? 'Unsigned' : '',
			e.status < 300 && !e.test && e.trigger && e.trigger !== 'single-click-hold'
				? triggerLabel(e.trigger)
				: ''
		]
			.filter(Boolean)
			.slice(0, 1);
</script>

<svelte:head><title>Requests · Index 01</title></svelte:head>

<div class="shell">
	<SettingsNav items={nav} current="requests" />
	<main id="main" class="col" tabindex="-1">
		<div class="rqhead">
			<a
				class="hk-btn-ghost iconbtn back"
				href="{resolve('/(app)/settings')}#ring"
				aria-label="Ring settings"
				title="Ring settings"><Icon name="left" size={18} /></a
			>
			<h1 class="sec-h">Requests</h1>
		</div>
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
						{@const lead = leadOf(e)}
						<RequestRow
							time={formatTime(e.at, tz)}
							href={e.recordingId ? resolve('/(app)/recordings/[id]', { id: e.recordingId }) : null}
							lead={lead.text}
							tone={lead.tone}
							code={e.status >= 300 ? e.status : null}
							tags={tagsOf(e)}
							bytes={e.bytes}
						/>
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
	.rqhead {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin: -0.25rem 0 0.75rem -0.625rem;
	}
	.rqhead .sec-h {
		margin: 0;
	}
	.back {
		color: var(--hk-text-3);
	}
	.back:hover {
		color: var(--hk-text);
	}
</style>
