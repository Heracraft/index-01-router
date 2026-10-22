<script lang="ts">
	import { onMount } from 'svelte';
	import GeneralSection from '#lib/components/GeneralSection.svelte';
	import NoteSection from '#lib/components/NoteSection.svelte';
	import RingSection from '#lib/components/RingSection.svelte';
	import TranscriptionSection from '#lib/components/TranscriptionSection.svelte';
	import { DirtyForms } from '#lib/components/dirty.svelte.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const dirty = new DirtyForms();
	// Discard remounts the sections from the loaded values
	let version = $state(0);
	let adding = $state(false);
	let transcriptionErrors = $state<Record<string, string>>({});

	const revealed = $derived(form && 'secret' in form && form.secret ? String(form.secret) : null);
	const formError = $derived(form && 'error' in form && form.error ? String(form.error) : null);
	const named = $derived(data.notes.length > 1);

	// Status per section for the index: green fine, amber needs a look, red broken
	const tone = $derived.by(() => {
		const notes = data.notes;
		const noteTone =
			notes.length === 0
				? 'idle'
				: notes.some((n) => Object.values(n.secretsLost).some(Boolean))
					? 'err'
					: notes.some(
								(n) => n.enabled && n.lastFailed && (!n.lastSent || n.lastFailed.at > n.lastSent)
						  )
						? 'warn'
						: notes.some((n) => n.enabled)
							? 'ok'
							: 'idle';
		const ready = data.transcription.ready[data.transcription.settings.provider];
		const tTone = ready === 'lost' ? 'err' : ready === 'missing' ? 'warn' : 'ok';
		const last = data.ring.last;
		const rTone = !last ? 'idle' : last.status < 300 ? 'ok' : 'warn';
		return { note: noteTone, transcription: tTone, ring: rTone };
	});
	const index = $derived([
		{ id: 'note', label: 'Daily note', tone: tone.note },
		{ id: 'transcription', label: 'Transcription', tone: tone.transcription },
		{ id: 'ring', label: 'Ring', tone: tone.ring },
		{ id: 'general', label: 'General', tone: null }
	]);

	let current = $state('note');
	onMount(() => {
		const els = index
			.map((s) => document.getElementById(s.id))
			.filter((e): e is HTMLElement => !!e);
		const io = new IntersectionObserver(
			(entries) => {
				const top = entries
					.filter((e) => e.isIntersecting)
					.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
				if (top) current = top.target.id;
			},
			{ rootMargin: '-80px 0px -60% 0px' }
		);
		els.forEach((e) => io.observe(e));
		// Old links to one integration land on its section
		if (location.hash.startsWith('#note-')) document.querySelector(location.hash)?.scrollIntoView();
		return () => io.disconnect();
	});

	const barText = $derived.by(() => {
		const labels = [...new Set(Object.values(dirty.changed))];
		if (labels.length === 1) return `${labels[0]} changed`;
		return `${labels.length} sections changed`;
	});
	function discard() {
		version++;
		adding = false;
		for (const k of Object.keys(dirty.changed)) delete dirty.changed[k];
	}
	function onKey(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 's' && dirty.count) {
			e.preventDefault();
			dirty.saveAll();
		}
	}
</script>

<svelte:window onkeydown={onKey} />
<svelte:head>
	<title>Settings · Index 01</title>
</svelte:head>

<div class="shell">
	<aside class="rail">
		<nav class="snav" aria-label="Sections">
			{#each index as s (s.id)}
				<a
					href="#{s.id}"
					class:cur={current === s.id}
					aria-current={current === s.id ? 'true' : undefined}
					>{s.label}{#if s.tone && s.tone !== 'idle'}<span
							class="sdot {s.tone}"
							aria-label={s.tone === 'ok' ? 'Fine' : s.tone === 'warn' ? 'Needs a look' : 'Broken'}
						></span>{/if}</a
				>
			{/each}
		</nav>
	</aside>

	<main id="main" class="col col--set" tabindex="-1">
		<h1 class="hk-h1-app">Settings</h1>
		{#if formError}<p class="hk-banner hk-banner--err" role="alert">{formError}</p>{/if}

		{#key version}
			<div id="note">
				{#each data.notes as note (note.id)}
					<NoteSection
						{note}
						triggers={data.triggers}
						sample={data.sample}
						timezone={data.timezone}
						{dirty}
						{named}
					/>
				{/each}
				{#if data.notes.length === 0 || adding}
					<NoteSection
						note={{
							id: null,
							name: data.notes.length ? 'Second note' : 'Daily note',
							enabled: true,
							triggers: [],
							secretsSet: {},
							secretsLost: {},
							lastSent: null,
							lastFailed: null,
							deliveryCount: 0,
							...data.newNote
						}}
						triggers={data.triggers}
						sample={data.sample}
						timezone={data.timezone}
						{dirty}
						named
						oncancel={data.notes.length ? () => (adding = false) : undefined}
					/>
				{:else}
					<button type="button" class="linkbtn add" onclick={() => (adding = true)}
						>Add another note</button
					>
				{/if}
			</div>

			<TranscriptionSection
				t={data.transcription}
				{dirty}
				onerrors={(e) => (transcriptionErrors = e)}
			/>
			<RingSection ring={data.ring} {revealed} timezone={data.timezone} {dirty} />
			<GeneralSection
				general={data.general}
				email={data.user.email ?? data.user.name}
				error={transcriptionErrors.timezone ?? null}
			/>
		{/key}

		{#if dirty.count}
			<div class="savebar" role="region" aria-label="Unsaved changes">
				<div class="savebar-in">
					<span class="sb-t">{barText}</span>
					<span class="sb-a">
						<button
							type="button"
							class="hk-btn-ghost hk-btn-sm"
							onclick={discard}
							disabled={dirty.busy}>Discard</button
						>
						<button
							type="button"
							class="hk-btn hk-btn-sm"
							onclick={() => dirty.saveAll()}
							disabled={dirty.busy}
							aria-busy={dirty.busy}>{dirty.busy ? 'Saving…' : 'Save'}</button
						>
					</span>
				</div>
			</div>
		{/if}
	</main>
</div>

<style>
	.add {
		margin-top: 1rem;
		font-size: 0.875rem;
	}
	#note {
		scroll-margin-top: 4.5rem;
	}
	#note > :global(.sset:first-child) {
		margin-top: 0.5rem;
	}
</style>
