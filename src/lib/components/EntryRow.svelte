<script lang="ts">
	import { resolve } from '$app/paths';
	/* One line of the day sheet: a recording in whatever state it is. A line that landed shows
	   only its time, text and play pill */
	import { applyAction, enhance } from '$app/forms';
	import { goto, refreshAll } from '$app/navigation';
	import ConfirmAction from './ConfirmAction.svelte';
	import Icon from './Icon.svelte';
	import PlayPill from './PlayPill.svelte';
	import Waveform from './Waveform.svelte';
	import { audio } from './audio.svelte.ts';
	import { live } from './live.svelte.ts';
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
	/** A search hit shows whole, so you see why it matched */
	const hit = $derived(
		!!mark.trim() && (rec.transcript ?? '').toLowerCase().includes(mark.trim().toLowerCase())
	);
	let over = $state(false);
	let pending = $state(false);
	let retryError = $state<string | null>(null);

	/** The line an upload just made: scrolled to and marked once */
	function flash(node: HTMLElement) {
		if (live.flash !== rec.id) return;
		live.flash = null;
		node.scrollIntoView({ block: 'center' });
		node.classList.add('e--flash');
		const t = setTimeout(() => node.classList.remove('e--flash'), 2400);
		return { destroy: () => clearTimeout(t) };
	}

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
	<p class="e-x" class:clamped={!open && !hit} use:clamp>
		{#each parts(t) as p, i (i)}{#if p.m}<mark>{p.t}</mark>{:else}{p.t}{/if}{/each}
	</p>
	{#if !hit && (over || open)}
		<button type="button" class="e-more" onclick={() => (open = !open)}
			>{open ? 'Less' : 'More'}</button
		>
	{/if}
{/snippet}

{#snippet progress()}
	{#if showProgress}
		<div class="iprog">
			<Waveform id={rec.id} durationMs={rec.durationMs} class="iwave" height={18} />
			<span class="itime">{formatDuration(audio.time * 1000)}</span>
		</div>
	{/if}
{/snippet}

<li
	class="e"
	class:e--fail={st.kind === 'failed'}
	class:e--muted={st.kind === 'sending' || st.kind === 'nospeech'}
	data-id={rec.id}
	use:flash
>
	<a class="e-t" {href}>{time}</a>
	<div class="e-b">
		{#if st.kind === 'failed'}
			{#if rec.transcript?.trim()}
				{@render text(rec.transcript)}
			{/if}
			<div class="e-s e-s--err">
				<span class="fdot" aria-hidden="true"></span>
				<span class="fail-c">{st.cause}</span>
				{#if st.fix.action === 'delete'}
					<ConfirmAction
						action="{href}?/delete"
						label="Delete"
						title="Delete the {time} recording"
						triggerClass="hk-btn-ghost hk-btn-sm e-act"
					>
						<p>Audio and transcript go.</p>
					</ConfirmAction>
				{:else}
					<form
						method="POST"
						action="{href}?/{st.fix.action}"
						use:enhance={() => {
							pending = true;
							retryError = null;
							// Stays on this page: the action lives on the recording's page
							return async ({ result }) => {
								try {
									if (result.type === 'redirect') {
										// eslint-disable-next-line svelte/no-navigation-without-resolve -- a path the server built
										await goto(result.location);
									} else if (result.type === 'error') {
										await applyAction(result);
									} else {
										if (result.type === 'failure')
											retryError = String(result.data?.error ?? 'Retry failed');
										await refreshAll();
									}
								} finally {
									pending = false;
								}
							};
						}}
					>
						{#if st.fix.delivery}<input
								type="hidden"
								name="delivery"
								value={st.fix.delivery}
							/>{/if}
						<button class="hk-btn-ghost hk-btn-sm e-act" disabled={pending} aria-busy={pending}>
							<Icon name="retry" size={14} />{pending ? 'Retrying…' : 'Retry'}
						</button>
					</form>
				{/if}
			</div>
			{#if retryError}<p class="e-s e-s--err" role="alert">{retryError}</p>{/if}
			{@render progress()}
		{:else if st.kind === 'waiting'}
			<p class="e-s"><span class="idle" aria-hidden="true"></span>Waiting</p>
			{@render progress()}
		{:else if st.kind === 'transcribing'}
			<p class="e-s"><span class="spin" aria-hidden="true"></span>Transcribing</p>
			{@render progress()}
		{:else if st.kind === 'sending'}
			{@render text(rec.transcript ?? '')}
			<p class="e-s"><span class="spin" aria-hidden="true"></span>Sending to the note</p>
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
	{#if rec.hasAudio && rec.durationMs != null}
		<PlayPill id={rec.id} durationMs={rec.durationMs} />
	{/if}
</li>
