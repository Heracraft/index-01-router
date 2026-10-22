<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import ConfirmAction from '#lib/components/ConfirmAction.svelte';
	import CopyButton from '#lib/components/CopyButton.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import PageHead from '#lib/components/PageHead.svelte';
	import StatusDot from '#lib/components/StatusDot.svelte';
	import Trigger from '#lib/components/Trigger.svelte';
	import {
		formatBytes,
		formatDateTime,
		formatDuration,
		formatElapsed,
		isPending,
		languageName
	} from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const rec = $derived(data.recording);
	const tz = $derived(data.timezone);
	const busy = $derived(isPending(rec.status));
	const failedDeliveries = $derived(data.deliveries.filter((d) => d.status === 'failed').length);
	const ext = $derived(rec.audioMime?.split('/')[1]?.split(';')[0]?.replace(/^x-/, '') ?? '');

	let pending = $state<string | null>(null);
	const submit = (key: string) => () => {
		pending = key;
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			pending = null;
		};
	};

	const DELIVERY: Record<string, string> = {
		pending: 'Pending',
		sent: 'Sent',
		failed: 'Failed',
		skipped: 'Skipped'
	};
</script>

<nav class="crumbs" aria-label="Breadcrumb">
	<a href={resolve('/(app)')}><Icon name="arrow-left" />Recordings</a>
</nav>

<PageHead title={formatDateTime(rec.recordedAt, tz, { seconds: true })}>
	{#snippet sub()}
		<span class="hk-mono">{rec.deliveryId}</span>
	{/snippet}
	{#snippet actions()}
		{#if failedDeliveries > 0 && rec.transcript}
			<form method="POST" action="?/route" use:enhance={submit('route')}>
				<button
					class="hk-btn-secondary"
					disabled={busy || !!pending}
					aria-busy={pending === 'route'}
				>
					{pending === 'route' ? 'Delivering…' : 'Deliver again'}
				</button>
			</form>
		{/if}
		{#if rec.hasAudio || rec.appTranscript}
			<form method="POST" action="?/transcribe" use:enhance={submit('transcribe')}>
				<button
					class="hk-btn-secondary"
					disabled={busy || !!pending}
					aria-busy={pending === 'transcribe'}
				>
					{pending === 'transcribe' ? 'Queuing…' : 'Transcribe again'}
				</button>
			</form>
		{/if}
		<ConfirmAction action="?/delete" label="Delete" title="Delete recording" confirmLabel="Delete">
			<p>
				Delete the recording from {formatDateTime(rec.recordedAt, tz)}? The audio file and
				transcript go too. Notes already delivered stay where they are.
			</p>
		</ConfirmAction>
	{/snippet}
</PageHead>

{#if form && 'error' in form && form.error}
	<p class="hk-banner hk-banner--err" role="alert">{form.error}</p>
{/if}
{#if rec.status === 'failed' && rec.error}
	<p class="hk-banner hk-banner--err" role="status">{rec.error}</p>
{:else if rec.error && !busy}
	<p class="hk-banner" role="status">{rec.error}</p>
{/if}

<dl class="facts">
	<div>
		<dt>Status</dt>
		<dd><StatusDot status={rec.status} /></dd>
	</div>
	<div>
		<dt>Trigger</dt>
		<dd><Trigger trigger={rec.trigger} /></dd>
	</div>
	{#if rec.durationMs != null}
		<div>
			<dt>Duration</dt>
			<dd class="hk-num">{formatDuration(rec.durationMs)}</dd>
		</div>
	{/if}
	{#if rec.languages.length}
		<div>
			<dt>Languages</dt>
			<dd>
				{rec.languages.map(languageName).join(', ')}
				<span class="muted hk-mono">{rec.languages.join(' ')}</span>
			</dd>
		</div>
	{/if}
	{#if rec.transcribedBy}
		<div>
			<dt>Transcribed by</dt>
			<dd>
				<span class="hk-mono">{rec.transcribedBy}</span>
				{#if rec.transcribeMs != null}<span class="muted">· {formatElapsed(rec.transcribeMs)}</span
					>{/if}
			</dd>
		</div>
	{/if}
	<div>
		<dt>Received</dt>
		<dd class="hk-num">
			{formatDateTime(rec.receivedAt, tz, { seconds: true })}
			{#if rec.source === 'ring'}<span class="muted">· {rec.signed ? 'Signed' : 'Unsigned'}</span
				>{/if}
		</dd>
	</div>
	{#if rec.hasAudio}
		<div>
			<dt>Audio</dt>
			<dd class="hk-num">{[ext, formatBytes(rec.audioBytes)].filter(Boolean).join(' · ')}</dd>
		</div>
	{/if}
	{#if rec.attempts > 1}
		<div>
			<dt>Attempts</dt>
			<dd class="hk-num">{rec.attempts}</dd>
		</div>
	{/if}
</dl>

{#if rec.hasAudio}
	<audio class="player" controls preload="metadata" src="/recordings/{rec.id}/audio"></audio>
{/if}

<section>
	<div class="sec-head">
		<h2>Transcript</h2>
		{#if rec.transcript}<CopyButton text={rec.transcript} label="Copy" />{/if}
	</div>
	{#if rec.transcript}
		<p class="transcript">{rec.transcript}</p>
	{:else}
		<div class="hk-empty-row"><StatusDot status={rec.status} /></div>
	{/if}

	{#if rec.appTranscript}
		<details class="app">
			<summary>Phone transcript</summary>
			<p class="transcript small">{rec.appTranscript}</p>
		</details>
	{/if}
</section>

<section>
	<div class="sec-head">
		<h2>Deliveries</h2>
		{#if data.deliveries.length}
			<span class="caption hk-num">
				{data.deliveries.filter((d) => d.status === 'sent').length} of {data.deliveries.length} sent
			</span>
		{/if}
	</div>
	{#if data.deliveries.length === 0}
		<div class="hk-empty-row">
			<span>{busy ? 'No deliveries yet.' : 'No integration matched this recording.'}</span>
			<a class="hk-link" href={resolve('/(app)/integrations')}>Integrations</a>
		</div>
	{:else}
		<div class="tbl" role="region" aria-label="Deliveries" tabindex="-1">
			<table class="hk-table">
				<thead>
					<tr>
						<th>Integration</th>
						<th>Status</th>
						<th>Target</th>
						<th class="hk-num-col">Attempts</th>
						<th>Error</th>
						<th><span class="hk-sr">Action</span></th>
					</tr>
				</thead>
				<tbody>
					{#each data.deliveries as d (d.id)}
						<tr>
							<td data-label="Integration">
								<a class="name" href={resolve('/(app)/integrations/[id]', { id: d.integrationId })}
									>{d.name}</a
								>
							</td>
							<td data-label="Status">
								{#if d.status === 'failed'}
									<span class="hk-badge hk-badge--err">Failed</span>
								{:else if d.status === 'pending'}
									<span class="pending"><span class="hk-dot hk-dot--busy"></span>Pending</span>
								{:else}
									{DELIVERY[d.status] ?? d.status}
								{/if}
							</td>
							<td data-label="Target" class="hk-mono target">{d.target ?? ''}</td>
							<td data-label="Attempts" class="hk-num-col">{d.attempts}</td>
							<td data-label="Error" class="error" class:soft={d.status !== 'failed'}
								>{d.error ?? ''}</td
							>
							<td class="act">
								{#if d.status === 'failed'}
									<form method="POST" action="?/redeliver" use:enhance={submit(d.id)}>
										<input type="hidden" name="delivery" value={d.id} />
										<button
											class="hk-btn-secondary hk-btn-sm"
											disabled={busy || !!pending}
											aria-busy={pending === d.id}
										>
											{pending === d.id ? 'Retrying…' : 'Retry'}
										</button>
									</form>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>

<style>
	.crumbs {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
		font-size: 0.875rem;
		color: var(--hk-text-3);
	}
	.crumbs a {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		color: inherit;
		text-decoration: none;
	}
	.crumbs a:hover {
		color: var(--hk-text);
	}
	.muted {
		color: var(--hk-text-3);
	}

	.facts {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		margin: 0;
		border-top: 1px solid var(--hk-hairline);
		border-bottom: 1px solid var(--hk-hairline);
	}
	.facts > div {
		display: grid;
		grid-template-columns: 8.5rem minmax(0, 1fr);
		gap: 1rem;
		padding: 0.625rem 0;
		font-size: 0.875rem;
	}
	.facts > div + div {
		border-top: 1px solid var(--hk-hairline);
	}
	dt {
		color: var(--hk-text-3);
	}
	dd {
		margin: 0;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	@media (min-width: 900px) {
		.facts {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			column-gap: 2.5rem;
		}
		.facts > div:nth-child(2) {
			border-top: 0;
		}
	}

	.player {
		display: block;
		width: 100%;
		max-width: 42rem;
		margin-top: 1.75rem;
		height: 2.5rem;
	}

	section {
		margin-top: 2.75rem;
	}
	.sec-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 0.75rem;
	}
	h2 {
		margin: 0;
		font-size: 1.25rem;
		line-height: 1.75rem;
		letter-spacing: -0.01em;
	}
	.caption {
		font-size: 0.8125rem;
		color: var(--hk-text-3);
	}
	.transcript {
		max-width: 42rem;
		margin: 0;
		font-size: 1rem;
		line-height: 1.7;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		color: var(--hk-text);
	}
	.transcript.small {
		font-size: 0.9375rem;
		color: var(--hk-text-2);
	}
	.app {
		margin-top: 1.5rem;
		border-top: 1px solid var(--hk-hairline);
		padding-top: 0.875rem;
	}
	.app summary {
		font-size: 0.875rem;
		color: var(--hk-text-2);
		cursor: pointer;
		margin-bottom: 0.5rem;
	}
	.app summary:hover {
		color: var(--hk-text);
	}

	.tbl {
		overflow-x: auto;
	}
	.name {
		color: var(--hk-text);
		font-weight: 500;
		text-decoration: none;
	}
	.name:hover {
		text-decoration: underline;
		text-decoration-color: color-mix(in srgb, currentColor 35%, transparent);
	}
	.target {
		font-size: 0.75rem;
		overflow-wrap: anywhere;
	}
	.error {
		color: var(--hk-err);
		max-width: 22rem;
	}
	.error.soft {
		color: var(--hk-text-3);
	}
	.act {
		text-align: right;
		white-space: nowrap;
	}
	.pending {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}

	/* Phone: one block per delivery */
	@media (max-width: 639.98px) {
		.hk-table thead {
			display: none;
		}
		.hk-table,
		.hk-table tbody,
		.hk-table tr,
		.hk-table td {
			display: block;
		}
		.hk-table tr {
			padding: 0.75rem 0;
			border-top: 1px solid var(--hk-hairline);
		}
		.hk-table td {
			padding: 0.125rem 0 !important;
			border: 0 !important;
			text-align: left;
		}
		.hk-table td:empty {
			display: none;
		}
		.act {
			text-align: left;
			padding-top: 0.5rem !important;
		}
		.hk-table td:is([data-label='Attempts'], [data-label='Target'])::before {
			content: attr(data-label) ' ';
			font-family: var(--hk-font-sans);
			color: var(--hk-text-3);
		}
	}
</style>
