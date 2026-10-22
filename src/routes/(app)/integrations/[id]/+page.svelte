<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import ConfirmAction from '#lib/components/ConfirmAction.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import PageHead from '#lib/components/PageHead.svelte';
	import SecretField from '#lib/components/SecretField.svelte';
	import { triggerLabel } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const it = $derived(data.integration);
	const isNew = $derived(!it.id);
	// Action URLs keep ?kind= for a new integration; SvelteKit reads the action from the /param
	const q = $derived(isNew ? `?kind=${encodeURIComponent(data.kind.kind)}&` : '?');
	const allTriggers = $derived(it.triggers.length === 0);

	// Labels named in a save error ("API key required") mark their field
	const saveError = $derived(form?.action === 'save' && 'error' in form ? form.error : null);
	const invalid = (label: string) => !!saveError && saveError.includes(label);

	let busy = $state<'save' | 'test' | null>(null);
	let savedAt = $state(0);
	const submit: SubmitFunction = ({ submitter }) => {
		busy = submitter?.getAttribute('formaction')?.includes('test') ? 'test' : 'save';
		return async ({ update, result }) => {
			// A test changes nothing stored; reloading would put the stored values back over your edits
			await update({ reset: false, refreshAll: busy !== 'test' });
			if (busy === 'save' && result.type === 'success') savedAt = Date.now();
			busy = null;
		};
	};
	const test = $derived(form?.action === 'test' && 'test' in form ? form.test : null);
</script>

<nav class="crumbs" aria-label="Breadcrumb">
	<a href={resolve('/(app)/integrations')}><Icon name="arrow-left" />Integrations</a>
</nav>

<PageHead title={isNew ? `New ${data.kind.label} integration` : it.name}>
	{#snippet actions()}
		{#if !isNew}
			<ConfirmAction action="?/delete" label="Delete" title="Delete integration">
				<p>
					Delete {it.name}? New recordings stop going to it and its delivery history goes too.
				</p>
			</ConfirmAction>
		{/if}
	{/snippet}
</PageHead>

<form method="POST" action="{q}/save" use:enhance={submit} class="hk-fields">
	<div>
		<label class="hk-field-label" for="name">Name</label>
		<input
			id="name"
			name="name"
			class="hk-input"
			defaultValue={it.name}
			required
			aria-invalid={invalid('Name') || undefined}
		/>
	</div>

	<label class="hk-check">
		<input type="checkbox" name="enabled" checked={it.enabled} />
		Enabled
	</label>

	<fieldset>
		<legend class="hk-field-label">Triggers</legend>
		<div
			class="chips"
			aria-invalid={form?.action === 'save' && 'field' in form && form.field === 'triggers'}
		>
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
	</fieldset>

	<hr class="hk-rule" />

	{#each data.kind.fields as f (f.key)}
		{@const id = `f-${f.key}`}
		{@const value = it.config[f.key]}
		{#if f.type === 'secret'}
			<SecretField
				{id}
				name="config.{f.key}"
				label={f.label}
				set={!!it.secretsSet[f.key]}
				invalid={invalid(f.label)}
			/>
		{:else if f.type === 'boolean'}
			<div>
				<label class="hk-check">
					<input type="checkbox" name="config.{f.key}" checked={value === true} />
					{f.label}
				</label>
				{#if f.hint}<p class="hint">{f.hint}</p>{/if}
			</div>
		{:else}
			<div>
				<label class="hk-field-label" for={id}>{f.label}</label>
				{#if f.type === 'textarea'}
					<textarea
						{id}
						name="config.{f.key}"
						class="hk-textarea hk-mono"
						rows="3"
						spellcheck="false"
						aria-invalid={invalid(f.label) || undefined}
						>{typeof value === 'string' ? value : ''}</textarea
					>
				{:else}
					<input
						{id}
						name="config.{f.key}"
						class="hk-input"
						class:hk-mono={f.type === 'url' || f.key.toLowerCase().includes('path')}
						type={f.type === 'url' ? 'url' : 'text'}
						spellcheck="false"
						value={typeof value === 'string' ? value : ''}
						aria-invalid={invalid(f.label) || undefined}
					/>
				{/if}
				{#if f.hint}<p class="hint">{f.hint}</p>{/if}
			</div>
		{/if}
	{/each}

	<div class="buttons">
		<button class="hk-btn" disabled={!!busy} aria-busy={busy === 'save'}>
			{busy === 'save' ? 'Saving…' : isNew ? 'Create integration' : 'Save'}
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
			{#if busy === null && saveError}
				<span class="bad">{saveError}</span>
			{:else if busy === null && test}
				<span class:ok={test.ok} class:bad={!test.ok}>
					<span class="hk-dot" class:hk-dot--ok={test.ok} class:hk-dot--err={!test.ok}></span>
					{test.message}
				</span>
			{:else if busy === null && form?.action === 'save' && 'saved' in form && savedAt}
				<span class="ok">Saved</span>
			{/if}
		</span>
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
	.hint {
		margin: 0.375rem 0 0;
		font-size: 0.75rem;
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
	.result > span {
		display: inline-flex;
		align-items: baseline;
		gap: 0.5rem;
	}
	.result .hk-dot {
		transform: translateY(-1px);
	}
	.ok {
		color: var(--hk-text-2);
	}
	.bad {
		color: var(--hk-err);
	}
</style>
