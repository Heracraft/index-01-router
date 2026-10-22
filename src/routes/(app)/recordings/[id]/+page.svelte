<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import ConfirmAction from '#lib/components/ConfirmAction.svelte';
	import CopyButton from '#lib/components/CopyButton.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import NotePreview from '#lib/components/NotePreview.svelte';
	import Player from '#lib/components/Player.svelte';
	import Rail from '#lib/components/Rail.svelte';
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
		languageName,
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
	// Audio the transcriber could not decode plays nothing either: no player for it
	const unreadable = $derived(
		st.kind === 'failed' && st.step === 'transcribe' && st.fix.action === 'delete'
	);
	const failedDeliveries = $derived(data.deliveries.filter((d) => d.status === 'failed'));

	// The day this recording sits in: the back link names it, the title is the time alone
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
	/** Today, Yesterday, or Tue, Oct 20 */
	const dayShort = $derived(rel ?? relShort);
	const langs = $derived(rec.languages.map((l) => languageName(l)).join(', '));

	// Problem block: the cause, one fact line and one action
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

	// Details opens for a failure, and otherwise stays as you left it across live reloads
	let detOpen = $state(false);
	let detFor = '';
	$effect.pre(() => {
		const k = `${rec.id}:${st.kind === 'failed'}`;
		if (k === detFor) return;
		detFor = k;
		detOpen = st.kind === 'failed';
	});

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
	/** 19:50, with the day when it is not the recording's own */
	const sentAt = (at: Date | string) =>
		dayKey(at, tz) === data.day ? formatTime(at, tz) : formatDateTime(at, tz);
	const sentLine = (d: (typeof data.deliveries)[number]) =>
		[
			d.status === 'sent'
				? `Sent ${sentAt(d.updatedAt)}`
				: d.status === 'failed'
					? 'Failed'
					: d.status === 'pending'
						? 'Sending'
						: 'Skipped',
			d.attempts > 1 ? `${d.attempts} tries` : ''
		]
			.filter(Boolean)
			.join(' · ');
	const engine = $derived(
		rec.transcribedBy && rec.transcribedBy !== 'index-app'
			? [
					rec.transcribedBy.replace(/^[a-z-]+:/, ''),
					rec.transcribeMs != null ? `in ${formatElapsed(rec.transcribeMs)}` : ''
				]
					.filter(Boolean)
					.join(' ')
			: ''
	);
	const liveLabel = $derived(
		st.kind === 'waiting'
			? 'Waiting'
			: st.kind === 'transcribing'
				? `Transcribing${rec.attempts > 1 ? `, attempt ${rec.attempts}` : ''}`
				: 'Sending to the note'
	);
	const lineCount = (text: string) => text.split('\n').length;
	/** This recording's own line in the note: printed in full above, so two lines here at most,
	   cut at a word with no stop before the ellipsis */
	const short = (text: string, max = 150) => {
		if (text.length <= max) return text;
		const cut = text.slice(0, max).replace(/\s+\S*$/, '');
		return `${cut.replace(/[\s.,;:!?]+$/, '')}…`;
	};
	const sectionTitle = (c: (typeof data.contexts)[number]) =>
		data.contexts.length > 1
			? c.name
			: c.sent
				? 'In the note'
				: busy
					? 'Going to the note'
					: 'Not in the note';
	const formError = $derived(form && 'error' in form && form.error ? form.error : null);
</script>

<svelte:head>
	<title>{formatTime(rec.recordedAt, tz)}, {relShort} · Index 01</title>
</svelte:head>

<div class="shell">
	<Rail
		day={data.day}
		today={data.rail.today}
		calendar={data.rail.calendar}
		needs={data.rail.needs}
	/>
	<main id="main" class="col" tabindex="-1">
		<div class="rechead">
			<a
				class="hk-btn-ghost iconbtn back"
				href={data.day === today
					? resolve('/(app)')
					: resolve('/(app)/day/[date]', { date: data.day })}
				aria-label={dayName}
				title={dayName}><Icon name="left" size={18} /></a
			>
			<h1 class="hk-h1-app">{dayShort} · {formatTime(rec.recordedAt, tz)}</h1>
			<p class="rec-m">
				{#if rec.durationMs != null}<span>{formatDuration(rec.durationMs)}</span>{/if}
				{#if rec.trigger !== 'single-click-hold'}<span>{triggerLabel(rec.trigger)}</span>{/if}
				{#if langs}<span>{langs}</span>{/if}
			</p>
		</div>

		{#if formError}
			<p class="hk-banner hk-banner--err" role="alert">{formError}</p>
		{/if}

		{#if st.kind === 'failed'}
			<section class="issue" aria-label="Problem">
				<span class="fdot" aria-hidden="true"></span>
				<p class="issue-t">
					<span class="issue-c">{st.cause}</span>
					{#if fact}<span class="issue-f">{fact}</span>{/if}
				</p>
				{#if st.fix.action === 'delete'}
					<ConfirmAction
						action="?/delete"
						label="Delete"
						title="Delete the {formatTime(rec.recordedAt, tz)} recording"
						triggerClass="hk-btn-secondary hk-btn-sm"
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
						<button class="hk-btn hk-btn-sm" disabled={!!pending} aria-busy={pending === 'fix'}>
							<Icon name="retry" size={14} />{pending === 'fix' ? 'Retrying…' : 'Retry'}
						</button>
					</form>
				{/if}
			</section>
		{/if}

		{#if rec.hasAudio && !unreadable}
			<Player id={rec.id} durationMs={rec.durationMs} />
		{/if}

		<section class="transcript" aria-label="Transcript">
			{#if st.kind === 'waiting' || st.kind === 'transcribing' || st.kind === 'sending'}
				<div class="e-s live" role="status">
					<span class={st.kind === 'waiting' ? 'idle' : 'spin'} aria-hidden="true"></span>
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
			<!-- Sent: the note's path is enough, the words are above. Not sent: where it would land -->
			{@const alone = c.sent}
			<section class="sec" aria-label={sectionTitle(c)}>
				<h2 class="sec-h">{sectionTitle(c)}</h2>
				<article class="sheet sheet--sm">
					<div class="sheet-bar" class:sheet-bar--only={alone}>
						<span class="path-s">
							{#if c.sent}
								<Icon name="check" size={14} class="ok-check" /><span class="hk-sr">Written to</span
								>
							{:else if busy}
								<span class="spin" aria-hidden="true"></span><span class="hk-sr">Writing to</span>
							{:else}
								<span class="hk-sr">Not written to</span>
							{/if}
							<span class="path"
								>{c.path ?? c.name}<span class="path-h">{` › ${c.heading}`}</span></span
							>
						</span>
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- obsidian:// opens the vault app -->
						{#if c.link}<a class="hk-link open" href={c.link}
								>Open in Obsidian <Icon name="external" size={14} /></a
							>{/if}
					</div>
					{#if !alone}<div class="sheet-body">
							<ul class="notes">
								{#each c.lines as l, i (i)}
									<li
										class="e"
										class:e--typed={!l.mark}
										class:e--this={l.mark === 'this'}
										class:e--pending={l.mark === 'pending'}
									>
										<span class="e-t">{l.time ?? ''}</span>
										<div class="e-b">
											<p class="e-x" class:clamp2={!!l.mark}>
												{#if l.task !== null}<span class="task" class:on={l.task}
													></span>{/if}{l.mark ? short(l.text) : l.text}
											</p>
										</div>
									</li>
								{/each}
							</ul>
						</div>{/if}
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

		<details class="det" bind:open={detOpen}>
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
							Phone app{#if desc.fallbackReason}<span class="muted"
									>{` · ${desc.fallbackReason}`}</span
								>{/if}
						{:else}
							{engine}
						{/if}
					</dd>
				{/if}
				{#if rec.attempts > 1}
					<dt>Attempts</dt>
					<dd>{rec.attempts}</dd>
				{/if}
				{#each data.deliveries as d (d.id)}
					<dt>{d.name}</dt>
					<dd class="dd-row">
						<span>{sentLine(d)}</span>
						{#if d.status === 'sent'}
							<form class="inline" method="POST" action="?/redeliver" use:enhance={submit(d.id)}>
								<input type="hidden" name="delivery" value={d.id} />
								<button class="linkbtn" disabled={busy || !!pending}
									>{pending === d.id ? 'Sending…' : 'Send again'}</button
								>
							</form>
						{/if}
					</dd>
				{/each}
				{#if st.kind === 'failed' && st.raw}
					<dt>Error</dt>
					<dd class="mono">{st.raw}</dd>
				{/if}
				{#if desc.other && st.kind !== 'failed'}
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
	.issue form {
		display: contents;
	}
	.dd-row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 0.75rem;
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
	.sheet-bar--only {
		border-bottom: 0;
	}
	@media (max-width: 639.98px) {
		.tacts :global(:is(.hk-btn-ghost, .copy.copy--labelled)) {
			height: 2.75rem;
		}
	}
	/* Edit, Copy and Share: one height, one icon size, one gap */
	.tacts :global(:is(.hk-btn-ghost, .copy.copy--labelled)) {
		height: 1.875rem;
		padding: 0 0.625rem;
		gap: 0.375rem;
		font-size: 0.8125rem;
		font-weight: 500;
	}
	.tacts :global(.copy.copy--labelled) {
		background: transparent;
		border-color: transparent;
		color: var(--hk-text-2);
	}
	.tacts :global(.copy .ic) {
		width: 14px;
		height: 14px;
	}
	.tacts :global(.copy.copy--labelled:hover) {
		background: var(--hk-hover);
		color: var(--hk-text);
	}
</style>
