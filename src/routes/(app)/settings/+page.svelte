<script lang="ts">
	import { onMount, setContext } from 'svelte';
	import Icon from '#lib/components/Icon.svelte';
	import GeneralSection from '#lib/components/GeneralSection.svelte';
	import NoteSection from '#lib/components/NoteSection.svelte';
	import RingSection from '#lib/components/RingSection.svelte';
	import SettingsNav from '#lib/components/SettingsNav.svelte';
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

	// A dot on a section only when it needs a look (amber) or is broken (red)
	const tone = $derived.by(() => {
		const notes = data.notes;
		const noteTone = notes.some((n) => Object.values(n.secretsLost).some(Boolean))
			? 'err'
			: notes.some(
						(n) => n.enabled && n.lastFailed && (!n.lastSent || n.lastFailed.at > n.lastSent)
				  )
				? 'warn'
				: null;
		const ready = data.transcription.ready[data.transcription.settings.provider];
		const tTone = ready === 'lost' ? 'err' : ready === 'missing' ? 'warn' : null;
		const last = data.ring.last;
		const rTone = last && last.status >= 300 ? 'warn' : null;
		return { note: noteTone, transcription: tTone, ring: rTone } as const;
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

	function discard() {
		version++;
		adding = false;
		for (const k of Object.keys(dirty.changed)) delete dirty.changed[k];
	}
	setContext('settings-discard', discard);
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
	<SettingsNav items={index} {current} />

	<main id="main" class="col col--set" tabindex="-1">
		<h1 class="hk-sr">Settings</h1>
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
					<button type="button" class="addrow" onclick={() => (adding = true)}
						><Icon name="plus" size={14} />Add another daily note</button
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
				{dirty}
				error={transcriptionErrors.timezone ?? null}
			/>
		{/key}
	</main>
</div>

<style>
	.addrow {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		margin-top: 1.25rem;
		padding: 0;
		border: 0;
		background: none;
		color: var(--hk-text-2);
		font: inherit;
		font-size: 0.875rem;
		cursor: pointer;
	}
	.addrow:hover {
		color: var(--hk-text);
	}
	#note {
		scroll-margin-top: 4.5rem;
	}
	#note > :global(.sset:first-child) {
		margin-top: 0;
		padding-top: 0.25rem;
		border-top: 0;
	}
</style>
