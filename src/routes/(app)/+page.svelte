<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import CopyButton from '#lib/components/CopyButton.svelte';
	import FilterTabs from '#lib/components/FilterTabs.svelte';
	import PageHead from '#lib/components/PageHead.svelte';
	import Signal from '#lib/components/Signal.svelte';
	import StatusDot from '#lib/components/StatusDot.svelte';
	import Trigger from '#lib/components/Trigger.svelte';
	import WeekBars from '#lib/components/WeekBars.svelte';
	import { live } from '#lib/components/live.svelte.ts';
	import { cleanError, describeRecording } from '#lib/recording-state.ts';
	import {
		dayKey,
		dayLabel,
		formatDuration,
		formatNumber,
		formatTime,
		languageName
	} from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const tz = $derived(data.timezone);
	const FILTERS = [
		{ value: 'all', label: 'All' },
		{ value: 'pending', label: 'Pending' },
		{ value: 'failed', label: 'Failed' },
		{ value: 'done', label: 'Done' }
	] as const;
	const tabs = $derived([
		{ value: 'all', label: 'All', count: data.stats.total },
		{ value: 'pending', label: 'Pending', count: data.stats.pending },
		{ value: 'failed', label: 'Failed', count: data.stats.failed, tone: 'err' as const },
		{ value: 'done', label: 'Done', count: data.stats.done }
	]);
	const filterQuery = (value: string) => (value === 'all' ? '' : `?status=${value}`);
	const olderQuery = $derived(
		data.nextCursor
			? `?${new URLSearchParams({
					...(data.filter === 'all' ? {} : { status: data.filter }),
					before: data.nextCursor
				})}`
			: ''
	);

	// Group consecutive rows by day in the general timezone
	const groups = $derived.by(() => {
		const now = new Date();
		const out: { key: string; label: string; rows: typeof data.recordings }[] = [];
		for (const r of data.recordings) {
			const key = dayKey(r.recordedAt, tz);
			let g = out.at(-1);
			if (!g || g.key !== key) {
				g = { key, label: dayLabel(r.recordedAt, tz, now), rows: [] };
				out.push(g);
			}
			g.rows.push(r);
		}
		return out;
	});

	// A live refresh marks rows that are new or changed status for a moment
	let seen: Map<string, string> | null = null;
	let changed = $state(new Set<string>());
	let clearTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const now = new Map(data.recordings.map((r) => [r.id, r.status]));
		const prev = seen;
		seen = now;
		if (!prev) return;
		const hits = [...now].filter(([id, status]) => prev.get(id) !== status).map(([id]) => id);
		if (!hits.length) return;
		changed = new Set(hits);
		clearTimeout(clearTimer);
		clearTimer = setTimeout(() => (changed = new Set()), 1200);
	});
	$effect(() => () => clearTimeout(clearTimer));

	let fileInput = $state<HTMLInputElement>();
	let uploadForm = $state<HTMLFormElement>();
	let uploading = $state(false);
	let lastModified = $state('');

	function picked() {
		const file = fileInput?.files?.[0];
		if (!file) return;
		lastModified = String(file.lastModified);
		// Wait a tick so the hidden lastModified input carries the new value
		queueMicrotask(() => uploadForm?.requestSubmit());
	}

	const failedLabel = (targets: string[]) =>
		targets[0] + (targets.length > 1 ? ` +${targets.length - 1}` : '');
</script>

<PageHead title="Recordings">
	{#snippet sub()}
		{#if live.connected}
			<Signal tone="live" label="Live" hideLabel title="Live" />
		{:else}
			<Signal tone="idle" label="Offline" />
		{/if}
	{/snippet}
	{#snippet actions()}
		<form
			bind:this={uploadForm}
			method="POST"
			action="?/upload"
			enctype="multipart/form-data"
			use:enhance={() => {
				uploading = true;
				return async ({ update, result }) => {
					if (result.type === 'success' && typeof result.data?.uploaded === 'string') {
						await goto(resolve('/(app)/recordings/[id]', { id: result.data.uploaded }));
					} else {
						await update();
					}
					uploading = false;
				};
			}}
		>
			<input
				bind:this={fileInput}
				class="hk-sr"
				type="file"
				name="audio"
				accept="audio/*,.m4a,.opus"
				tabindex="-1"
				onchange={picked}
			/>
			<input type="hidden" name="lastModified" value={lastModified} />
			<button
				type="button"
				class="hk-btn"
				aria-busy={uploading}
				disabled={uploading}
				onclick={() => fileInput?.click()}
			>
				{uploading ? 'Uploading…' : 'Upload audio'}
			</button>
		</form>
	{/snippet}
</PageHead>

{#if form?.upload}
	<p class="hk-banner hk-banner--err" role="alert">{form.upload}</p>
{/if}

<div class="hk-stats stats">
	<div class="hk-stat">
		<div class="hk-stat-label">Today</div>
		<div class="hk-stat-value hk-num">{formatNumber(data.stats.today)}</div>
	</div>
	<div class="hk-stat">
		<div class="hk-stat-label">This week</div>
		<div class="hk-stat-value hk-num">{formatNumber(data.stats.week)}</div>
		<WeekBars days={data.weekDays} />
	</div>
</div>

<section class="list">
	<div class="bar">
		<FilterTabs
			label="Filter by status"
			items={tabs}
			current={data.filter}
			href={(v) => `${resolve('/(app)')}${filterQuery(v)}`}
		/>
	</div>

	{#if data.recordings.length === 0}
		<div class="hk-empty-row">
			{#if data.before}
				<span>No older recordings.</span>
				<a class="hk-link" href="{resolve('/(app)')}{filterQuery(data.filter)}">Newest</a>
			{:else if data.filter === 'all'}
				<span>No recordings yet.</span>
				{#if data.webhookUrl}
					<span class="first">
						<span class="hk-mono url">{data.webhookUrl}</span>
						<CopyButton text={data.webhookUrl} label="Copy" />
					</span>
				{/if}
			{:else}
				<span
					>No {FILTERS.find((f) => f.value === data.filter)?.label.toLowerCase()} recordings.</span
				>
			{/if}
		</div>
	{:else}
		{#each groups as g (g.key)}
			<h2 class="day">{g.label}</h2>
			<ul class="rows">
				{#each g.rows as r (r.id)}
					{@const st = describeRecording(r)}
					<li>
						<a
							class="rec"
							class:changed={changed.has(r.id)}
							href={resolve('/(app)/recordings/[id]', { id: r.id })}
						>
							<span class="time hk-num">{formatTime(r.recordedAt, tz)}</span>
							<span class="trig"><Trigger trigger={r.trigger} compact /></span>
							<span class="text">
								{#if st.slot.kind === 'text'}
									{r.line}
								{:else if st.slot.kind === 'error'}
									<span class="err-text">{st.slot.text}</span>
								{:else if st.slot.kind === 'no-speech'}
									<span class="muted">No speech</span>
								{:else}
									<StatusDot
										status={r.status}
										attempt={r.attempts}
										lastError={st.retry?.lastError}
									/>
								{/if}
							</span>
							<span class="langs">
								{#each r.languages as code (code)}
									<span class="hk-badge hk-badge--mono" title={languageName(code)}>{code}</span>
								{/each}
							</span>
							<span class="dur hk-num">{formatDuration(r.durationMs)}</span>
							<span class="state">
								{#if r.failedTargets.length}
									<Signal
										tone="err"
										label={failedLabel(r.failedTargets)}
										title={r.failedError ? cleanError(r.failedError) : null}
									/>
								{:else if r.status === 'failed' && st.slot.kind === 'text'}
									<StatusDot status="failed" />
								{:else if st.slot.kind === 'text' && r.status !== 'done' && r.status !== 'failed'}
									<StatusDot
										status={r.status}
										attempt={r.status === 'routing' ? r.deliveryAttempt : r.attempts}
										lastError={r.status === 'routing'
											? r.deliveryError && cleanError(r.deliveryError)
											: st.retry?.lastError}
									/>
								{/if}
							</span>
						</a>
					</li>
				{/each}
			</ul>
		{/each}
		{#if data.nextCursor || data.before}
			<nav class="more" aria-label="Pages">
				{#if data.before}
					<a class="hk-btn-secondary" href="{resolve('/(app)')}{filterQuery(data.filter)}">Newest</a
					>
				{/if}
				{#if data.nextCursor}
					<a class="hk-btn-secondary" href="{resolve('/(app)')}{olderQuery}">Older</a>
				{/if}
			</nav>
		{/if}
	{/if}
</section>

<style>
	/* Two stats at every width */
	.hk-stats.stats {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.first {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}
	.url {
		font-size: 0.8125rem;
		color: var(--hk-text-2);
		overflow-wrap: anywhere;
	}
	.muted {
		color: var(--hk-text-3);
	}

	.list {
		margin-top: 2.75rem;
	}
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.75rem 1rem;
		margin-bottom: 1rem;
	}

	.day {
		margin: 1.5rem 0 0;
		padding-bottom: 0.5rem;
		font-family: var(--hk-font-sans);
		font-size: 0.75rem;
		font-weight: 500;
		letter-spacing: 0;
		color: var(--hk-text-3);
		border-bottom: 1px solid var(--hk-border);
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.rows li + li {
		border-top: 1px solid var(--hk-hairline);
	}
	.rec {
		display: grid;
		grid-template-columns: auto auto auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.25rem 0.75rem;
		padding: 0.875rem 0;
		color: var(--hk-text);
		text-decoration: none;
		font-size: 0.875rem;
		transition: background-color var(--hk-dur-fast) var(--hk-ease);
	}
	.rec:hover,
	.rec.changed {
		background: var(--hk-hover);
	}
	@media (prefers-reduced-motion: no-preference) {
		.rec {
			transition: background-color var(--hk-dur-meter) var(--hk-ease);
		}
	}
	/* Phone: transcript on top, meta under it */
	.text {
		grid-column: 1 / -1;
		min-width: 0;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.err-text {
		color: var(--hk-err);
	}
	.time,
	.trig,
	.langs,
	.dur {
		font-size: 0.8125rem;
		color: var(--hk-text-3);
	}
	.time {
		grid-row: 2;
		grid-column: 1;
	}
	.trig {
		grid-row: 2;
		grid-column: 2;
		display: inline-flex;
	}
	.dur {
		grid-row: 2;
		grid-column: 3;
	}
	.langs {
		grid-row: 2;
		grid-column: 4;
		display: inline-flex;
		gap: 0.25rem;
	}
	.state {
		grid-row: 2;
		grid-column: 5;
		display: inline-flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.375rem;
		font-size: 0.8125rem;
	}

	@media (min-width: 640px) {
		.rec {
			grid-template-columns: 3rem 1.25rem minmax(0, 1fr) auto 3.25rem minmax(6.5rem, auto);
			align-items: center;
			gap: 0 1rem;
			padding: 0.75rem 0.5rem;
			margin: 0 -0.5rem;
			border-radius: var(--hk-radius-6);
		}
		.time,
		.trig,
		.text,
		.langs,
		.dur,
		.state {
			grid-row: auto;
			grid-column: auto;
		}
		.text {
			display: block;
			white-space: nowrap;
			text-overflow: ellipsis;
		}
		.trig,
		.langs {
			display: inline-flex;
		}
		.dur {
			text-align: right;
		}
	}

	.more {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem;
		margin-top: 1.25rem;
		padding-top: 1.25rem;
		border-top: 1px solid var(--hk-hairline);
	}
</style>
