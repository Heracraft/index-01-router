<script lang="ts" module>
	export type SignalTone = 'ok' | 'live' | 'busy' | 'warn' | 'err' | 'idle' | 'done';
</script>

<script lang="ts">
	/* A 7px dot plus the value it stands for. Colour in the text only for warn and err */
	import type { Snippet } from 'svelte';

	interface Props {
		tone: SignalTone;
		/** The value shown next to the dot. Also the screen reader text with hideLabel */
		label?: string;
		/** Keep the label for screen readers only */
		hideLabel?: boolean;
		/** Full text on hover, e.g. the delivery error behind "Daily notes" */
		title?: string | null;
		/** Extra muted content after the label, e.g. a mono time */
		children?: Snippet;
	}
	let { tone, label = '', hideLabel = false, title = null, children }: Props = $props();
</script>

<span class="signal signal--{tone}" title={title || undefined}>
	<span class="hk-dot hk-dot--{tone}" aria-hidden="true"></span>
	{#if label}<span class="label" class:hk-sr={hideLabel}>{label}</span>{/if}
	{@render children?.()}
</span>

<style>
	.signal {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		white-space: nowrap;
		color: var(--hk-text-2);
	}
	.signal--err {
		color: var(--hk-err);
	}
	.signal--warn {
		color: var(--hk-warn);
	}
	.label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
