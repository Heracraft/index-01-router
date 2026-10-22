<script lang="ts">
	/* Native <dialog> with showModal(): focus trap, Escape and the inert page come from the
	   browser. Backdrop click closes. Ported from the kit's reference Modal. */
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	interface Props {
		open: boolean;
		title: string;
		children: Snippet;
		footer?: Snippet;
		size?: 'sm' | 'md' | 'lg';
		onclose?: () => void;
	}

	let { open = $bindable(false), title, children, footer, size = 'md', onclose }: Props = $props();

	const uid = $props.id();
	let dialog: HTMLDialogElement;

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
			const field = dialog.querySelector<HTMLElement>(
				'.hk-modal-body :is(input:not([type=hidden]), textarea, select)'
			);
			field?.focus();
		} else if (!open && dialog.open) dialog.close();
	});

	const FOCUSABLE =
		'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'Tab') return;
		const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
			(el) => el.offsetParent !== null || el === document.activeElement
		);
		if (!items.length) return;
		const first = items[0];
		const last = items[items.length - 1];
		const at = document.activeElement;
		if (e.shiftKey && (at === first || at === dialog)) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && at === last) {
			e.preventDefault();
			first.focus();
		}
	}
</script>

<dialog
	bind:this={dialog}
	class="hk-modal hk-modal--{size}"
	aria-labelledby="{uid}-title"
	onclose={() => {
		open = false;
		onclose?.();
	}}
	onclick={(e) => {
		if (e.target === dialog) open = false;
	}}
	onkeydown={onKeydown}
>
	<div class="hk-modal-head">
		<h2 class="hk-modal-title" id="{uid}-title">{title}</h2>
		<button type="button" class="x" aria-label="Close" onclick={() => (open = false)}>
			<Icon name="close" />
		</button>
	</div>
	<div class="hk-modal-body">{@render children()}</div>
	{#if footer}<div class="hk-modal-foot">{@render footer()}</div>{/if}
</dialog>

<style>
	/* A dialog opened from inside a mono field still reads in the body face */
	dialog {
		font-family: var(--hk-font-sans);
		letter-spacing: normal;
		white-space: normal;
	}
	.x {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		margin-right: -0.375rem;
		border: 0;
		border-radius: var(--hk-radius-6);
		background: none;
		color: var(--hk-text-3);
		cursor: pointer;
		transition:
			color var(--hk-dur-fast) var(--hk-ease),
			background-color var(--hk-dur-fast) var(--hk-ease);
	}
	.x:hover {
		color: var(--hk-text);
		background: var(--hk-hover);
	}
	.hk-modal-body :global(p) {
		margin: 0;
	}
</style>
