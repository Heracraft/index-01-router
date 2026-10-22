<script lang="ts">
	/* A button that asks once in a modal, then posts `action`. The title names the target; the
	   body shows real values: what goes, what stays, or the result */
	import type { Snippet } from 'svelte';
	import { enhance } from '$app/forms';
	import Icon, { type IconName } from './Icon.svelte';
	import Modal from './Modal.svelte';

	interface Props {
		action: string;
		/** Trigger button text */
		label: string;
		title: string;
		/** Danger button text in the modal; defaults to `label` */
		confirmLabel?: string;
		/** Hidden inputs posted with the action */
		fields?: Record<string, string>;
		triggerClass?: string;
		/** Class of the confirm button in the modal */
		confirmClass?: string;
		disabled?: boolean;
		size?: 'sm' | 'md' | 'lg';
		/** Icon before the trigger label */
		icon?: IconName;
		children: Snippet;
	}

	let {
		action,
		label,
		title,
		confirmLabel = label,
		fields = {},
		triggerClass = 'hk-btn-danger',
		confirmClass = 'hk-btn-danger solid',
		disabled = false,
		size = 'sm',
		icon,
		children
	}: Props = $props();

	let open = $state(false);
	let busy = $state(false);
</script>

<button type="button" class={triggerClass} {disabled} onclick={() => (open = true)}
	>{#if icon}<Icon name={icon} size={14} />{/if}{label}</button
>

<Modal bind:open {title} {size}>
	{@render children()}
	{#snippet footer()}
		<button type="button" class="hk-btn-ghost" onclick={() => (open = false)}>Cancel</button>
		<form
			method="POST"
			{action}
			use:enhance={() => {
				busy = true;
				return async ({ update }) => {
					await update();
					busy = false;
					open = false;
				};
			}}
		>
			{#each Object.entries(fields) as [name, value] (name)}
				<input type="hidden" {name} {value} />
			{/each}
			<button class={confirmClass} aria-busy={busy} disabled={busy}>
				{busy ? `${confirmLabel}…` : confirmLabel}
			</button>
		</form>
	{/snippet}
</Modal>
