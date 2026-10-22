<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import ConfirmAction from '#lib/components/ConfirmAction.svelte';
	import CopyButton from '#lib/components/CopyButton.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import NotePreview from '#lib/components/NotePreview.svelte';
	import Player from '#lib/components/Player.svelte';
	import { longDay, relativeDay } from '#lib/components/days.ts';
	import { entryState } from '#lib/entry.ts';
	import { describeRecording } from '#lib/recording-state.ts';
	import {
		dayKey,
		formatBytes,
		formatDateTime,
		formatDuration,
		formatElapsed,
		formatTime,
		isPending,
		triggerLabel
	} from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const rec = $derived(data.recording);
	const tz = $derived(data.timezone);
	const today = $derived(dayKey(new Date(), tz));
	const rel = $derived(relativeDay(data.day, today));
	const busy = $derived(isPending(rec.status));
	const st = $derived(entryState(data.entry));
	const desc = $derived(describeRecording(rec));
	const ext = $derived(rec.audioMime?.split('/')[1]?.split(';')[0]?.replace(/^x-/, '') ?? '');
	const hasTranscript = $derived(!!rec.transcript?.trim());
	const failedDeliveries = $derived(data.deliveries.filter((d) => d.status === 'failed'));

	// The day this recording sits in, as the back link and the title's muted part
	const dayName = $derived(rel ?? longDay(data.day));
	const relShort = $derived(
		rel
			? rel.toLowerCase()
			: new Date(`${data.day}T12:00:00Z`).toLocaleDateString('en-US', {
					weekday: 'short',
					month: 'short',
					day: 'numeric',
					timeZone: 'UTC'
				})
	);

	// Problem block: one fact line and one action
	const fact = $derived.by(() => {
		if (st.kind !== 'failed') return '';
		if (st.step === 'deliver') {
			const d = failedDeliveries[0];
			if (!d) return '';
			const tries = d.attempts === 1 ? '1 try' : `${d.attempts} tries`;
			return `${tries}, last at ${formatTime(d.updatedAt, tz)}`;
		}
		const tries = rec.attempts === 1 ? '1 try' : `${rec.attempts} tries`;
		return `${tries}, last at ${formatTime(rec.updatedAt, tz)}`;
	});
	const fixLabel = $derived(
		st.kind !== 'failed'
			? ''
			: st.fix.action === 'transcribe'
				? 'Transcribe again'
				: st.fix.action === 'delete'
					? 'Delete recording'
					: failedDeliveries.length === 1 && failedDeliveries[0]?.name
						? `Send to ${failedDeliveries[0].name.toLowerCase()}`
						: 'Send again'
	);
	// Pipeline track, shown only when something failed
	const track = $derived.by(() => {
		if (st.kind !== 'failed') return null;
		const transcribeFailed = st.step === 'transcribe';
		const d = failedDeliveries[0];
		return [
			{ label: 'Received', state: 'ok', at: formatTime(rec.receivedAt, tz) },
			transcribeFailed
				? { label: 'Transcribed', state: 'bad', at: `Failed ${formatTime(rec.updatedAt, tz)}` }
				: {
						label: 'Transcribed',
						state: 'ok',
						at: rec.transcribeMs != null ? `in ${formatElapsed(rec.transcribeMs)}` : 'Done'
					},
			transcribeFailed
				? { label: 'Written', state: 'no', at: 'Not reached' }
				: {
						label: 'Written',
						state: 'bad',
						at: d ? `Failed ${formatTime(d.updatedAt, tz)}` : 'Failed'
					}
		];
	});

	const deleteLine = $derived.by(() => {
		const sent = [
			...new Set(
				data.deliveries.filter((d) => d.status === 'sent' && d.target).map((d) => d.target!)
			)
		];
		return [
			rec.hasAudio
				? `Audio (${[ext, formatBytes(rec.audioBytes)].filter(Boolean).join(', ')}) and transcript go.`
				: 'Transcript goes.',
			sent.length === 1
				? `${sent[0]} keeps its entry.`
				: sent.length > 1
					? `${sent.join(', ')} keep their entries.`
					: ''
		]
			.filter(Boolean)
			.join(' ');
	});

	let pending = $state<string | null>(null);
	const submit = (key: string) => () => {
		pending = key;
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			pending = null;
			if (key === 'edit') editing = false;
		};
	};

	let editing = $state(false);
	let draft = $state('');
	const canShare = typeof navigator !== 'undefined' && 'share' in navigator;
	async function share() {
		try {
			await navigator.share({ text: rec.transcript ?? '' });
		} catch {
			// cancelled
		}
	}
	const liveLabel = $derived(
		st.kind === 'waiting'
			? 'Waiting'
			: st.kind === 'transcribing'
				? `Transcribing${rec.attempts > 1 ? `, attempt ${rec.attempts}` : ''}`
				: 'Sending to the note'
	);
	const lineCount = (text: string) => text.split('\n').length;
	const formError = $derived(form && 'error' in form && form.error ? form.error : null);
</script>

<svelte:head>
	<title>{formatTime(rec.recordedAt, tz)}, {relShort} · Index 01</title>
</svelte:head>

<div class="shell shell--one">
	<main id="main" class="col" tabindex="-1">
		<a
			class="back"
			href={data.day === today
				? resolve('/(app)')
				: resolve('/(app)/day/[date]', { date: data.day })}><Icon name="left" />{dayName}</a
		>
		<div class="rechead">
			<h1 class="hk-h1-app">
				{formatTime(rec.recordedAt, tz)}<span class="rel">, {relShort}</span>
			</h1>
			<p class="rec-m">
				{#if rec.durationMs != null}<span>{formatDuration(rec.durationMs)}</span>{/if}
				{#if rec.trigger !== 'single-click-hold'}<span>{triggerLabel(rec.trigger)}</span>{/if}
				{#if rec.languages.length}<span>{rec.languages.join(' · ')}</span>{/if}
			</p>
		</div>

		{#if formError}
			<p class="hk-banner hk-banner--err" role="alert">{formError}</p>
		{/if}

		{#if st.kind === 'failed'}
			<section class="problem" aria-label="Problem">
				<p class="problem-c">{st.cause}</p>
				{#if fact}<p class="problem-f">{fact}</p>{/if}
				{#if track}
					<ol class="track" aria-label="Steps">
						{#each track as t (t.label)}
							<li class={t.state}><b>{t.label}</b><span>{t.at}</span></li>
						{/each}
					</ol>
				{/if}
				{#if st.raw}<p class="fail-raw">{st.raw}</p>{/if}
				<div class="problem-a">
					{#if st.fix.action === 'delete'}
						<ConfirmAction
							action="?/delete"
							label={fixLabel}
							title="Delete the {formatTime(rec.recordedAt, tz)} recording"
							triggerClass="hk-btn-danger"
						>
							<p>{deleteLine}</p>
						</ConfirmAction>
					{:else}
						<form method="POST" action="?/{st.fix.action}" use:enhance={submit('fix')}>
							{#if st.fix.delivery}<input
									type="hidden"
									name="delivery"
									value={st.fix.delivery}
								/>{/if}
							<button class="hk-btn" disabled={!!pending} aria-busy={pending === 'fix'}>
								{pending === 'fix' ? 'Working…' : fixLabel}
							</button>
						</form>
					{/if}
				</div>
			</section>
		{/if}

		{#if rec.hasAudio}
			<Player id={rec.id} durationMs={rec.durationMs} />
		{/if}

		<section class="transcript" aria-label="Transcript">
			{#if st.kind === 'waiting' || st.kind === 'transcribing' || st.kind === 'sending'}
				<div class="e-s live" role="status">
					<span class={st.kind === 'waiting' ? 'idle' : 'busy'} aria-hidden="true"></span>
					{liveLabel}
				</div>
			{/if}
			{#if editing}
				<form method="POST" action="?/edit" use:enhance={submit('edit')}>
					<textarea
						class="hk-textarea edit"
						name="transcript"
						rows={Math.min(14, Math.max(4, lineCount(draft) + Math.ceil(draft.length / 60)))}
						bind:value={draft}
						aria-label="Transcript"></textarea>
					<div class="tacts tacts--edit">
						<button class="hk-btn hk-btn-sm" disabled={pending === 'edit' || !draft.trim()}
							>{pending === 'edit' ? 'Saving…' : 'Save'}</button
						>
						<button type="button" class="hk-btn-ghost hk-btn-sm" onclick={() => (editing = false)}
							>Cancel</button
						>
					</div>
				</form>
			{:else if desc.slot.kind === 'text'}
				<p>{rec.transcript}</p>
				<div class="tacts">
					{#if !busy}
						<button
							type="button"
							class="hk-btn-ghost hk-btn-sm"
							onclick={() => {
								draft = rec.transcript ?? '';
								editing = true;
							}}><Icon name="edit" size={14} />Edit</button
						>
					{/if}
					<CopyButton text={rec.transcript ?? ''} label="Copy" />
					{#if canShare}
						<button type="button" class="hk-btn-ghost hk-btn-sm" onclick={share}
							><Icon name="share" size={14} />Share</button
						>
					{/if}
				</div>
			{:else if desc.slot.kind === 'pending'}
				<div class="skeleton" aria-label="Transcribing">
					<span class="hk-skeleton" style:width="92%"></span>
					<span class="hk-skeleton" style:width="78%"></span>
					<span class="hk-skeleton" style:width="40%"></span>
				</div>
			{:else if desc.slot.kind === 'no-speech'}
				<p class="none">No speech</p>
			{/if}
			{#if rec.appTranscript}
				<details class="app">
					<summary>Phone transcript</summary>
					<p class="small">{rec.appTranscript}</p>
				</details>
			{/if}
		</section>

		{#each hasTranscript ? data.contexts : [] as c (c.integrationId)}
			<section class="sec" aria-label="In the note">
				<div class="sec-hrow">
					<h2 class="sec-h">{data.contexts.length > 1 ? c.name : 'In the note'}</h2>
				</div>
				{#if c.path}
					<p class="statusline">
						{#if c.sent}
							<Icon name="check" class="ok-check" />In <span class="hk-mono">{c.path}</span>
						{:else if busy}
							<span class="busy" aria-hidden="true"></span>Not in
							<span class="hk-mono">{c.path}</span> yet
						{:else}
							<span class="ring-warn" aria-hidden="true"></span>Not written to
							<span class="hk-mono">{c.path}</span> yet
						{/if}
					</p>
				{/if}
				<article class="sheet sheet--sm">
					{#if c.path}
						<div class="sheet-bar">
							<span class="path">{c.path}</span>
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- obsidian:// opens the vault app -->
							{#if c.link}<a class="hk-link open" href={c.link}
									>Open in Obsidian <Icon name="external" size={14} /></a
								>{/if}
						</div>
					{/if}
					<div class="sheet-body">
						<h3 class="nh">{c.heading}</h3>
						<ul class="notes">
							{#if c.before}<li class="ctx-gap" aria-hidden="true">…</li>{/if}
							{#each c.lines as l, i (i)}
								<li
									class="e"
									class:e--typed={!l.mark}
									class:e--this={l.mark === 'this'}
									class:e--pending={l.mark === 'pending'}
								>
									<span class="e-t">{l.time ?? ''}</span>
									<div class="e-b">
										<p class="e-x">
											{#if l.task !== null}<span class="task" class:on={l.task}></span>{/if}{l.text}
										</p>
									</div>
								</li>
							{/each}
							{#if c.after}<li class="ctx-gap" aria-hidden="true">…</li>{/if}
						</ul>
					</div>
				</article>
				{#each data.deliveries.filter((d) => d.integrationId === c.integrationId) as d (d.id)}
					{#if d.status === 'sent' && d.stale}
						<div class="resend">
							<span>Edited after it was sent</span>
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
								{#if d.preview}
									<NotePreview
										path={d.target ?? d.name}
										body={d.preview.body}
										entryLines={[d.preview.from, lineCount(d.preview.body)]}
									/>
								{/if}
							</ConfirmAction>
						</div>
					{:else if d.status === 'skipped' && d.deliverable}
						<div class="resend">
							<span>Skipped: {d.error}</span>
							<form method="POST" action="?/redeliver" use:enhance={submit(d.id)}>
								<input type="hidden" name="delivery" value={d.id} />
								<button class="hk-btn-secondary hk-btn-sm" disabled={busy || !!pending}
									>{pending === d.id ? 'Sending…' : 'Send'}</button
								>
							</form>
						</div>
					{/if}
				{/each}
			</section>
		{/each}
		{#if hasTranscript && data.contexts.length === 0}
			<section class="sec">
				<h2 class="sec-h">In the note</h2>
				<p class="statusline">
					<span class="ring-warn" aria-hidden="true"></span>No daily note takes
					{triggerLabel(rec.trigger).toLowerCase()}
					<a class="hk-link" href="{resolve('/(app)/settings')}#note">Settings</a>
				</p>
			</section>
		{/if}

		<details class="det">
			<summary>Details <Icon name="chevron" /></summary>
			<dl>
				<dt>Received</dt>
				<dd>
					{formatDateTime(rec.receivedAt, tz, { seconds: true })}
					· {rec.source === 'upload' ? 'upload' : rec.signed ? 'signed' : 'unsigned'}
				</dd>
				{#if data.userAgent}
					<dt>Ring</dt>
					<dd>{data.userAgent}</dd>
				{/if}
				{#if rec.hasAudio}
					<dt>Audio</dt>
					<dd>{[ext, formatBytes(rec.audioBytes)].filter(Boolean).join(' · ')}</dd>
				{/if}
				{#if rec.transcribedBy}
					<dt>Transcribed</dt>
					<dd>
						{#if rec.transcribedBy === 'index-app'}
							Phone app{#if desc.fallbackReason}<span class="muted">
									· {desc.fallbackReason}</span
								>{/if}
						{:else}
							{rec.transcribedBy.replace(/^[a-z-]+:/, '')}{#if rec.transcribeMs != null}
								in {formatElapsed(rec.transcribeMs)}{/if}
						{/if}
					</dd>
				{/if}
				{#if rec.attempts > 1}
					<dt>Attempts</dt>
					<dd>{rec.attempts}</dd>
				{/if}
				{#each data.deliveries as d (d.id)}
					<dt>{d.name}</dt>
					<dd>
						{d.status === 'sent'
							? `Sent ${formatTime(d.updatedAt, tz)}`
							: d.status === 'failed'
								? 'Failed'
								: d.status === 'pending'
									? 'Sending'
									: 'Skipped'}{d.attempts > 1
							? ` · ${d.attempts} tries`
							: ''}{#if d.status === 'sent'}
							<span class="muted">
								·
								<form class="inline" method="POST" action="?/redeliver" use:enhance={submit(d.id)}>
									<input type="hidden" name="delivery" value={d.id} />
									<button class="linkbtn" disabled={busy || !!pending}
										>{pending === d.id ? 'Sending…' : 'Send again'}</button
									>
								</form></span
							>{/if}
					</dd>
				{/each}
				{#if desc.other}
					<dt>Error</dt>
					<dd>{desc.other}</dd>
				{/if}
				<dt>Delivery ID</dt>
				<dd class="mono">{rec.deliveryId}</dd>
			</dl>
			<div class="det-a">
				{#if rec.hasAudio || rec.appTranscript}
					<form method="POST" action="?/transcribe" use:enhance={submit('transcribe')}>
						<button
							class="hk-btn-secondary hk-btn-sm"
							disabled={busy || !!pending}
							aria-busy={pending === 'transcribe'}
						>
							{pending === 'transcribe' ? 'Queuing…' : 'Transcribe again'}
						</button>
					</form>
				{/if}
				{#if hasTranscript && data.deliveries.length === 0 && data.matching.length}
					<form method="POST" action="?/route" use:enhance={submit('route')}>
						<button class="hk-btn-secondary hk-btn-sm" disabled={busy || !!pending}
							>{pending === 'route'
								? 'Sending…'
								: `Send to ${data.matching[0]?.name.toLowerCase()}`}</button
						>
					</form>
				{/if}
				<ConfirmAction
					action="?/delete"
					label="Delete recording"
					title="Delete the {formatTime(rec.recordedAt, tz)} recording"
					confirmLabel="Delete"
					triggerClass="hk-btn-secondary hk-btn-sm danger"
				>
					<p>{deleteLine}</p>
				</ConfirmAction>
			</div>
		</details>
	</main>
</div>

<style>
	.live {
		margin-bottom: 0.75rem;
	}
	.skeleton {
		display: grid;
		gap: 0.75rem;
		padding-block: 0.6rem;
	}
	.skeleton .hk-skeleton {
		height: 1.1rem;
	}
	.edit {
		font-size: 1.0625rem;
		line-height: 1.7;
	}
	.tacts--edit {
		margin-left: 0;
	}
	.app {
		margin-top: 1.5rem;
	}
	.app summary {
		font-size: 0.875rem;
		color: var(--hk-text-3);
		cursor: pointer;
	}
	.app .small {
		margin-top: 0.5rem;
		font-size: 0.9375rem;
		color: var(--hk-text-2);
	}
	.problem form {
		display: block;
	}
	.problem-a :global(.hk-btn-danger) {
		width: 100%;
		justify-content: center;
		height: 2.75rem;
	}
	.inline {
		display: inline;
	}
	.det-a :global(.danger) {
		color: var(--hk-err);
	}
	.resend form {
		display: contents;
	}
	@media (max-width: 639.98px) {
		.tacts :global(.copy.copy--labelled) {
			height: 2.75rem !important;
		}
	}
	.tacts :global(.copy.copy--labelled) {
		background: transparent;
		height: 1.75rem;
		padding: 0 0.625rem;
		border-color: transparent;
		color: var(--hk-text-2);
		font-size: 0.8125rem;
	}
	.tacts :global(.copy.copy--labelled:hover) {
		background: var(--hk-hover);
		color: var(--hk-text);
	}
</style>
