<script lang="ts">
	/* A stored secret never reaches the browser. Saved shows as a state with Replace; a blank
	   submit keeps the stored value. `env` names the variable that supplies it instead. */
	import Icon from './Icon.svelte';

	interface Props {
		id: string;
		name: string;
		label: string;
		/** A value is stored */
		set: boolean;
		/** Env variable that supplies the value; the field is read only */
		env?: string | null;
		invalid?: boolean;
		/** Posted as `<name>.clear=1` when Remove is pressed */
		clearable?: boolean;
		placeholder?: string;
	}
	let {
		id,
		name,
		label,
		set,
		env = null,
		invalid = false,
		clearable = false,
		placeholder = ''
	}: Props = $props();

	let replacing = $state(false);
	let cleared = $state(false);
	let input = $state<HTMLInputElement>();
</script>

<div>
	<label class="hk-field-label" for={id}>{label}</label>
	{#if env && !set}
		<div class="state">
			<Icon name="lock" />
			<span class="grow">From <span class="hk-mono">{env}</span></span>
		</div>
	{:else if set && !replacing && !cleared}
		<div class="state">
			<span class="hk-dot hk-dot--ok" aria-hidden="true"></span>
			<span class="grow" {id}>Saved</span>
			<button
				type="button"
				class="hk-btn-ghost hk-btn-sm"
				onclick={async () => {
					replacing = true;
					await Promise.resolve();
					input?.focus();
				}}>Replace</button
			>
			{#if clearable}
				<button type="button" class="hk-btn-ghost hk-btn-sm" onclick={() => (cleared = true)}
					>Remove</button
				>
			{/if}
		</div>
	{:else if cleared}
		<input type="hidden" name="{name}.clear" value="1" />
		<div class="state">
			<span class="grow">Removed on save</span>
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
				class="hk-input hk-mono"
				type="password"
				autocomplete="off"
				spellcheck="false"
				aria-invalid={invalid || undefined}
				{placeholder}
			/>
			{#if replacing}
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
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
</style>
