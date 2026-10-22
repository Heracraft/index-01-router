<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import PageHead from '#lib/components/PageHead.svelte';
	import StatusDot from '#lib/components/StatusDot.svelte';
	import Trigger from '#lib/components/Trigger.svelte';
	import { live } from '#lib/components/live.svelte.ts';
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
	const filterQuery = (value: string) => (value === 'all' ? '' : `?status=${value}`);
	const moreQuery = $derived(
		`?${new URLSearchParams({
			...(data.filter === 'all' ? {} : { status: data.filter }),
			limit: String(data.limit + 50)
		})}`
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
</script>

<PageHead title="Recordings">
	{#snippet sub()}
		<span class="live" class:on={live.connected}>
			<span class="hk-dot" class:hk-dot--live={live.connected} aria-hidden="true"></span>
			{live.connected ? 'Live' : 'Offline'}
		</span>
	{/snippet}
	{#snippet actions()}
		<form
			bind:this={uploadForm}
			method="POST"
			action="?/upload"
			enctype="multipart/form-data"
			use:enhance={() => {
				uploading = true;
				return async ({ update }) => {
					await update();
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

<div class="hk-stats">
	<div class="hk-stat">
		<div class="hk-stat-label">Today</div>
		<div class="hk-stat-value hk-num">{formatNumber(data.stats.today)}</div>
	</div>
	<div class="hk-stat">
		<div class="hk-stat-label">This week</div>
		<div class="hk-stat-value hk-num">{formatNumber(data.stats.week)}</div>
	</div>
	<div class="hk-stat">
		<div class="hk-stat-label">Pending</div>
		<div class="hk-stat-value hk-num">{formatNumber(data.stats.pending)}</div>
	</div>
	<div class="hk-stat">
		<div class="hk-stat-label">Failed</div>
		<div class="hk-stat-value hk-num" class:err={data.stats.failed > 0}>
			{#if data.stats.failed > 0}
				<a href="{resolve('/(app)')}?status=failed">{formatNumber(data.stats.failed)}</a>
			{:else}
				0
			{/if}
		</div>
	</div>
</div>

<section class="list">
	<div class="bar">
		<nav class="hk-seg hk-seg--sm" aria-label="Filter by status">
			{#each FILTERS as f (f.value)}
				<a
					href="{resolve('/(app)')}{filterQuery(f.value)}"
					class:on={data.filter === f.value}
					aria-current={data.filter === f.value ? 'page' : undefined}
					data-sveltekit-reset="false"
					data-sveltekit-replacestate>{f.label}</a
				>
			{/each}
		</nav>
		<span class="caption hk-num">
			{formatNumber(data.matching)}
			{data.matching === 1 ? 'recording' : 'recordings'}
		</span>
	</div>

	{#if data.recordings.length === 0}
		<div class="hk-empty-row">
			{#if data.filter === 'all'}
				<span>No recordings yet.</span>
				<a class="hk-link" href={resolve('/(app)/webhook')}>Webhook URL</a>
			{:else}
				<span
					>No {FILTERS.find((f) => f.value === data.filter)?.label.toLowerCase()} recordings.</span
				>
				<a class="hk-link" href={resolve('/(app)')}>All recordings</a>
			{/if}
		</div>
	{:else}
		{#each groups as g (g.key)}
			<h2 class="day">{g.label}</h2>
			<ul class="rows">
				{#each g.rows as r (r.id)}
					<li>
						<a class="rec" href={resolve('/(app)/recordings/[id]', { id: r.id })}>
							<span class="time hk-num">{formatTime(r.recordedAt, tz)}</span>
							<span class="trig"><Trigger trigger={r.trigger} /></span>
							<span class="text" class:muted={!r.line && r.status !== 'failed'}>
								{#if r.status === 'failed' && !r.line}
									<span class="err-text">{r.error ?? 'Failed'}</span>
								{:else if r.line}
									{r.line}
								{:else}
									<StatusDot status={r.status} />
								{/if}
							</span>
							<span class="langs">
								{#each r.languages as code (code)}
									<span class="hk-badge hk-badge--mono" title={languageName(code)}>{code}</span>
								{/each}
							</span>
							<span class="dur hk-num">{formatDuration(r.durationMs)}</span>
							<span class="state">
								{#if r.status === 'failed' && r.line}
									<StatusDot status="failed" />
								{:else if r.failedDeliveries > 0}
									<span class="hk-badge hk-badge--err">{r.failedDeliveries} failed</span>
								{:else if r.line && r.status !== 'done'}
									<StatusDot status={r.status} />
								{/if}
							</span>
						</a>
					</li>
				{/each}
			</ul>
		{/each}
		{#if data.recordings.length < data.matching}
			<div class="more">
				<a
					class="hk-btn-secondary"
					href="{resolve('/(app)')}{moreQuery}"
					data-sveltekit-reset="false"
					data-sveltekit-replacestate>Load 50 more</a
				>
				<span class="caption hk-num">
					{formatNumber(data.recordings.length)} of {formatNumber(data.matching)}
				</span>
			</div>
		{/if}
	{/if}
</section>

<style>
	.live {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
	}
	.err a,
	.err {
		color: var(--hk-err);
	}
	.err a {
		text-decoration: none;
	}
	.err a:hover {
		text-decoration: underline;
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
	.hk-seg a {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 1.5rem;
		padding: 0 0.625rem;
		border-radius: var(--hk-radius-6);
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--hk-text-3);
		text-decoration: none;
		white-space: nowrap;
		transition: color var(--hk-dur-fast) var(--hk-ease);
	}
	.hk-seg a:hover,
	.hk-seg a.on {
		color: var(--hk-text);
	}
	.hk-seg a.on {
		background: var(--hk-surface);
		box-shadow:
			0 0 0 1px var(--hk-border),
			0 1px 2px rgb(0 0 0 / 0.06);
	}
	.caption {
		font-size: 0.8125rem;
		color: var(--hk-text-3);
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
	.rec:hover {
		background: var(--hk-hover);
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
	.text.muted {
		color: var(--hk-text-3);
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
	.trig :global(.trigger > span) {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
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
			grid-template-columns: 3rem 7.25rem minmax(0, 1fr) auto 3.25rem 6.5rem;
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
		.trig :global(.trigger > span) {
			position: static;
			width: auto;
			height: auto;
			clip: auto;
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
		align-items: center;
		gap: 1rem;
		margin-top: 1.25rem;
		padding-top: 1.25rem;
		border-top: 1px solid var(--hk-hairline);
	}
</style>
