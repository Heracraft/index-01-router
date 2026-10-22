<script lang="ts">
	/* One daily note target: on/off, the note as today's entry would land, where and how it
	   writes, and the Obsidian connection folded to one health fact */
	import ConfirmAction from './ConfirmAction.svelte';
	import Icon from './Icon.svelte';
	import SaveBar from './SaveBar.svelte';
	import SecretField from './SecretField.svelte';
	import Switch from './Switch.svelte';
	import TestResult from './TestResult.svelte';
	import { enhance } from '$app/forms';
	import { sectionSubmit, type SectionResult } from './section-submit.ts';
	import type { DirtyForms } from './dirty.svelte.ts';
	import { renderEntry, renderNotePath } from '#lib/notes/template.ts';
	import { parseNote } from '#lib/notes/sheet.ts';
	import { dayKey, formatDateTime, formatTime, triggerLabel } from '#lib/format.ts';
	import type { FieldSpec } from '#lib/server/integrations/types.ts';

	interface Note {
		id: string | null;
		name: string;
		enabled: boolean;
		triggers: string[];
		config: Record<string, unknown>;
		secretsSet: Record<string, boolean>;
		secretsLost: Record<string, boolean>;
		envSet: Record<string, string>;
		envValues: Record<string, string>;
		kind: { kind: string; fields: FieldSpec[] };
		lastSent: Date | null;
		lastFailed: { at: Date; error: string | null } | null;
	}
	interface Props {
		note: Note;
		triggers: readonly string[];
		sample: {
			recordedAt: Date;
			transcript: string | null;
			languages: string[];
			trigger: string;
			durationMs: number | null;
		} | null;
		timezone: string;
		dirty: DirtyForms;
		/** Several integrations: show each one's name as its heading */
		named: boolean;
		oncancel?: () => void;
	}
	let { note, triggers, sample, timezone, dirty, named, oncancel }: Props = $props();

	const isNew = $derived(!note.id);
	const key = $derived(`note-${note.id ?? 'new'}`);
	const allTriggers = $derived(note.triggers.length === 0);
	const fieldOf = (k: string) => note.kind.fields.find((f) => f.key === k);

	// Editable values the preview follows; reset when the stored values change (a save)
	const str = (k: string) => (typeof note.config[k] === 'string' ? (note.config[k] as string) : '');
	let values = $state<Record<string, string>>({});
	let urlOpen = $state(false);
	let seen = '';
	$effect.pre(() => {
		const k = JSON.stringify(note.config);
		if (k === seen) return;
		seen = k;
		values = Object.fromEntries(
			note.kind.fields
				.filter((f) => f.type !== 'boolean' && f.type !== 'secret')
				.map((f) => [f.key, str(f.key)])
		);
		urlOpen = !!str('url');
	});
	const valueOf = (k: string) =>
		values[k]?.trim() ? values[k]! : String(fieldOf(k)?.default ?? '');

	let result = $state<SectionResult>(null);
	let busy = $state<'save' | 'test' | null>(null);
	let stale = $state(false);
	const submit = $derived(
		sectionSubmit(dirty, key, {
			start: (test) => {
				busy = test ? 'test' : 'save';
				if (!test) result = null;
			},
			result: (data) => {
				result = data;
				stale = false;
				busy = null;
			}
		})
	);
	$effect(() => {
		// A save or test that never reaches result (redirect, error) still frees the buttons
		if (!dirty.busy && busy === 'save') busy = null;
	});

	const test = $derived(
		result?.action === 'noteTest' && result.test
			? (result.test as
					| { ok: true; target: string; state: string; heading: string }
					| { ok: false; message: string })
			: null
	);
	const failure = $derived.by(() => {
		if (!result || busy) return null;
		if (result.action === 'note' && result.error)
			return { error: String(result.error), field: (result.field as string | null) ?? null };
		if (test && !test.ok && !stale)
			return { error: test.message, field: (result.field as string | null) ?? null };
		return null;
	});
	const errorFor = (k: string) => (failure?.field === k ? failure.error : null);
	const looseError = $derived(failure && !failure.field ? failure.error : null);

	// Preview: today's entry, rendered by the code delivery uses
	const now = new Date();
	// The path is today's; the line uses the newest recording's own time, so it does not tick
	const vars = $derived({
		recordedAt: sample?.recordedAt ? new Date(sample.recordedAt) : now,
		timeZone: timezone || 'UTC',
		transcript: sample?.transcript?.trim() || 'Call the landlord about the plumber.',
		languages: sample?.languages ?? ['en'],
		trigger: sample?.trigger ?? 'single-click-hold',
		durationMs: sample?.durationMs ?? 9000
	});
	const preview = $derived.by(() => {
		let path: string | null = null;
		let pathError: string | null = null;
		try {
			path = renderNotePath(valueOf('notePath'), { ...vars, recordedAt: now });
		} catch (e) {
			pathError = (e as Error).message;
		}
		const heading = valueOf('heading')
			.trim()
			.replace(/^#+\s*/, '');
		let entry = '';
		try {
			entry = renderEntry(valueOf('entryTemplate'), vars);
		} catch {
			// a bad date token: the path line shows path errors; the body stays as typed
		}
		// The bar names the note and its heading; the body is the line alone, as it would read
		return {
			path,
			pathError,
			heading,
			entry: parseNote(entry).filter((b) => b.type !== 'heading')
		};
	});

	const edited = $derived(
		['notePath', 'heading', 'entryTemplate'].some((k) => (values[k] ?? '') !== str(k))
	);
	const whenFact = (d: Date) =>
		dayKey(d, timezone) === dayKey(now, timezone)
			? formatTime(d, timezone)
			: formatDateTime(d, timezone);
	const failing = $derived(
		!!note.lastFailed && (!note.lastSent || note.lastFailed.at > note.lastSent)
	);
	const lostKey = $derived(Object.values(note.secretsLost).some(Boolean));
	// Connection opens itself when something in it needs a look, and otherwise stays as you left
	// it, so a check's result does not fold away
	const mustOpen = $derived(isNew || !!errorFor('url') || !!errorFor('apiKey') || lostKey);
	let connOpen = $state(false);
	$effect.pre(() => {
		if (mustOpen) connOpen = true;
	});

	// Token inserts at the caret
	const areas: Record<string, HTMLTextAreaElement | HTMLInputElement> = $state({});
	function insert(k: string, token: string) {
		const el = areas[k];
		if (!el) return;
		el.focus();
		el.setRangeText(`{{${token}}}`, el.selectionStart ?? 0, el.selectionEnd ?? 0, 'end');
		el.dispatchEvent(new Event('input', { bubbles: true }));
	}
	const tokenLabel = (t: string) => t.split(':')[0];

	const showTls = $derived(
		(values.url?.trim() || note.envValues.url || '').toLowerCase().startsWith('https://')
	);
	const formId = $derived(`f-${key}`);
	let enabled = $state(false);
	let seenEnabled: boolean | undefined;
	$effect.pre(() => {
		if (note.enabled === seenEnabled) return;
		seenEnabled = note.enabled;
		enabled = note.enabled;
	});
</script>

<section class="sset" id={note.id ? `note-${note.id}` : 'note-new'} aria-label={note.name}>
	<div class="sset-h">
		<div class="sec-h title">
			<input
				id="{key}-name"
				class="title-in"
				name="name"
				form={formId}
				value={note.name}
				required
				spellcheck="false"
				autocomplete="off"
				aria-label="Name"
				aria-invalid={!!errorFor('name') || undefined}
			/>
		</div>
		<span class="sset-a">
			<Switch
				id="{key}-on"
				name="enabled"
				form={formId}
				bind:checked={enabled}
				label="Write to this note"
			/>
		</span>
	</div>
	{#if errorFor('name')}<p class="f-err">{errorFor('name')}</p>{/if}

	<form
		id={formId}
		method="POST"
		action="/settings?/note"
		use:enhance={submit}
		use:dirty.track={{ key, label: named ? note.name : 'Daily note' }}
		oninput={() => (stale = true)}
	>
		<input type="hidden" name="id" value={note.id ?? 'new'} />
		{#if isNew}<input type="hidden" name="kind" value={note.kind.kind} />{/if}

		<div class="fgrid">
			<div class="f">
				<label class="hk-field-label" for="{key}-path">Note</label>
				<input
					id="{key}-path"
					name="config.notePath"
					class="hk-input hk-mono"
					spellcheck="false"
					placeholder={String(fieldOf('notePath')?.default ?? '')}
					bind:value={values.notePath}
					aria-invalid={!!errorFor('notePath') || !!preview.pathError || undefined}
				/>
				{#if errorFor('notePath')}<p class="f-err">{errorFor('notePath')}</p>{/if}
			</div>
			<div class="f">
				<label class="hk-field-label" for="{key}-heading">Under heading</label>
				<input
					id="{key}-heading"
					name="config.heading"
					class="hk-input"
					placeholder={String(fieldOf('heading')?.default ?? '')}
					bind:value={values.heading}
					aria-invalid={!!errorFor('heading') || undefined}
				/>
				{#if errorFor('heading')}<p class="f-err">{errorFor('heading')}</p>{/if}
			</div>
		</div>
		<div class="f">
			<label class="hk-field-label" for="{key}-entry">Line</label>
			<input
				id="{key}-entry"
				bind:this={areas.entryTemplate}
				name="config.entryTemplate"
				class="hk-input hk-mono"
				spellcheck="false"
				autocomplete="off"
				bind:value={values.entryTemplate}
				aria-invalid={!!errorFor('entryTemplate') || undefined}
			/>
			<div class="tokens" aria-label="Insert">
				{#each fieldOf('entryTemplate')?.tokens ?? [] as t (t)}
					<button type="button" onclick={() => insert('entryTemplate', t)}
						><b>+</b> {tokenLabel(t)}</button
					>
				{/each}
			</div>
			{#if errorFor('entryTemplate')}<p class="f-err">{errorFor('entryTemplate')}</p>{/if}
		</div>

		<article class="sheet sheet--sm preview" aria-label="Preview">
			<div class="sheet-bar">
				<span class="path-s">
					{#if lostKey}
						<span class="ring-err" aria-hidden="true"></span><span class="bad"
							>API key unreadable</span
						>
					{:else if failing && preview.path}
						<span class="ring-warn" aria-hidden="true"></span><span class="path"
							>{preview.path}{#if preview.heading}<span class="path-h"
									>{` › ${preview.heading}`}</span
								>{/if}</span
						><span class="since">No answer since {whenFact(note.lastFailed!.at)}</span>
					{:else if preview.path}
						<!-- The check says the note takes lines as saved; an unsaved change is only a preview -->
						{#if !edited}<Icon name="check" size={14} class="ok-check" />{/if}<span class="path"
							>{preview.path}{#if preview.heading}<span class="path-h"
									>{` › ${preview.heading}`}</span
								>{/if}</span
						>
					{:else}
						<span class="ring-err" aria-hidden="true"></span><span class="bad"
							>{preview.pathError}</span
						>
					{/if}
				</span>
			</div>
			<div class="sheet-body">
				<ul class="notes">
					{#each preview.entry as b, i (i)}
						<li class="e">
							<span class="e-t">{b.time ?? ''}</span>
							<div class="e-b"><p class="e-x">{b.text}</p></div>
						</li>
					{/each}
				</ul>
			</div>
		</article>

		<div class="f">
			<label class="hk-field-label" for="{key}-new">New note starts with</label>
			<textarea
				id="{key}-new"
				bind:this={areas.newNoteTemplate}
				name="config.newNoteTemplate"
				class="hk-textarea hk-mono grow-ta"
				rows={Math.max(1, (values.newNoteTemplate ?? '').replace(/\n+$/, '').split('\n').length)}
				spellcheck="false"
				bind:value={values.newNoteTemplate}></textarea>
			<div class="tokens" aria-label="Insert">
				{#each fieldOf('newNoteTemplate')?.tokens ?? [] as t (t)}
					<button type="button" onclick={() => insert('newNoteTemplate', t)}
						><b>+</b> {tokenLabel(t)}</button
					>
				{/each}
			</div>
		</div>
		<fieldset class="f trig">
			<legend class="hk-field-label">Recordings from</legend>
			<div class="chips">
				{#each triggers as t (t)}
					<label class="tchip">
						<input
							type="checkbox"
							name="triggers"
							value={t}
							checked={allTriggers || note.triggers.includes(t)}
						/>
						<Icon name="check" size={14} />{triggerLabel(t)}
					</label>
				{/each}
			</div>
			{#if errorFor('triggers')}<p class="f-err">{errorFor('triggers')}</p>{/if}
		</fieldset>
	</form>

	<!-- Connection: outside the form so Remove can sit in it; its fields post with the form -->
	<details class="sub-det" bind:open={connOpen} oninput={() => (stale = true)}>
		<summary>
			Connection
			<span class="sum-v">
				{#if lostKey}
					<span class="dot err" aria-hidden="true"></span>Key unreadable
				{:else if failing}
					<span class="dot warn" aria-hidden="true"></span>No answer since {whenFact(
						note.lastFailed!.at
					)}
				{:else if note.lastSent}
					<span class="dot" aria-hidden="true"></span>Obsidian answered {whenFact(note.lastSent)}
				{:else}
					<span class="dot idle" aria-hidden="true"></span>Nothing sent yet
				{/if}
			</span>
			<Icon name="chevron" />
		</summary>
		<div class="sub-body">
			<div class="f">
				<label class="hk-field-label" for="{key}-url">MCP URL</label>
				{#if note.envValues.url && !urlOpen}
					<div class="locked">
						<Icon name="lock" />
						<span class="grow" title={note.envSet.url}>Set on the server</span>
						<span class="hk-mono lv">{note.envValues.url}</span>
						<button type="button" class="hk-btn-ghost hk-btn-sm" onclick={() => (urlOpen = true)}
							>Replace</button
						>
					</div>
					<input type="hidden" name="config.url" value="" form={formId} />
				{:else}
					<input
						id="{key}-url"
						name="config.url"
						form={formId}
						class="hk-input hk-mono"
						type="url"
						spellcheck="false"
						placeholder={note.envValues.url ?? fieldOf('url')?.placeholder}
						bind:value={values.url}
						aria-invalid={!!errorFor('url') || undefined}
					/>
				{/if}
				{#if errorFor('url')}<p class="f-err">{errorFor('url')}</p>{/if}
			</div>
			<div class="f">
				<SecretField
					id="{key}-key"
					name="config.apiKey"
					form={formId}
					label="API key"
					set={!!note.secretsSet.apiKey}
					lost={!!note.secretsLost.apiKey}
					env={note.envSet.apiKey ?? null}
					clearable={!!note.envSet.apiKey}
					invalid={!!errorFor('apiKey')}
					placeholder={fieldOf('apiKey')?.placeholder}
				/>
				{#if errorFor('apiKey')}<p class="f-err">{errorFor('apiKey')}</p>{/if}
			</div>
			{#if showTls || note.config.insecureTls === true}
				<label class="hk-check tls">
					<input
						type="checkbox"
						name="config.insecureTls"
						form={formId}
						checked={note.config.insecureTls === true}
					/>
					Accept a self-signed certificate
				</label>
				{#if errorFor('insecureTls')}<p class="f-err">{errorFor('insecureTls')}</p>{/if}
			{/if}
			<div class="actrow">
				<button
					class="hk-btn-secondary hk-btn-sm"
					form={formId}
					formaction="/settings?/noteTest"
					disabled={!!busy}
					aria-busy={busy === 'test'}>{busy === 'test' ? 'Checking…' : 'Check connection'}</button
				>
				<span class="result" role="status">
					{#if !busy && looseError}
						<span class="bad">{looseError}</span>
					{:else if !busy && test && (test.ok || !failure?.field)}
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
				{#if !isNew}
					<ConfirmAction
						action="/settings?/noteDelete"
						fields={{ id: note.id ?? '' }}
						label="Remove"
						icon="trash"
						title="Remove {note.name}"
						confirmLabel="Remove"
						triggerClass="hk-btn-ghost hk-btn-sm quiet-danger"
					>
						<p>Notes in the vault stay.</p>
					</ConfirmAction>
				{/if}
			</div>
		</div>
	</details>
	{#if !isNew}
		<SaveBar {dirty} keys={[key]} />
	{/if}
	{#if isNew}
		<div class="actrow">
			<button class="hk-btn hk-btn-sm" form={formId} disabled={busy === 'save'}
				>{busy === 'save' ? 'Adding…' : 'Add note'}</button
			>
			<button type="button" class="hk-btn-ghost hk-btn-sm" onclick={() => oncancel?.()}
				>Cancel</button
			>
		</div>
	{/if}
</section>

<style>
	.preview .notes {
		margin: 0;
	}
	/* As tall as its lines (a trailing newline adds none), from one: a one-line value sits like
	   the inputs above it */
	textarea.grow-ta {
		min-height: 2.25rem;
		padding-block: 0.4375rem;
		resize: none;
	}
	.trig {
		border: 0;
		padding: 0;
		margin-inline: 0;
	}
	.trig legend {
		padding: 0;
		margin-bottom: 0.375rem;
	}
	.locked {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		height: 2.25rem;
		padding: 0 0.25rem 0 0.75rem;
		border: 1px solid var(--hk-border);
		border-radius: var(--hk-radius);
		background: var(--hk-surface-2);
		font-size: 0.875rem;
		color: var(--hk-text-2);
	}
	.locked :global(svg) {
		color: var(--hk-text-3);
	}
	.grow {
		flex: none;
	}
	.lv {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.75rem;
		color: var(--hk-text-3);
	}
	.tls {
		margin-top: 1rem;
	}
	.bad {
		color: var(--hk-err);
	}
	.sset-a {
		display: inline-flex;
		align-items: center;
		gap: 0.75rem;
	}
	.sub-body :global(.quiet-danger) {
		margin-left: auto;
		color: var(--hk-text-3);
	}
	.sub-body :global(.quiet-danger:hover) {
		color: var(--hk-err);
	}
	/* The name is the title, renamed in place */
	.title {
		flex: 1;
		min-width: 0;
	}
	.title-in {
		width: 100%;
		margin: 0 0 0 -0.375rem;
		padding: 0 0.375rem;
		border: 1px solid transparent;
		border-radius: var(--hk-radius-6);
		background: transparent;
		font: inherit;
		letter-spacing: inherit;
		color: var(--hk-text);
		text-overflow: ellipsis;
	}
	.title-in:hover {
		border-color: var(--hk-border);
	}
	.title-in:focus {
		outline: none;
		border-color: var(--hk-accent);
		background: var(--hk-surface);
	}
	.preview {
		margin-top: 1.25rem;
	}
	.since {
		flex: none;
		color: var(--hk-warn);
	}
	@media (max-width: 639.98px) {
		.lv {
			display: none;
		}
	}
</style>
