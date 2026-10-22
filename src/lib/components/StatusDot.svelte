<script lang="ts">
	/* Pipeline state as a dot plus its label. Colour only for failed and for a retry; work in
	   flight pulses. A retry shows its attempt number, with the last error on hover */
	import { isPending, statusLabel } from '#lib/format.ts';
	import Signal, { type SignalTone } from './Signal.svelte';

	interface Props {
		status: string;
		/** Hide the label visually; it stays for screen readers */
		compact?: boolean;
		/** Attempts so far. Above 1 while pending, the row is retrying */
		attempt?: number;
		lastError?: string | null;
	}
	let { status, compact = false, attempt = 0, lastError = null }: Props = $props();

	const retrying = $derived(isPending(status) && attempt > 1);
	const tone = $derived<SignalTone>(
		retrying
			? 'warn'
			: status === 'failed'
				? 'err'
				: status === 'done'
					? 'done'
					: status === 'received'
						? 'idle'
						: 'busy'
	);
	const label = $derived(
		retrying ? `${statusLabel(status)} · attempt ${attempt}` : statusLabel(status)
	);
</script>

<Signal {tone} {label} hideLabel={compact} title={retrying ? lastError : null} />
