<script lang="ts">
	import { triggerLabel } from '#lib/format.ts';
	import Icon, { type IconName } from './Icon.svelte';

	interface Props {
		trigger: string | null;
		/** Icon only, label for screen readers */
		compact?: boolean;
	}
	let { trigger, compact = false }: Props = $props();

	const ICONS: Record<string, IconName> = {
		'single-click-hold': 'single',
		'double-click-hold': 'double',
		upload: 'upload',
		'test-event': 'test'
	};
	const icon = $derived(trigger ? ICONS[trigger] : undefined);
</script>

{#if trigger}
	<span class="trigger" title={compact ? triggerLabel(trigger) : undefined}>
		{#if icon}<Icon name={icon} />{/if}
		<span class:hk-sr={compact}>{triggerLabel(trigger)}</span>
	</span>
{/if}

<style>
	.trigger {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		white-space: nowrap;
		color: var(--hk-text-2);
	}
	.trigger :global(svg) {
		color: var(--hk-text-3);
	}
</style>
