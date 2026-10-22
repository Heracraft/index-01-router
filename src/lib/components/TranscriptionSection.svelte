<script lang="ts">
	/* Languages first, then names and words, then the model folded to one row with Change */
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import Icon from './Icon.svelte';
	import SaveBar from './SaveBar.svelte';
	import SecretField from './SecretField.svelte';
	import Switch from './Switch.svelte';
	import TestResult from './TestResult.svelte';
	import { sectionSubmit, type SectionResult } from './section-submit.ts';
	import type { DirtyForms } from './dirty.svelte.ts';
	import { formatElapsed, isLanguageCode, languageName } from '#lib/format.ts';

	interface Provider {
		id: string;
		label: string;
		defaultModel: string;
	}
	interface Props {
		t: {
			providers: readonly Provider[];
			settings: {
				provider: string;
				openai: { baseUrl: string; model: string };
				openaiAudio: { baseUrl: string; model: string };
				whisperCpp: { url: string };
				languages: string[];
				prompt: string;
				chunking: boolean;
			};
			keysSet: { openai: boolean; openaiAudio: boolean };
			keysLost: { openai: boolean; openaiAudio: boolean };
			ready: Record<string, 'ok' | 'lost' | 'missing' | null>;
			chunkSeconds: number;
			envLocks: { openaiKey: boolean };
		};
		dirty: DirtyForms;
		/** Errors for fields of this form placed in other sections (the timezone) */
		onerrors?: (errors: Record<string, string>) => void;
	}
	let { t, dirty, onerrors }: Props = $props();

	const s = $derived(t.settings);
	let provider = $state('');
	let openaiBase = $state('');
	let audioBase = $state('');
	let languages = $state<string[]>([]);
	let seen = '';
	$effect.pre(() => {
		const k = JSON.stringify(s);
		if (k === seen) return;
		seen = k;
		provider = s.provider;
		openaiBase = s.openai.baseUrl;
		audioBase = s.openaiAudio.baseUrl;
		languages = [...s.languages];
	});

	let result = $state<SectionResult>(null);
	let busy = $state<'save' | 'test' | null>(null);
	let stale = $state(false);
	const submit = $derived(
		sectionSubmit(dirty, 'transcription', {
			start: (test) => {
				busy = test ? 'test' : 'save';
			},
			result: (data) => {
				result = data;
				stale = false;
				busy = null;
				if (data?.saved) {
					adding = false;
					langInput = '';
				}
			}
		})
	);
	const test = $derived(
		result?.action === 'transcriptionTest' && result.test
			? (result.test as
					{ ok: true; ms: number } | { ok: false; message: string; field: string | null })
			: null
	);
	const errors = $derived.by<Record<string, string>>(() => {
		if (busy) return {};
		const out: Record<string, string> = result?.errors
			? { ...(result.errors as Record<string, string>) }
			: {};
		if (test && !test.ok && test.field && !stale) out[test.field] = test.message;
		return out;
	});
	$effect(() => onerrors?.(errors));
	let open = $state(false);
	$effect(() => {
		if (Object.keys(errors).some((k) => k !== 'languages' && k !== 'timezone')) open = true;
	});

	const isOpenAI = (url: string) => {
		try {
			return /(^|\.)openai\.com$/.test(new URL(url).hostname);
		} catch {
			return false;
		}
	};
	const current = $derived(t.providers.find((p) => p.id === s.provider));
	const modelOf = (id: string) =>
		(id === 'openai' ? s.openai.model : id === 'openai-audio' ? s.openaiAudio.model : '') ||
		(t.providers.find((p) => p.id === id)?.defaultModel ?? '');
	const ready = $derived(t.ready[s.provider] ?? null);

	// Languages: chips, and a box that takes a name or a code
	let adding = $state(false);
	let langInput = $state('');
	let langError = $state('');
	let langBox = $state<HTMLInputElement>();
	const COMMON = [
		'en',
		'sw',
		'es',
		'fr',
		'de',
		'ar',
		'pt',
		'it',
		'nl',
		'hi',
		'zh',
		'ja',
		'am',
		'so',
		'yo',
		'zu'
	];
	function codeFor(input: string) {
		const v = input.trim().toLowerCase();
		if (!v) return '';
		if (isLanguageCode(v)) return v;
		const hit = COMMON.find((c) => languageName(c).toLowerCase() === v);
		return hit ?? v;
	}
	async function addLanguage() {
		const code = codeFor(langInput);
		if (!code) {
			adding = false;
			return;
		}
		if (!isLanguageCode(code)) {
			langError = `${langInput.trim()} is not a language name or an ISO 639-1 code such as sw.`;
			return;
		}
		if (!languages.includes(code)) languages = [...languages, code];
		langInput = '';
		langError = '';
		adding = false;
		await tick();
		dirty.check();
	}
	async function removeLanguage(code: string) {
		languages = languages.filter((l) => l !== code);
		await tick();
		dirty.check();
	}
	async function startAdding() {
		adding = true;
		await tick();
		langBox?.focus();
	}
	// Suggestions under the box: common languages not picked yet that match what is typed
	const suggestions = $derived.by(() => {
		const v = langInput.trim().toLowerCase();
		return COMMON.filter((c) => !languages.includes(c))
			.filter((c) => !v || c.startsWith(v) || languageName(c).toLowerCase().includes(v))
			.slice(0, 8);
	});
	let active = $state(0);
	$effect(() => {
		if (active >= suggestions.length) active = 0;
	});
	async function pick(code: string) {
		langInput = code;
		await addLanguage();
	}
	function closeAdding() {
		adding = false;
		langInput = '';
		langError = '';
	}
	const described = (k: string) => (errors[k] ? `${k.replace('.', '-')}-error` : undefined);
</script>

{#snippet err(k: string)}
	{#if errors[k]}<p class="f-err" id="{k.replace('.', '-')}-error">{errors[k]}</p>{/if}
{/snippet}

<section class="sset" id="transcription" aria-labelledby="transcription-h">
	<div class="sset-h">
		<h2 class="sec-h" id="transcription-h">Transcription</h2>
	</div>
	<form
		id="f-transcription"
		method="POST"
		action="/settings?/transcription"
		use:enhance={submit}
		use:dirty.track={{ key: 'transcription', label: 'Transcription' }}
		oninput={() => (stale = true)}
	>
		<div class="f">
			<span class="hk-field-label" id="lang-label">Languages</span>
			<div class="chips" role="group" aria-labelledby="lang-label">
				{#each languages as code (code)}
					<input type="hidden" name="languages" value={code} />
					<span class="lang" title={code}>
						{languageName(code)}
						<button
							type="button"
							aria-label="Remove {languageName(code)}"
							onclick={() => removeLanguage(code)}><Icon name="close" size={12} /></button
						>
					</span>
				{/each}
				{#if adding}
					<span class="combo">
						<input
							bind:this={langBox}
							class="lang lang-in"
							placeholder="Language or code"
							autocomplete="off"
							spellcheck="false"
							role="combobox"
							aria-expanded={suggestions.length > 0}
							aria-controls="lang-list"
							aria-activedescendant={suggestions[active]
								? `lang-${suggestions[active]}`
								: undefined}
							bind:value={langInput}
							aria-label="Add language"
							aria-invalid={!!(langError || errors.languages) || undefined}
							oninput={() => (active = 0)}
							onkeydown={(e) => {
								if (e.key === 'ArrowDown') {
									e.preventDefault();
									active = Math.min(suggestions.length - 1, active + 1);
								} else if (e.key === 'ArrowUp') {
									e.preventDefault();
									active = Math.max(0, active - 1);
								} else if (e.key === 'Enter') {
									e.preventDefault();
									const hit = suggestions[active];
									if (hit && langInput.trim() && !isLanguageCode(langInput.trim().toLowerCase()))
										pick(hit);
									else if (!langInput.trim() && hit) pick(hit);
									else addLanguage();
								} else if (e.key === 'Escape') {
									closeAdding();
								}
							}}
							onblur={() => (langInput.trim() ? addLanguage() : closeAdding())}
						/>
						{#if suggestions.length}
							<ul class="combo-pop" id="lang-list" role="listbox" aria-label="Languages">
								{#each suggestions as c, i (c)}
									<li
										id="lang-{c}"
										role="option"
										aria-selected={i === active}
										class:on={i === active}
										onpointerdown={(e) => {
											e.preventDefault();
											pick(c);
										}}
									>
										{languageName(c)}<span class="code">{c}</span>
									</li>
								{/each}
							</ul>
						{/if}
					</span>
				{:else}
					<button type="button" class="lang--add lang" onclick={startAdding}
						><Icon name="plus" size={12} />{languages.length
							? 'Add language'
							: 'Detect any, or add one'}</button
					>
				{/if}
			</div>
			{#if langError}<p class="f-err">{langError}</p>{/if}
			{@render err('languages')}
		</div>

		<div class="f">
			<label class="hk-field-label" for="prompt">Names and words</label>
			<textarea
				id="prompt"
				name="prompt"
				class="hk-textarea"
				rows="3"
				placeholder="Amina, Juma, Kilimani">{s.prompt}</textarea
			>
		</div>

		<div class="srow srow--top">
			<span class="srow-l">Model</span>
			<span class="srow-v">
				<span class="mval"
					><span class="plabel">{current?.label ?? s.provider}</span><span
						class="msep"
						aria-hidden="true">·</span
					>{modelOf(s.provider)}</span
				>
				{#if ready === 'lost'}
					<span class="from err"
						><span class="dot err" aria-hidden="true"></span>Key unreadable</span
					>
				{:else if ready === 'missing'}
					<span class="from"><span class="dot warn" aria-hidden="true"></span>No key</span>
				{/if}
				<button
					type="button"
					class="hk-btn-secondary hk-btn-sm"
					aria-expanded={open}
					onclick={() => (open = !open)}>{open ? 'Done' : 'Change'}</button
				>
			</span>
		</div>

		<div class="prov" hidden={!open}>
			<fieldset class="f">
				<legend class="hk-field-label">Provider</legend>
				<div class="providers">
					{#each t.providers as p (p.id)}
						<label class="hk-option">
							<input type="radio" name="provider" value={p.id} bind:group={provider} />
							<span class="opt">
								<span>{p.label}</span>
								<span class="hk-mono opt-model">{modelOf(p.id) || 'your server'}</span>
							</span>
						</label>
					{/each}
				</div>
				{@render err('provider')}
			</fieldset>

			<div hidden={provider !== 'openai'}>
				<div class="fgrid">
					<div class="f">
						<label class="hk-field-label" for="openai-base">Base URL</label>
						<input
							id="openai-base"
							name="openai.baseUrl"
							class="hk-input hk-mono"
							type="url"
							bind:value={openaiBase}
							aria-invalid={!!errors['openai.baseUrl'] || undefined}
							aria-describedby={described('openai.baseUrl')}
						/>
						{@render err('openai.baseUrl')}
					</div>
					<div class="f">
						<label class="hk-field-label" for="openai-model">Model name</label>
						<input
							id="openai-model"
							name="openai.model"
							class="hk-input hk-mono"
							value={s.openai.model}
							placeholder={t.providers.find((p) => p.id === 'openai')?.defaultModel}
							spellcheck="false"
							aria-invalid={!!errors['openai.model'] || undefined}
							aria-describedby={described('openai.model')}
						/>
						{@render err('openai.model')}
					</div>
				</div>
				<div class="f" id="openai-key-wrap">
					<SecretField
						id="openai-key"
						name="openai.apiKey"
						label="API key"
						set={t.keysSet.openai}
						lost={t.keysLost.openai}
						env={t.envLocks.openaiKey && isOpenAI(openaiBase) ? 'OPENAI_API_KEY' : null}
						invalid={!!errors['openai.apiKey']}
						describedby={described('openai.apiKey')}
						clearable
					/>
					{@render err('openai.apiKey')}
				</div>
			</div>

			<div hidden={provider !== 'openai-audio'}>
				<div class="fgrid">
					<div class="f">
						<label class="hk-field-label" for="audio-base">Base URL</label>
						<input
							id="audio-base"
							name="openaiAudio.baseUrl"
							class="hk-input hk-mono"
							type="url"
							bind:value={audioBase}
							aria-invalid={!!errors['openaiAudio.baseUrl'] || undefined}
							aria-describedby={described('openaiAudio.baseUrl')}
						/>
						{@render err('openaiAudio.baseUrl')}
					</div>
					<div class="f">
						<label class="hk-field-label" for="audio-model">Model name</label>
						<input
							id="audio-model"
							name="openaiAudio.model"
							class="hk-input hk-mono"
							value={s.openaiAudio.model}
							placeholder={t.providers.find((p) => p.id === 'openai-audio')?.defaultModel}
							spellcheck="false"
							aria-invalid={!!errors['openaiAudio.model'] || undefined}
							aria-describedby={described('openaiAudio.model')}
						/>
						{@render err('openaiAudio.model')}
					</div>
				</div>
				<div class="f">
					<SecretField
						id="audio-key"
						name="openaiAudio.apiKey"
						label="API key"
						set={t.keysSet.openaiAudio}
						lost={t.keysLost.openaiAudio}
						env={t.envLocks.openaiKey && isOpenAI(audioBase) ? 'OPENAI_API_KEY' : null}
						invalid={!!errors['openaiAudio.apiKey']}
						describedby={described('openaiAudio.apiKey')}
						clearable
					/>
					{@render err('openaiAudio.apiKey')}
				</div>
			</div>

			<div hidden={provider !== 'whisper-cpp'}>
				<div class="f">
					<label class="hk-field-label" for="whisper-url">Server URL</label>
					<input
						id="whisper-url"
						name="whisperCpp.url"
						class="hk-input hk-mono"
						type="url"
						value={s.whisperCpp.url}
						placeholder="http://whisper.example.com:8080"
						aria-invalid={!!errors['whisperCpp.url'] || undefined}
						aria-describedby={described('whisperCpp.url')}
					/>
					{@render err('whisperCpp.url')}
				</div>
			</div>

			<div class="actrow">
				<button
					class="hk-btn-secondary hk-btn-sm"
					formaction="/settings?/transcriptionTest"
					disabled={!!busy}
					aria-busy={busy === 'test'}>{busy === 'test' ? 'Testing…' : 'Test connection'}</button
				>
				<span class="result" role="status">
					{#if !busy && test && (test.ok || !test.field)}
						<TestResult result={test} {stale}>
							{#if test.ok}<span class="hk-num">{formatElapsed(test.ms)}</span>{/if}
						</TestResult>
					{/if}
				</span>
			</div>
		</div>

		<div class="srow" class:srow--top={open}>
			<span class="srow-l">Split audio over {t.chunkSeconds} s at pauses</span>
			<Switch
				name="chunking"
				checked={s.chunking}
				label="Split audio over {t.chunkSeconds} s at pauses"
			/>
		</div>
	</form>
	<SaveBar {dirty} keys={['transcription']} />
</section>

<style>
	.prov {
		padding-bottom: 0.5rem;
	}
	fieldset {
		border: 0;
		padding: 0;
		margin-inline: 0;
	}
	legend {
		padding: 0;
		margin-bottom: 0.375rem;
	}
	.providers {
		display: grid;
		gap: 0.5rem;
	}
	.opt {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		width: 100%;
	}
	.opt-model {
		font-size: 0.75rem;
		color: var(--hk-text-3);
	}
	.err {
		color: var(--hk-err);
	}
	.mval {
		color: var(--hk-text);
	}
	.plabel {
		color: var(--hk-text-3);
	}
	.msep {
		margin: 0 0.375rem;
		color: var(--hk-text-4);
	}
	.hk-option input {
		appearance: none;
		flex: none;
		width: 1rem;
		height: 1rem;
		margin: 0;
		border-radius: 99px;
		box-shadow: inset 0 0 0 1.5px var(--hk-border-strong);
		background: var(--hk-surface);
		transition: box-shadow var(--hk-dur-fast) var(--hk-ease);
	}
	.hk-option input:checked {
		box-shadow: inset 0 0 0 5px var(--hk-text);
	}
	.hk-option input:focus-visible {
		outline: none;
	}
	.combo {
		position: relative;
		display: inline-flex;
	}
	.lang-in {
		width: 11rem;
		padding: 0 0.75rem;
		font: inherit;
		font-size: 0.8125rem;
		font-weight: 400;
		outline: none;
	}
	.lang-in:focus {
		border-color: var(--hk-text-3);
	}
	.lang-in[aria-invalid='true'] {
		border-color: var(--hk-err);
	}
	.combo-pop {
		position: absolute;
		top: calc(100% + 0.375rem);
		left: 0;
		z-index: 10;
		min-width: 13rem;
		max-height: 16rem;
		overflow-y: auto;
		margin: 0;
		padding: 0.25rem;
		list-style: none;
		border-radius: var(--hk-radius);
		background: var(--hk-surface);
		box-shadow: var(--hk-shadow-pop);
	}
	.combo-pop li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		height: 2rem;
		padding: 0 0.625rem;
		border-radius: var(--hk-radius-6);
		font-size: 0.8125rem;
		color: var(--hk-text);
		cursor: pointer;
	}
	.combo-pop li.on {
		background: var(--hk-hover);
	}
	.code {
		font-family: var(--hk-font-mono);
		font-size: 0.75rem;
		color: var(--hk-text-3);
	}
	@media (max-width: 639.98px) {
		.plabel,
		.msep {
			display: none;
		}
	}
</style>
