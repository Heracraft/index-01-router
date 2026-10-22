<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		/** Small line under the title, e.g. a mono id */
		sub?: Snippet;
		actions?: Snippet;
	}
	let { title, sub, actions }: Props = $props();
</script>

<svelte:head>
	<title>{title} · Index 01 Router</title>
</svelte:head>

<div class="head">
	<div class="titles">
		<h1 class="hk-h1-app">{title}</h1>
		{#if sub}<div class="sub">{@render sub()}</div>{/if}
	</div>
	{#if actions}<div class="actions">{@render actions()}</div>{/if}
</div>

<style>
	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.75rem 1rem;
		margin-bottom: 1.75rem;
	}
	.titles {
		min-width: 0;
	}
	h1 {
		margin: 0;
		text-wrap: balance;
	}
	.sub {
		margin-top: 0.375rem;
		font-size: 0.8125rem;
		color: var(--hk-text-3);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		padding-top: 0.125rem;
	}
</style>
