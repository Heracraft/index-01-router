<script lang="ts">
	import { resolve } from '$app/paths';
	/* Errors from (app) page loads, inside the shell: the header is the way on */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { errorHeading, signInUrl } from '#lib/signin-url.ts';

	const title = $derived(errorHeading(page.status, page.error?.message));

	onMount(() => {
		if (page.status === 401) location.assign(signInUrl(page.url));
	});
</script>

<div class="shell shell--one">
	<main id="main" class="col" tabindex="-1">
		<h1 class="hk-h1-app">{title}</h1>
		<p class="path hk-mono">{page.url.pathname}</p>
		<a class="hk-link" href={resolve('/(app)')}>Today</a>
	</main>
</div>

<style>
	h1 {
		margin: 0 0 0.5rem;
	}
	.path {
		margin: 0 0 1.25rem;
		font-size: 0.8125rem;
		color: var(--hk-text-3);
		overflow-wrap: anywhere;
	}
</style>
