<script lang="ts">
	/* Pipeline state as a 7px dot plus its label. Colour only for failed; work in flight pulses */
	import { statusLabel } from '#lib/format.ts';

	interface Props {
		status: string;
		/** Hide the label visually; it stays for screen readers */
		compact?: boolean;
	}
	let { status, compact = false }: Props = $props();

	const tone = $derived(
		status === 'failed'
			? 'hk-dot--err'
			: status === 'done'
				? 'hk-dot--done'
				: status === 'received'
					? ''
					: 'hk-dot--busy'
	);
</script>

<span class="status" class:failed={status === 'failed'}>
	<span class="hk-dot {tone}" aria-hidden="true"></span>
	<span class:hk-sr={compact}>{statusLabel(status)}</span>
</span>

<style>
	.status {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		white-space: nowrap;
		color: var(--hk-text-2);
	}
	.failed {
		color: var(--hk-err);
	}
</style>
