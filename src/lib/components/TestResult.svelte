<script lang="ts">
	/* The outcome of a Test button: dot plus what was found, or the error. Gone once anything
	   in the form changes, so a result never sits next to values it did not test */
	import type { Snippet } from 'svelte';
	import Signal from './Signal.svelte';

	interface Props {
		result: { ok: boolean; message?: string } | null;
		/** True once anything in the form changed since the test ran */
		stale: boolean;
		/** Rich success content (target path, transcript). Falls back to `message` */
		children?: Snippet;
	}
	let { result, stale, children }: Props = $props();
</script>

{#if result && !stale}
	<span class="result" class:bad={!result.ok}>
		<Signal tone={result.ok ? 'ok' : 'err'} label={result.ok ? 'Passed' : 'Failed'} hideLabel />
		<span class="body">
			{#if result.ok && children}{@render children()}{:else}{result.message ?? ''}{/if}
		</span>
	</span>
{/if}

<style>
	.result {
		display: inline-flex;
		align-items: baseline;
		gap: 0.5rem;
		min-width: 0;
		color: var(--hk-text-2);
	}
	.result :global(.hk-dot) {
		transform: translateY(-1px);
	}
	.body {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.bad {
		color: var(--hk-err);
	}
</style>
