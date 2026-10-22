<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import ConfirmAction from '#lib/components/ConfirmAction.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import NotePreview from '#lib/components/NotePreview.svelte';
	import PageHead from '#lib/components/PageHead.svelte';
	import SecretField from '#lib/components/SecretField.svelte';
	import TestResult from '#lib/components/TestResult.svelte';
	import { renderEntry, renderNotePath, renderTemplate } from '#lib/notes/template.ts';
	import { triggerLabel } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const it = $derived(data.integration);
	const isNew = $derived(!it.id);
	// Action URLs keep ?kind= for a new integration; SvelteKit reads the action from the /param
	const q = $derived(isNew ? `?kind=${encodeURIComponent(data.kind.kind)}&` : '?');
	const allTriggers = $derived(it.triggers.length === 0);

	// Fields the preview and the TLS box follow; reset when the stored values change (a save)
	const str = (k: string) => (typeof it.config[k] === 'string' ? (it.config[k] as string) : '');
	let values = $state<Record<string, string>>({});
	let seen = '';
	$effect.pre(() => {
		const key = JSON.stringify(it.config);
		if (key === seen) return;
		seen = key;
		values = Object.fromEntries(
			data.kind.fields
				.filter((f) => f.type !== 'boolean' && f.type !== 'secret')
				.map((f) => [f.key, str(f.key)])
		);
	});
	const showTls = $derived(
		!data.kind.fields.some((f) => f.key === 'insecureTls') ||
			(values.url ?? '').trim().toLowerCase().startsWith('https://')
	);

	let busy = $state<'save' | 'test' | null>(null);
	let saved = $state(false);
	// Anything typed since the last test or save
	let stale = $state(false);
	const submit: SubmitFunction = ({ submitter }) => {
		busy = submitter?.getAttribute('formaction')?.includes('test') ? 'test' : 'save';
		saved = false;
		return async ({ update, result }) => {
			// A test changes nothing stored; reloading would put the stored values back over your edits
			await update({ reset: false, refreshAll: busy !== 'test' });
			saved = busy === 'save' && result.type === 'success';
			stale = false;
			busy = null;
		};
	};
	const touched = () => {
		stale = true;
		saved = false;
	};

	const test = $derived(form?.action === 'test' && 'test' in form ? form.test : null);
	// The error and the field it names, from the last save or test. A test error goes stale with it
	const failure = $derived.by(() => {
		if (!form || busy) return null;
		if (form.action === 'save' && 'error' in form && form.error)
			return { error: form.error, field: 'field' in form ? (form.field ?? null) : null };
		if (form.action === 'test' && test && !test.ok && !stale)
			return { error: test.message, field: 'field' in form ? (form.field ?? null) : null };
		return null;
	});
	// The TLS box is gone for http URLs, so its errors land on the URL
	const errField = $derived(
		failure?.field === 'insecureTls' && !showTls ? 'url' : (failure?.field ?? null)
	);
	const errorFor = (key: string) => (errField === key ? failure!.error : null);
	const looseError = $derived(failure && !errField ? failure.error : null);
	const errId = (key: string) => `${key}-error`;

	// Note preview: rendered with the same code delivery uses, from the latest transcript
	const sampleVars = $derived(
		data.sample
			? {
					...data.sample,
					transcript: data.sample.transcript ?? '',
					recordedAt: new Date(data.sample.recordedAt)
				}
			: {
					recordedAt: new Date(),
					transcript: 'Call the landlord about the plumber.',
					languages: ['en'],
					trigger: 'single-click-hold',
					durationMs: 9000
				}
	);
	const hasPreview = $derived(data.kind.kind === 'obsidian');
	// A blank field saves as its default
	const valueOf = (key: string) =>
		values[key]?.trim()
			? values[key]
			: String(data.kind.fields.find((f) => f.key === key)?.default ?? '');
	const preview = $derived.by(() => {
		const vars = { ...sampleVars, timeZone: data.timezone || 'UTC' };
		let path: string | null = null;
		let pathError: string | null = null;
		try {
			path = renderNotePath(valueOf('notePath'), vars);
		} catch (e) {
			pathError = (e as Error).message;
		}
		const heading = valueOf('heading')
			.trim()
			.replace(/^#+\s*/, '');
		let entry = '';
		let note = '';
		try {
			entry = renderEntry(valueOf('entryTemplate'), vars);
			note = renderTemplate(values.newNoteTemplate ?? '', { ...vars, transcript: '', heading });
		} catch {
			// a bad date token: the bar already shows path errors; the body stays as typed
		}
		const head = note.replace(/\s+$/, '');
		const hasHeading = new RegExp(
			`^#{1,6}\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`,
			'mi'
		).test(head);
		const before = [head, hasHeading ? '' : `${head ? '\n' : ''}## ${heading}`]
			.filter(Boolean)
			.join('\n');
		const start = before ? before.split('\n').length : 0;
		const body = before ? `${before}\n${entry}` : entry;
		return {
			path,
			pathError,
			body,
			entryLines: [start, start + entry.split('\n').length] as [number, number]
		};
	});

	// Delete dialog: what goes with it, then what stays
	const deleteLine = $derived(
		[
			data.deliveryCount === 1
				? '1 delivery record goes with it.'
				: data.deliveryCount > 1
					? `${data.deliveryCount.toLocaleString('en-US')} delivery records go with it.`
					: '',
			'Notes in the vault stay.'
		]
			.filter(Boolean)
			.join(' ')
	);

	// Token chips insert {{token}} at the caret
	const areas: Record<string, HTMLTextAreaElement> = $state({});
	function insert(key: string, token: string) {
		const el = areas[key];
		if (!el) return;
		el.focus();
		el.setRangeText(`{{${token}}}`, el.selectionStart, el.selectionEnd, 'end');
		el.dispatchEvent(new Event('input', { bubbles: true }));
	}
</script>

<nav class="crumbs" aria-label="Breadcrumb">
	<a href={resolve('/(app)/integrations')}><Icon name="arrow-left" />Integrations</a>
</nav>

<PageHead title={isNew ? `New ${data.kind.label} integration` : it.name}>
	{#snippet actions()}
		{#if !isNew}
			<ConfirmAction action="?/delete" label="Delete" title="Delete {it.name}">
				<p>{deleteLine}</p>
			</ConfirmAction>
		{/if}
	{/snippet}
</PageHead>

<form
	method="POST"
	action="{q}/save"
	use:enhance={submit}
	class="hk-fields"
	oninput={touched}
	onchange={touched}
>
	<div>
		<label class="hk-field-label" for="name">Name</label>
		<input
			id="name"
			name="name"
			class="hk-input"
			defaultValue={it.name}
			required
			aria-invalid={!!errorFor('name') || undefined}
			aria-describedby={errorFor('name') ? errId('name') : undefined}
		/>
		{#if errorFor('name')}<p class="hk-field-error" id={errId('name')}>{errorFor('name')}</p>{/if}
	</div>

	<label class="hk-check">
		<input type="checkbox" name="enabled" checked={it.enabled} />
		Enabled
	</label>

	<fieldset aria-describedby={errorFor('triggers') ? errId('triggers') : undefined}>
		<legend class="hk-field-label">Triggers</legend>
		<div class="chips" aria-invalid={!!errorFor('triggers')}>
			{#each data.triggers as t (t)}
				<label class="hk-chip hk-chip--touch">
					<input
						type="checkbox"
						name="triggers"
						value={t}
						checked={allTriggers || it.triggers.includes(t)}
					/>
					{triggerLabel(t)}
				</label>
			{/each}
		</div>
		{#if errorFor('triggers')}
			<p class="hk-field-error" id={errId('triggers')}>{errorFor('triggers')}</p>
		{/if}
	</fieldset>

	<hr class="hk-rule" />

	{#each data.kind.fields as f (f.key)}
		{@const id = `f-${f.key}`}
		{@const value = it.config[f.key]}
		{@const err = errorFor(f.key)}
		{#if f.type === 'secret'}
			<div>
				<SecretField
					{id}
					name="config.{f.key}"
					label={f.label}
					set={!!it.secretsSet[f.key]}
					lost={!!it.secretsLost[f.key]}
					invalid={!!err}
					describedby={err ? errId(f.key) : undefined}
					placeholder={f.placeholder}
				/>
				{#if err}<p class="hk-field-error" id={errId(f.key)}>{err}</p>{/if}
			</div>
		{:else if f.type === 'boolean'}
			{#if f.key !== 'insecureTls' || showTls}
				<div>
					<label class="hk-check">
						<input
							type="checkbox"
							name="config.{f.key}"
							checked={value === true}
							aria-invalid={!!err || undefined}
							aria-describedby={err ? errId(f.key) : undefined}
						/>
						{f.label}
					</label>
					{#if err}<p class="hk-field-error" id={errId(f.key)}>{err}</p>{/if}
				</div>
			{/if}
		{:else}
			{@const pathBad = f.key === 'notePath' && !!preview.pathError}
			<div>
				<label class="hk-field-label" for={id}>{f.label}</label>
				{#if f.type === 'textarea'}
					<textarea
						{id}
						bind:this={areas[f.key]}
						name="config.{f.key}"
						class="hk-textarea hk-mono"
						rows="3"
						spellcheck="false"
						placeholder={f.placeholder}
						bind:value={values[f.key]}
						aria-invalid={!!err || undefined}
						aria-describedby={err ? errId(f.key) : undefined}></textarea>
					{#if f.tokens?.length}
						<div class="tokens">
							{#each f.tokens as token (token)}
								<button
									type="button"
									class="hk-chip hk-mono token"
									onclick={() => insert(f.key, token)}>{token}</button
								>
							{/each}
						</div>
					{/if}
				{:else}
					<input
						{id}
						name="config.{f.key}"
						class="hk-input"
						class:hk-mono={f.type === 'url' || f.key.toLowerCase().includes('path')}
						type={f.type === 'url' ? 'url' : 'text'}
						spellcheck="false"
						placeholder={f.placeholder}
						bind:value={values[f.key]}
						aria-invalid={!!err || pathBad || undefined}
						aria-describedby={err ? errId(f.key) : pathBad ? 'notepath-preview' : undefined}
					/>
				{/if}
				{#if err}<p class="hk-field-error" id={errId(f.key)}>{err}</p>{/if}
				{#if hasPreview && f.key === 'newNoteTemplate'}
					<div class="preview">
						<NotePreview
							path={preview.path}
							pathError={preview.pathError}
							barId="notepath-preview"
							body={preview.body}
							entryLines={preview.entryLines}
						/>
					</div>
				{/if}
			</div>
		{/if}
	{/each}

	<div class="buttons">
		<button class="hk-btn" aria-busy={busy === 'save'} disabled={busy === 'save'}>
			{busy === 'save' ? 'Saving…' : isNew ? 'Create integration' : saved ? 'Saved' : 'Save'}
		</button>
		<button
			class="hk-btn-secondary"
			formaction="{q}/test"
			disabled={!!busy}
			aria-busy={busy === 'test'}
		>
			{busy === 'test' ? 'Testing…' : 'Test connection'}
		</button>
		<span class="result" role="status">
			{#if busy === null && looseError}
				<span class="bad">{looseError}</span>
			{:else if busy === null && test && (test.ok || !errField)}
				<TestResult result={test} {stale}>
					{#if test.ok}
						<span class="hk-mono">{test.target}</span>
						<span class="muted"
							>· {test.state === 'heading'
								? `## ${test.heading} found`
								: test.state === 'note'
									? `no ## ${test.heading} yet`
									: 'new note'}</span
						>
					{/if}
				</TestResult>
			{/if}
		</span>
		<span class="hk-sr" aria-live="polite">{saved ? 'Saved' : ''}</span>
	</div>
</form>

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
	fieldset {
		border: 0;
		margin: 0;
		padding: 0;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.tokens {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		margin-top: 0.5rem;
	}
	.token {
		height: 1.5rem;
		font-size: 0.6875rem;
		font-weight: 400;
	}
	.preview {
		margin-top: 0.75rem;
	}
	.muted {
		color: var(--hk-text-3);
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
		min-width: 0;
	}
	.bad {
		color: var(--hk-err);
	}
</style>
