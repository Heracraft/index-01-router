<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import Icon from '#lib/components/Icon.svelte';
	import PageHead from '#lib/components/PageHead.svelte';
	import SecretField from '#lib/components/SecretField.svelte';
	import Signal from '#lib/components/Signal.svelte';
	import TestResult from '#lib/components/TestResult.svelte';
	import { formatElapsed, isLanguageCode, languageName } from '#lib/format.ts';
	import { formatDate } from '#lib/notes/time.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// Form state starts from the stored settings; a save reloads them
	const s = $derived(data.settings);
	let provider = $state('');
	let openaiBase = $state('');
	let audioBase = $state('');
	let languages = $state<string[]>([]);
	let zone = $state('');
	// Reset only when the stored values change (a save), not on the reload after a test
	let seen = '';
	$effect.pre(() => {
		const key = JSON.stringify([s, data.generalTimezone]);
		if (key === seen) return;
		seen = key;
		provider = s.provider;
		openaiBase = s.openai.baseUrl;
		audioBase = s.openaiAudio.baseUrl;
		languages = [...s.languages];
		zone = data.generalTimezone;
	});

	const isOpenAI = (url: string) => {
		try {
			return /(^|\.)openai\.com$/.test(new URL(url).hostname);
		} catch {
			return false;
		}
	};

	let busy = $state<'save' | 'test' | null>(null);
	let saved = $state(false);
	// Anything typed since the last test or save
	let stale = $state(false);

	const test = $derived(form?.action === 'test' && 'test' in form ? form.test : null);
	// Field errors from a save or test that failed validation, and the field a failed test names
	const errors = $derived.by<Record<string, string>>(() => {
		if (busy) return {};
		const out: Record<string, string> =
			form && 'errors' in form && form.errors ? { ...form.errors } : {};
		if (test && !test.ok && test.field && !stale) out[test.field] = test.message;
		return out;
	});
	const errId = (key: string) => `${key.replace('.', '-')}-error`;
	const described = (key: string) => (errors[key] ? errId(key) : undefined);

	let langInput = $state('');
	let langError = $state('');
	function addLanguage() {
		const code = langInput.trim().toLowerCase();
		if (!code) return;
		if (!isLanguageCode(code)) {
			langError = `${code} is not an ISO 639-1 code such as sw or en.`;
			return;
		}
		if (!languages.includes(code)) languages = [...languages, code];
		langInput = '';
		langError = '';
	}
	const langPlaceholder = $derived(
		['sw', 'fr', 'de', 'ar'].find((c) => !languages.includes(c)) ?? ''
	);

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
			stale = false;
			busy = null;
		};
	};
	const touched = () => {
		stale = true;
		saved = false;
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
	const READY_LABEL = { ok: 'Key set', lost: 'Key unreadable', missing: 'No key' } as const;
	const READY_TONE = { ok: 'ok', lost: 'err', missing: 'idle' } as const;

	// Wall clock in the picked zone, so a wrong pick shows at once
	let now = $state(new Date());
	onMount(() => {
		const t = setInterval(() => (now = new Date()), 30_000);
		return () => clearInterval(t);
	});
	const clock = $derived.by(() => {
		try {
			return formatDate(now, 'HH:mm ddd', zone || 'UTC');
		} catch {
			return '';
		}
	});
</script>

<PageHead title="Transcription" />

{#if errors.provider}
	<p class="hk-banner hk-banner--err" role="alert">{errors.provider}</p>
{/if}

<form
	method="POST"
	action="?/save"
	use:enhance={submit}
	class="hk-fields"
	oninput={touched}
	onchange={touched}
>
	<fieldset>
		<legend class="hk-field-label">Provider</legend>
		<div class="providers">
			{#each data.providers as p (p.id)}
				{@const ready = data.ready[p.id]}
				<label class="hk-option">
					<input type="radio" name="provider" value={p.id} bind:group={provider} />
					<span class="opt">
						<span>{p.label}</span>
						<span class="opt-model">
							{#if ready}
								<Signal tone={READY_TONE[ready]} label={READY_LABEL[ready]} hideLabel />
							{/if}
							<span class="hk-mono">{modelOf(p.id) || hostOf(s.whisperCpp.url)}</span>
						</span>
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
					aria-describedby={described('openai.baseUrl')}
				/>
				{#if errors['openai.baseUrl']}<p class="hk-field-error" id={errId('openai.baseUrl')}>
						{errors['openai.baseUrl']}
					</p>{/if}
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
					aria-invalid={!!errors['openai.model'] || undefined}
					aria-describedby={described('openai.model')}
				/>
				{#if errors['openai.model']}<p class="hk-field-error" id={errId('openai.model')}>
						{errors['openai.model']}
					</p>{/if}
			</div>
		</div>
		<div>
			<SecretField
				id="openai-key"
				name="openai.apiKey"
				label="API key"
				set={data.keysSet.openai}
				lost={data.keysLost.openai}
				env={data.envLocks.openaiKey && isOpenAI(openaiBase) ? 'OPENAI_API_KEY' : null}
				invalid={!!errors['openai.apiKey']}
				describedby={described('openai.apiKey')}
				clearable
			/>
			{#if errors['openai.apiKey']}<p class="hk-field-error" id={errId('openai.apiKey')}>
					{errors['openai.apiKey']}
				</p>{/if}
		</div>
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
					aria-describedby={described('openaiAudio.baseUrl')}
				/>
				{#if errors['openaiAudio.baseUrl']}<p
						class="hk-field-error"
						id={errId('openaiAudio.baseUrl')}
					>
						{errors['openaiAudio.baseUrl']}
					</p>{/if}
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
					aria-invalid={!!errors['openaiAudio.model'] || undefined}
					aria-describedby={described('openaiAudio.model')}
				/>
				{#if errors['openaiAudio.model']}<p class="hk-field-error" id={errId('openaiAudio.model')}>
						{errors['openaiAudio.model']}
					</p>{/if}
			</div>
		</div>
		<div>
			<SecretField
				id="audio-key"
				name="openaiAudio.apiKey"
				label="API key"
				set={data.keysSet.openaiAudio}
				lost={data.keysLost.openaiAudio}
				env={data.envLocks.openaiKey && isOpenAI(audioBase) ? 'OPENAI_API_KEY' : null}
				invalid={!!errors['openaiAudio.apiKey']}
				describedby={described('openaiAudio.apiKey')}
				clearable
			/>
			{#if errors['openaiAudio.apiKey']}<p class="hk-field-error" id={errId('openaiAudio.apiKey')}>
					{errors['openaiAudio.apiKey']}
				</p>{/if}
		</div>
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
				aria-invalid={!!errors['gemini.model'] || undefined}
				aria-describedby={described('gemini.model')}
			/>
			{#if errors['gemini.model']}<p class="hk-field-error" id={errId('gemini.model')}>
					{errors['gemini.model']}
				</p>{/if}
		</div>
		<div>
			<SecretField
				id="gemini-key"
				name="gemini.apiKey"
				label="API key"
				set={data.keysSet.gemini}
				lost={data.keysLost.gemini}
				env={data.envLocks.geminiKey ? 'GEMINI_API_KEY' : null}
				invalid={!!errors['gemini.apiKey']}
				describedby={described('gemini.apiKey')}
				clearable
			/>
			{#if errors['gemini.apiKey']}<p class="hk-field-error" id={errId('gemini.apiKey')}>
					{errors['gemini.apiKey']}
				</p>{/if}
		</div>
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
				aria-describedby={described('whisperCpp.url')}
			/>
			{#if errors['whisperCpp.url']}<p class="hk-field-error" id={errId('whisperCpp.url')}>
					{errors['whisperCpp.url']}
				</p>{/if}
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
						onclick={() => {
							languages = languages.filter((l) => l !== code);
							touched();
						}}
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
					placeholder={langPlaceholder}
					maxlength="3"
					size="4"
					autocomplete="off"
					spellcheck="false"
					bind:value={langInput}
					aria-invalid={!!(langError || errors.languages) || undefined}
					aria-describedby={langError || errors.languages ? 'languages-error' : undefined}
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
		{#if langError || errors.languages}<p class="hk-field-error" id="languages-error">
				{langError || errors.languages}
			</p>{/if}
	</div>

	<div>
		<label class="hk-field-label" for="prompt">Prompt</label>
		<textarea
			id="prompt"
			name="prompt"
			class="hk-textarea"
			rows="4"
			placeholder="Amina, Juma, Kilimani">{s.prompt}</textarea
		>
	</div>

	<label class="hk-check">
		<input type="checkbox" name="chunking" checked={s.chunking} />
		Split audio over {data.chunkSeconds} s at pauses
	</label>

	<hr class="hk-rule" />

	<div>
		<label class="hk-field-label" for="timezone">Timezone</label>
		<div class="tz">
			<select
				id="timezone"
				name="timezone"
				class="hk-select"
				bind:value={zone}
				aria-invalid={!!errors.timezone || undefined}
				aria-describedby={described('timezone')}
			>
				{#each data.timeZones as z (z)}
					<option value={z}>{z.replaceAll('_', ' ')}{z === data.envTimezone ? ' · TZ' : ''}</option>
				{/each}
			</select>
			<span class="clock hk-mono">{clock}</span>
		</div>
		{#if errors.timezone}<p class="hk-field-error" id={errId('timezone')}>{errors.timezone}</p>{/if}
	</div>

	<div class="buttons">
		<button class="hk-btn" aria-busy={busy === 'save'} disabled={busy === 'save'}>
			{busy === 'save' ? 'Saving…' : saved ? 'Saved' : 'Save'}
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
			{#if !busy && test && (test.ok || !test.field)}
				<TestResult result={test} {stale}>
					{#if test.ok}<span class="hk-num">{formatElapsed(test.ms)}</span>{/if}
				</TestResult>
			{/if}
		</span>
		<span class="hk-sr" aria-live="polite">{saved ? 'Saved' : ''}</span>
	</div>
	{#if !busy && test?.ok && !stale}
		<p class="probe">
			<q>{test.text}</q>
			{#each test.languages as code (code)}
				<span class="hk-badge hk-badge--mono" title={languageName(code)}>{code}</span>
			{/each}
		</p>
	{/if}
</form>

<style>
	.tz {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.tz .hk-select {
		flex: 1;
		min-width: 0;
	}
	.clock {
		flex: none;
		font-size: 0.8125rem;
		color: var(--hk-text-3);
	}
	.probe {
		margin: -0.5rem 0 0;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.375rem;
		font-size: 0.9375rem;
		color: var(--hk-text);
	}
	.probe q {
		margin-right: 0.25rem;
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
		display: flex;
		align-items: center;
		gap: 0.375rem;
		min-width: 0;
		font-size: 0.75rem;
		font-weight: 400;
		color: var(--hk-text-3);
		overflow: hidden;
		white-space: nowrap;
	}
	.opt-model .hk-mono {
		overflow: hidden;
		text-overflow: ellipsis;
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
</style>
