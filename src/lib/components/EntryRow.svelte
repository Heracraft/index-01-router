<script lang="ts">
	import { resolve } from '$app/paths';
	/* One line of the day sheet: a recording in whatever state it is. A line that landed shows
	   only its time, text and play pill */
	import { enhance } from '$app/forms';
	import ConfirmAction from './ConfirmAction.svelte';
	import Icon from './Icon.svelte';
	import PlayPill from './PlayPill.svelte';
	import Waveform from './Waveform.svelte';
	import { audio } from './audio.svelte.ts';
	import { entryMeta, entryState, type EntryRec } from '#lib/entry.ts';
	import { formatDuration, formatTime } from '#lib/format.ts';

	interface Props {
		rec: EntryRec;
		tz: string;
		/** Text to mark, for search hits */
		mark?: string;
	}
	let { rec, tz, mark = '' }: Props = $props();

	const st = $derived(entryState(rec));
	const meta = $derived(entryMeta(rec));
	const href = $derived(resolve('/(app)/recordings/[id]', { id: rec.id }));
	const time = $derived(formatTime(rec.recordedAt, tz));
	const showProgress = $derived(audio.id === rec.id && (audio.playing || audio.time > 0));

	let open = $state(false);
	let over = $state(false);
	let pending = $state(false);

	/** Shows More only when the clamp hides something */
	function clamp(node: HTMLElement) {
		const check = () => {
			if (!open) over = node.scrollHeight > node.clientHeight + 2;
		};
		const ro = new ResizeObserver(check);
		ro.observe(node);
		check();
		return { destroy: () => ro.disconnect() };
	}

	const parts = (text: string) => {
		const q = mark.trim();
		if (!q) return [{ t: text, m: false }];
		const out: { t: string; m: boolean }[] = [];
		const lower = text.toLowerCase();
		const ql = q.toLowerCase();
		let i = 0;
		for (;;) {
			const at = lower.indexOf(ql, i);
			if (at < 0) break;
			if (at > i) out.push({ t: text.slice(i, at), m: false });
			out.push({ t: text.slice(at, at + q.length), m: true });
			i = at + q.length;
		}
		if (i < text.length) out.push({ t: text.slice(i), m: false });
		return out;
	};
</script>

{#snippet text(t: string)}
	<p class="e-x" class:clamped={!open} use:clamp>
		{#each parts(t) as p, i (i)}{#if p.m}<mark>{p.t}</mark>{:else}{p.t}{/if}{/each}
	</p>
	{#if over || open}
		<button type="button" class="e-more" onclick={() => (open = !open)}
			>{open ? 'Less' : 'More'}</button
		>
	{/if}
{/snippet}

{#snippet progress()}
	{#if showProgress}
		<div class="iprog">
			<Waveform id={rec.id} durationMs={rec.durationMs} bars={64} class="iwave" height={16} />
			<span class="itime">{formatDuration(audio.time * 1000)}</span>
		</div>
	{/if}
{/snippet}

<li
	class="e"
	class:e--fail={st.kind === 'failed'}
	class:e--muted={st.kind === 'sending' || st.kind === 'nospeech'}
	data-id={rec.id}
>
	<a class="e-t" {href}>{time}</a>
	<div class="e-b">
		{#if st.kind === 'failed'}
			<div class="fail">
				<div class="fail-row">
					<div class="fail-l">
						<span class="ring-err" aria-hidden="true"></span>
						<a class="fail-c" {href}>{st.cause}</a>
					</div>
					<div class="fail-a">
						{#if st.fix.action === 'delete'}
							<ConfirmAction
								action="{href}?/delete"
								label="Delete"
								title="Delete the {time} recording"
								triggerClass="hk-btn-secondary hk-btn-sm"
							>
								<p>Audio and transcript go.</p>
							</ConfirmAction>
						{:else}
							<form
								method="POST"
								action="{href}?/{st.fix.action}"
								use:enhance={() => {
									pending = true;
									return async ({ update }) => {
										await update();
										pending = false;
									};
								}}
							>
								{#if st.fix.delivery}<input
										type="hidden"
										name="delivery"
										value={st.fix.delivery}
									/>{/if}
								<button class="hk-btn-secondary hk-btn-sm" disabled={pending} aria-busy={pending}>
									<Icon name="retry" size={14} />Retry
								</button>
							</form>
						{/if}
					</div>
				</div>
				{#if rec.transcript?.trim()}
					<p class="fail-text">{rec.transcript}</p>
				{/if}
				{#if st.raw}<p class="fail-raw">{st.raw}</p>{/if}
			</div>
			{@render progress()}
		{:else if st.kind === 'waiting'}
			<p class="e-s"><span class="idle" aria-hidden="true"></span>Waiting</p>
			{@render progress()}
		{:else if st.kind === 'transcribing'}
			<span class="skel" style:width="92%" aria-hidden="true"></span>
			<span class="skel" style:width="58%" aria-hidden="true"></span>
			<p class="e-s"><span class="busy" aria-hidden="true"></span>Transcribing</p>
			{@render progress()}
		{:else if st.kind === 'sending'}
			{@render text(rec.transcript ?? '')}
			<p class="e-s"><span class="busy" aria-hidden="true"></span>Sending to the note</p>
			{@render progress()}
		{:else if st.kind === 'nospeech'}
			<p class="e-x">No speech</p>
			{#if meta.length}<p class="e-meta">
					{#each meta as m (m)}<span>{m}</span>{/each}
				</p>{/if}
			{@render progress()}
		{:else}
			{@render text(rec.transcript ?? '')}
			{#if meta.length}<p class="e-meta">
					{#each meta as m (m)}<span>{m}</span>{/each}
				</p>{/if}
			{@render progress()}
		{/if}
	</div>
	{#if rec.hasAudio}
		<PlayPill id={rec.id} durationMs={rec.durationMs} />
	{/if}
</li>

<style>
	.fail-c {
		text-decoration: none;
	}
	.fail-c:hover {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
</style>
