<script lang="ts">
	/* A stored secret never reaches the browser. Each state shows where the value comes from:
	   Stored, From VAR, Unreadable, or the input. A blank submit keeps the stored value. `env`
	   names the variable used while nothing is stored; a stored value overrides it. Remove
	   previews the state the field will have after save */
	import Icon from './Icon.svelte';
	import Signal from './Signal.svelte';

	interface Props {
		id: string;
		name: string;
		label: string;
		/** A value is stored */
		set: boolean;
		/** The stored value no key in AUTH_SECRET opens */
		lost?: boolean;
		/** Env variable used when nothing is stored */
		env?: string | null;
		invalid?: boolean;
		/** id of the field error under it */
		describedby?: string;
		/** Posted as `<name>.clear=1` when Remove is pressed */
		clearable?: boolean;
		placeholder?: string;
		/** id of the form the inputs post with, when they sit outside it */
		form?: string;
	}
	let {
		id,
		name,
		label,
		set,
		lost = false,
		env = null,
		invalid = false,
		describedby,
		clearable = false,
		placeholder = 'Not set',
		form
	}: Props = $props();

	let replacing = $state(false);
	let cleared = $state(false);
	let input = $state<HTMLInputElement>();

	// A save that stores or drops the value shows the new state instead of the input
	let lastSet: boolean | undefined;
	$effect.pre(() => {
		if (lastSet !== undefined && set !== lastSet) {
			replacing = false;
			cleared = false;
		}
		lastSet = set;
	});
	// A field marked invalid opens the input, so the error sits under something to fix
	$effect.pre(() => {
		if (invalid && !set) replacing = true;
	});

	async function replace() {
		replacing = true;
		await Promise.resolve();
		input?.focus();
	}
</script>

<div>
	<label class="hk-field-label" for={id}>{label}</label>
	{#if lost && !replacing}
		<div class="state" aria-describedby={describedby}>
			<span class="grow" {id}><Signal tone="err" label="Unreadable" /></span>
			<button type="button" class="hk-btn-ghost hk-btn-sm" onclick={replace}>Replace</button>
		</div>
	{:else if env && !set && !replacing}
		<div class="state">
			<Icon name="lock" />
			<span class="grow" {id} title={env}>Set on the server</span>
			<button type="button" class="hk-btn-ghost hk-btn-sm" onclick={replace}>Replace</button>
		</div>
	{:else if set && !replacing && !cleared}
		<div class="state">
			<span class="grow" {id}>
				<Signal tone="ok" label="Stored" />
				{#if env}<s class="over" title="{env} not used">server value</s>{/if}
			</span>
			<button type="button" class="hk-btn-ghost hk-btn-sm" onclick={replace}>Replace</button>
			{#if clearable}
				<button type="button" class="hk-btn-ghost hk-btn-sm" onclick={() => (cleared = true)}
					>Remove</button
				>
			{/if}
		</div>
	{:else if cleared}
		<input type="hidden" name="{name}.clear" value="1" {form} />
		<div class="state">
			<span class="after grow" {id}>
				{#if env}
					<Icon name="lock" />
					<span title={env}>Set on the server</span>
				{:else}
					<Signal tone="idle" label="Not set" />
				{/if}
			</span>
			<button type="button" class="hk-btn-ghost hk-btn-sm" onclick={() => (cleared = false)}
				>Undo</button
			>
		</div>
	{:else}
		<div class="row">
			<input
				bind:this={input}
				{id}
				{name}
				{form}
				class="hk-input hk-mono"
				type="password"
				autocomplete="off"
				spellcheck="false"
				aria-invalid={invalid || undefined}
				aria-describedby={describedby}
				{placeholder}
			/>
			{#if replacing && (set || env || lost)}
				<button type="button" class="hk-btn-ghost hk-btn-sm" onclick={() => (replacing = false)}
					>Cancel</button
				>
			{/if}
		</div>
	{/if}
</div>

<style>
	.state {
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
	.state :global(svg) {
		color: var(--hk-text-3);
	}
	.grow {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.after {
		opacity: 0.55;
	}
	.over {
		font-size: 0.8125rem;
		text-decoration-thickness: 1px;
		color: var(--hk-text-3);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
</style>
