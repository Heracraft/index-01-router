<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import ConfirmAction from '#lib/components/ConfirmAction.svelte';
	import CopyButton from '#lib/components/CopyButton.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import NotePreview from '#lib/components/NotePreview.svelte';
	import PageHead from '#lib/components/PageHead.svelte';
	import Signal from '#lib/components/Signal.svelte';
	import StatusDot from '#lib/components/StatusDot.svelte';
	import Trigger from '#lib/components/Trigger.svelte';
	import { cleanError, describeRecording } from '#lib/recording-state.ts';
	import {
		formatBytes,
		formatDateTime,
		formatDuration,
		formatElapsed,
		isPending,
		languageName,
		statusLabel,
		triggerLabel
	} from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const rec = $derived(data.recording);
	const tz = $derived(data.timezone);
	const busy = $derived(isPending(rec.status));
	const st = $derived(describeRecording(rec));
	const failedDeliveries = $derived(data.deliveries.filter((d) => d.status === 'failed').length);
	const ext = $derived(rec.audioMime?.split('/')[1]?.split(';')[0]?.replace(/^x-/, '') ?? '');
	const hasTranscript = $derived(!!rec.transcript?.trim());

	// Header delivery button: what pressing it does, or nothing to do
	const deliverLabel = $derived(
		failedDeliveries > 0
			? `Retry ${failedDeliveries} failed`
			: data.deliveries.length === 0 && data.matching.length
				? data.matching.length === 1
					? `Deliver to ${data.matching[0].name}`
					: `Deliver to ${data.matching.length} integrations`
				: null
	);

	// Delete dialog: one line of what goes and what stays
	const sentTargets = $derived([
		...new Set(data.deliveries.filter((d) => d.status === 'sent' && d.target).map((d) => d.target!))
	]);
	const deleteLine = $derived(
		[
			rec.hasAudio
				? `Audio (${[ext, formatBytes(rec.audioBytes)].filter(Boolean).join(', ')}) and transcript go.`
				: 'Transcript goes.',
			sentTargets.length === 1
				? `${sentTargets[0]} keeps its entry.`
				: sentTargets.length > 1
					? `${sentTargets.join(', ')} keep their entries.`
					: ''
		]
			.filter(Boolean)
			.join(' ')
	);

	let pending = $state<string | null>(null);
	const submit = (key: string) => () => {
		pending = key;
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			pending = null;
		};
	};

	const lineCount = (text: string) => text.split('\n').length;
	// Why the header buttons wait: the run in flight
	const busyTitle = $derived(busy ? `Still ${statusLabel(rec.status).toLowerCase()}` : undefined);
</script>

<nav class="crumbs" aria-label="Breadcrumb">
	<a href={resolve('/(app)')}><Icon name="arrow-left" />Recordings</a>
</nav>

<PageHead title={formatDateTime(rec.recordedAt, tz, { seconds: true })}>
	{#snippet sub()}
		<span class="hk-mono">{rec.deliveryId}</span>
	{/snippet}
	{#snippet actions()}
		{#if hasTranscript && deliverLabel}
			<form method="POST" action="?/route" use:enhance={submit('route')}>
				<button
					class="hk-btn-secondary"
					disabled={busy || !!pending}
					title={busyTitle}
					aria-busy={pending === 'route'}
				>
					{pending === 'route' ? 'Delivering…' : deliverLabel}
				</button>
			</form>
		{/if}
		{#if rec.hasAudio || rec.appTranscript}
			<form method="POST" action="?/transcribe" use:enhance={submit('transcribe')}>
				<button
					class="hk-btn-secondary"
					disabled={busy || !!pending}
					title={busyTitle}
					aria-busy={pending === 'transcribe'}
				>
					{pending === 'transcribe' ? 'Queuing…' : 'Transcribe again'}
				</button>
			</form>
		{/if}
		<ConfirmAction
			action="?/delete"
			label="Delete"
			title="Delete {formatDateTime(rec.recordedAt, tz)}"
			confirmLabel="Delete"
		>
			<p>{deleteLine}</p>
		</ConfirmAction>
	{/snippet}
</PageHead>

{#if form && 'error' in form && form.error}
	<p class="hk-banner hk-banner--err" role="alert">{form.error}</p>
{/if}
{#if st.other}
	<p class="hk-banner hk-banner--err" role="status">{st.other}</p>
{/if}

<dl class="facts">
	<div>
		<dt>Status</dt>
		<dd class="status">
			{#if rec.status === 'failed' && failedDeliveries > 0}
				<a href="#deliveries"
					><Signal
						tone="err"
						label="{failedDeliveries} {failedDeliveries === 1 ? 'delivery' : 'deliveries'} failed"
					/></a
				>
			{:else if st.retry}
				<!-- No space before the separator, so a long error wraps after it, never before -->
				<StatusDot status={rec.status} attempt={st.retry.attempt} />{#if st.retry.lastError}<span
						class="muted">&nbsp;· {st.retry.lastError}</span
					>{/if}
			{:else}
				<StatusDot status={rec.status} />
			{/if}
		</dd>
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
				{#each rec.languages as c, i (c)}{i ? ', ' : ''}<span title={c}>{languageName(c)}</span
					>{/each}
			</dd>
		</div>
	{/if}
	{#if rec.transcribedBy}
		<div>
			<dt>Transcribed by</dt>
			<dd>
				{#if rec.transcribedBy === 'index-app'}
					Phone app
					{#if st.fallbackReason}<span class="muted">· {st.fallbackReason}</span>{/if}
				{:else}
					<span class="hk-mono">{rec.transcribedBy}</span>
					{#if rec.transcribeMs != null}<span class="muted"
							>· {formatElapsed(rec.transcribeMs)}</span
						>{/if}
				{/if}
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
	{#if data.userAgent}
		<div>
			<dt>Client</dt>
			<dd class="muted ua" title={data.userAgent}>{data.userAgent}</dd>
		</div>
	{/if}
	{#if rec.hasAudio}
		<div>
			<dt>Audio</dt>
			<dd class="hk-num">{[ext, formatBytes(rec.audioBytes)].filter(Boolean).join(' · ')}</dd>
		</div>
	{/if}
	{#if rec.attempts > 1 && !busy}
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
	{#if st.slot.kind === 'text'}
		<p class="transcript">{rec.transcript}</p>
	{:else if st.slot.kind === 'pending'}
		<div class="skeleton" aria-hidden="true">
			<span class="hk-skeleton" style:width="92%"></span>
			<span class="hk-skeleton" style:width="78%"></span>
			<span class="hk-skeleton" style:width="40%"></span>
		</div>
	{:else if st.slot.kind === 'error'}
		<div class="hk-empty-row err"><span>{st.slot.text}</span></div>
	{:else}
		<div class="hk-empty-row"><span>No speech</span></div>
	{/if}

	{#if rec.appTranscript}
		<details class="app">
			<summary>Phone transcript</summary>
			<p class="transcript small">{rec.appTranscript}</p>
		</details>
	{/if}
</section>

{#if hasTranscript}
	<section id="deliveries">
		<div class="sec-head">
			<h2>Deliveries</h2>
		</div>
		{#if data.deliveries.length === 0}
			<div class="hk-empty-row">
				{#if data.matching.length}
					<span>No deliveries yet.</span>
				{:else}
					<span>No integration takes {triggerLabel(rec.trigger).toLowerCase() || 'this'}.</span>
					<a class="hk-link" href={resolve('/(app)/integrations')}>Integrations</a>
				{/if}
			</div>
		{:else}
			<div class="tbl" role="region" aria-label="Deliveries" tabindex="-1">
				<table class="hk-table">
					<thead>
						<tr>
							<th>Integration</th>
							<th>Status</th>
							<th>Target</th>
							<th>Error</th>
							<th><span class="hk-sr">Action</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.deliveries as d (d.id)}
							<tr>
								<td data-label="Integration">
									<a
										class="name"
										href={resolve('/(app)/integrations/[id]', { id: d.integrationId })}>{d.name}</a
									>
								</td>
								<td data-label="Status">
									<span class="cell-status">
										{#if d.status === 'failed'}
											<span class="hk-badge hk-badge--err">Failed</span>
										{:else if d.status === 'pending'}
											<Signal
												tone={d.error ? 'warn' : 'busy'}
												label={d.error ? 'Retrying' : 'Pending'}
											/>
										{:else if d.status === 'sent'}
											Sent
											{#if d.stale}<span class="hk-badge hk-badge--warn">Stale</span>{/if}
										{:else}
											Skipped
										{/if}
										{#if d.attempts > 1}<span class="muted hk-num">× {d.attempts}</span>{/if}
									</span>
								</td>
								<td data-label="Target" class="hk-mono target">{d.target ?? ''}</td>
								<td data-label="Error" class="error" class:soft={d.status !== 'failed'}
									>{d.error ? cleanError(d.error) : ''}</td
								>
								<td class="act">
									{#if (d.status === 'failed' || d.status === 'skipped') && d.deliverable}
										<form method="POST" action="?/redeliver" use:enhance={submit(d.id)}>
											<input type="hidden" name="delivery" value={d.id} />
											<button
												class="hk-btn-secondary hk-btn-sm"
												disabled={busy || !!pending}
												aria-busy={pending === d.id}
											>
												{pending === d.id
													? d.status === 'skipped'
														? 'Delivering…'
														: 'Retrying…'
													: d.status === 'skipped'
														? 'Deliver'
														: 'Retry'}
											</button>
										</form>
									{:else if d.status === 'sent' && d.stale}
										<ConfirmAction
											action="?/redeliver"
											fields={{ delivery: d.id }}
											label="Send corrected transcript"
											title="Add a second entry"
											confirmLabel="Append"
											triggerClass="hk-btn-secondary hk-btn-sm"
											confirmClass="hk-btn"
											size="md"
											disabled={busy || !!pending}
										>
											<div class="confirm">
												{#if d.preview}
													<NotePreview
														path={d.target ?? d.name}
														body={d.preview.body}
														entryLines={[d.preview.from, lineCount(d.preview.body)]}
													/>
												{/if}
											</div>
										</ConfirmAction>
									{:else if d.status === 'sent'}
										<form method="POST" action="?/redeliver" use:enhance={submit(d.id)}>
											<input type="hidden" name="delivery" value={d.id} />
											<button
												class="hk-btn-secondary hk-btn-sm"
												disabled={busy || !!pending}
												aria-busy={pending === d.id}
											>
												{pending === d.id ? 'Sending…' : 'Send again'}
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
{/if}

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
	.ua {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
	/* Inline flow, so a long retry error wraps word by word after the dot and label */
	.status :global(.signal) {
		vertical-align: top;
	}
	.status a {
		text-decoration: none;
	}
	.status a:hover {
		color: var(--hk-text);
	}
	.skeleton {
		display: grid;
		gap: 0.6rem;
		max-width: 42rem;
		padding-block: 0.45rem;
	}
	.skeleton .hk-skeleton {
		height: 1rem;
	}
	.hk-empty-row.err {
		color: var(--hk-err);
		overflow-wrap: anywhere;
	}
	.cell-status {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		white-space: nowrap;
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
	/* The modal renders inside the nowrap action cell */
	.confirm {
		white-space: normal;
		text-align: left;
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
		.hk-table td:is([data-label='Target'])::before {
			content: attr(data-label) ' ';
			font-family: var(--hk-font-sans);
			color: var(--hk-text-3);
		}
	}
</style>
