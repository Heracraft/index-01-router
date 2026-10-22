<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import Icon from '#lib/components/Icon.svelte';
	import PageHead from '#lib/components/PageHead.svelte';
	import SecretField from '#lib/components/SecretField.svelte';
	import { isLanguageCode, languageName } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// Form state starts from the stored settings; a save reloads them
	const s = $derived(data.settings);
	let provider = $state('');
	let openaiBase = $state('');
	let audioBase = $state('');
	let languages = $state<string[]>([]);
	// Reset only when the stored values change (a save), not on the reload after a test
	let seen = '';
	$effect.pre(() => {
		const key = JSON.stringify(s);
		if (key === seen) return;
		seen = key;
		provider = s.provider;
		openaiBase = s.openai.baseUrl;
		audioBase = s.openaiAudio.baseUrl;
		languages = [...s.languages];
	});

	const isOpenAI = (url: string) => {
		try {
			return /(^|\.)openai\.com$/.test(new URL(url).hostname);
		} catch {
			return false;
		}
	};

	const errors = $derived<Record<string, string>>(
		form && 'errors' in form && form.errors ? form.errors : {}
	);
	const test = $derived(form?.action === 'test' && 'test' in form ? form.test : null);

	let langInput = $state('');
	let langError = $state('');
	function addLanguage() {
		const code = langInput.trim().toLowerCase();
		if (!code) return;
		if (!isLanguageCode(code)) {
			langError = `Languages: ${code} is not an ISO 639-1 code such as sw or en.`;
			return;
		}
		if (!languages.includes(code)) languages = [...languages, code];
		langInput = '';
		langError = '';
	}

	let busy = $state<'save' | 'test' | null>(null);
	let saved = $state(false);
	const submit: SubmitFunction = ({ submitter }) => {
		busy = submitter?.getAttribute('formaction')?.includes('test') ? 'test' : 'save';
		saved = false;
		return async ({ update, result }) => {
			// A test changes nothing stored; reloading would put the stored values back over your edits
			await update({ reset: false, refreshAll: busy !== 'test' });
			saved = busy === 'save' && result.type === 'success';
			// A code typed without Add was posted with the form and is now a chip
			if (saved) {
				langInput = '';
				langError = '';
			}
			busy = null;
		};
	};

	const hostOf = (url: string) => {
		try {
			return new URL(url).host;
		} catch {
			return url;
		}
	};
	const defaultModel = (id: string) => data.providers.find((p) => p.id === id)?.defaultModel ?? '';
	// The effective model: a blank field means the provider's default
	const modelOf = (id: string) =>
		(id === 'openai'
			? s.openai.model
			: id === 'openai-audio'
				? s.openaiAudio.model
				: id === 'gemini'
					? s.gemini.model
					: '') || defaultModel(id);
</script>

<PageHead title="Transcription" />

{#if Object.keys(errors).length}
	<div class="hk-banner hk-banner--err" role="alert">
		{#each Object.values(errors) as e (e)}<span>{e}</span>{/each}
	</div>
{/if}

<form method="POST" action="?/save" use:enhance={submit} class="hk-fields">
	<fieldset>
		<legend class="hk-field-label">Provider</legend>
		<div class="providers">
			{#each data.providers as p (p.id)}
				<label class="hk-option">
					<input type="radio" name="provider" value={p.id} bind:group={provider} />
					<span class="opt">
						<span>{p.label}</span>
						<span class="opt-model hk-mono">{modelOf(p.id) || hostOf(s.whisperCpp.url)}</span>
					</span>
				</label>
			{/each}
		</div>
	</fieldset>

	<div class="group" hidden={provider !== 'openai'}>
		<div class="two">
			<div>
				<label class="hk-field-label" for="openai-base">Base URL</label>
				<input
					id="openai-base"
					name="openai.baseUrl"
					class="hk-input hk-mono"
					type="url"
					bind:value={openaiBase}
					aria-invalid={!!errors['openai.baseUrl'] || undefined}
				/>
			</div>
			<div>
				<label class="hk-field-label" for="openai-model">Model</label>
				<input
					id="openai-model"
					name="openai.model"
					class="hk-input hk-mono"
					value={s.openai.model}
					placeholder={defaultModel('openai')}
					spellcheck="false"
				/>
			</div>
		</div>
		<SecretField
			id="openai-key"
			name="openai.apiKey"
			label="API key"
			set={data.keysSet.openai}
			env={data.envLocks.openaiKey && isOpenAI(openaiBase) ? 'OPENAI_API_KEY' : null}
			clearable
		/>
	</div>

	<div class="group" hidden={provider !== 'openai-audio'}>
		<div class="two">
			<div>
				<label class="hk-field-label" for="audio-base">Base URL</label>
				<input
					id="audio-base"
					name="openaiAudio.baseUrl"
					class="hk-input hk-mono"
					type="url"
					bind:value={audioBase}
					aria-invalid={!!errors['openaiAudio.baseUrl'] || undefined}
				/>
			</div>
			<div>
				<label class="hk-field-label" for="audio-model">Model</label>
				<input
					id="audio-model"
					name="openaiAudio.model"
					class="hk-input hk-mono"
					value={s.openaiAudio.model}
					placeholder={defaultModel('openai-audio')}
					spellcheck="false"
				/>
			</div>
		</div>
		<SecretField
			id="audio-key"
			name="openaiAudio.apiKey"
			label="API key"
			set={data.keysSet.openaiAudio}
			env={data.envLocks.openaiKey && isOpenAI(audioBase) ? 'OPENAI_API_KEY' : null}
			clearable
		/>
	</div>

	<div class="group" hidden={provider !== 'gemini'}>
		<div>
			<label class="hk-field-label" for="gemini-model">Model</label>
			<input
				id="gemini-model"
				name="gemini.model"
				class="hk-input hk-mono"
				value={s.gemini.model}
				placeholder={defaultModel('gemini')}
				spellcheck="false"
			/>
		</div>
		<SecretField
			id="gemini-key"
			name="gemini.apiKey"
			label="API key"
			set={data.keysSet.gemini}
			env={data.envLocks.geminiKey ? 'GEMINI_API_KEY' : null}
			clearable
		/>
	</div>

	<div class="group" hidden={provider !== 'whisper-cpp'}>
		<div>
			<label class="hk-field-label" for="whisper-url">Server URL</label>
			<input
				id="whisper-url"
				name="whisperCpp.url"
				class="hk-input hk-mono"
				type="url"
				value={s.whisperCpp.url}
				aria-invalid={!!errors['whisperCpp.url'] || undefined}
			/>
		</div>
	</div>

	<hr class="hk-rule" />

	<div>
		<label class="hk-field-label" for="lang-add">Languages</label>
		<div class="langs">
			{#each languages as code (code)}
				<input type="hidden" name="languages" value={code} />
				<span class="lang">
					{#if languageName(code) !== code}{languageName(code)}{/if}
					<span class="hk-mono code">{code}</span>
					<button
						type="button"
						class="lang-x"
						aria-label="Remove {languageName(code)}"
						onclick={() => (languages = languages.filter((l) => l !== code))}
					>
						<Icon name="close" />
					</button>
				</span>
			{:else}
				<span class="detect">Detect</span>
			{/each}
			<span class="lang-add">
				<input
					id="lang-add"
					class="hk-input hk-mono"
					name="languages"
					placeholder="sw"
					maxlength="3"
					size="4"
					autocomplete="off"
					spellcheck="false"
					bind:value={langInput}
					aria-invalid={!!(langError || errors.languages) || undefined}
					aria-describedby={langError ? 'lang-error' : undefined}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							addLanguage();
						}
					}}
				/>
				<button type="button" class="hk-btn-secondary hk-btn-sm" onclick={addLanguage}>Add</button>
			</span>
		</div>
		{#if langError}<p class="hk-field-error" id="lang-error">{langError}</p>{/if}
	</div>

	<div>
		<label class="hk-field-label" for="prompt">Prompt</label>
		<textarea id="prompt" name="prompt" class="hk-textarea" rows="4" placeholder="Names, jargon"
			>{s.prompt}</textarea
		>
	</div>

	<label class="hk-check">
		<input type="checkbox" name="chunking" checked={s.chunking} />
		Split long audio at pauses
	</label>

	<hr class="hk-rule" />

	<div>
		<label class="hk-field-label" for="timezone">Timezone</label>
		<select
			id="timezone"
			name="timezone"
			class="hk-select"
			aria-invalid={!!errors.timezone || undefined}
		>
			{#each data.timeZones as z (z)}
				<option value={z} selected={z === data.generalTimezone}>{z.replaceAll('_', ' ')}</option>
			{/each}
		</select>
		<p class="tz-hint">
			Defaults to TZ ({data.envTimezone.replaceAll('_', ' ')}). Pick another zone to override it.
		</p>
	</div>

	<div class="buttons">
		<button class="hk-btn" disabled={!!busy} aria-busy={busy === 'save'}>
			{busy === 'save' ? 'Saving…' : 'Save'}
		</button>
		<button
			class="hk-btn-secondary"
			formaction="?/test"
			disabled={!!busy}
			aria-busy={busy === 'test'}
		>
			{busy === 'test' ? 'Testing…' : 'Test'}
		</button>
		<span class="result" role="status">
			{#if !busy && test}
				<span class:bad={!test.ok}>
					<span class="hk-dot" class:hk-dot--ok={test.ok} class:hk-dot--err={!test.ok}></span>
					{test.message}
				</span>
			{:else if !busy && saved}
				<span>Saved</span>
			{/if}
		</span>
	</div>
</form>

<style>
	.tz-hint {
		margin: 0.375rem 0 0;
		font-size: 0.75rem;
		color: var(--hk-text-3);
	}
	fieldset {
		border: 0;
		margin: 0;
		padding: 0;
	}
	.providers {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
	}
	.hk-option input {
		accent-color: var(--hk-accent);
		margin: 0;
		flex: none;
	}
	.opt {
		display: flex;
		flex-direction: column;
		min-width: 0;
		font-size: 0.875rem;
		line-height: 1.3;
	}
	.opt-model {
		font-size: 0.75rem;
		font-weight: 400;
		color: var(--hk-text-3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.group {
		display: grid;
		gap: 1.25rem;
	}
	.group[hidden] {
		display: none;
	}
	.two {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1.25rem;
	}
	@media (min-width: 640px) {
		.two {
			grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
			gap: 1rem;
		}
	}
	.langs {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.lang {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		height: 1.75rem;
		padding: 0 0.25rem 0 0.625rem;
		border-radius: var(--hk-radius-pill);
		border: 1px solid var(--hk-selected-border);
		background: var(--hk-selected-bg);
		color: var(--hk-selected-text);
		font-size: 0.75rem;
		font-weight: 500;
	}
	.code {
		font-weight: 400;
		opacity: 0.75;
	}
	.lang-x {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		border: 0;
		border-radius: var(--hk-radius-pill);
		background: none;
		color: inherit;
		cursor: pointer;
	}
	.lang-x:hover {
		background: var(--hk-active);
	}
	.lang-x :global(svg) {
		width: 0.75rem;
		height: 0.75rem;
	}
	.detect {
		font-size: 0.875rem;
		color: var(--hk-text-3);
		padding-right: 0.25rem;
	}
	.lang-add {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
	}
	.lang-add .hk-input {
		width: 4.5rem;
		height: 1.875rem;
	}
	.buttons {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.75rem;
		padding-top: 0.5rem;
	}
	.result {
		font-size: 0.875rem;
		color: var(--hk-text-2);
		min-width: 0;
	}
	.result > span {
		display: inline-flex;
		align-items: baseline;
		gap: 0.5rem;
	}
	.bad {
		color: var(--hk-err);
	}
</style>
