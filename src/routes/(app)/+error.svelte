<script lang="ts">
	/* Errors from (app) page loads, inside the shell: the rail is the way on */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import PageHead from '#lib/components/PageHead.svelte';
	import { errorHeading, signInUrl } from '#lib/signin-url.ts';

	const title = $derived(errorHeading(page.status, page.error?.message));

	onMount(() => {
		if (page.status === 401) location.assign(signInUrl(page.url));
	});
</script>

<PageHead {title} />

<p class="path hk-mono">{page.url.pathname}</p>

<style>
	.path {
		margin: -1rem 0 0;
		font-size: 0.8125rem;
		color: var(--hk-text-3);
		overflow-wrap: anywhere;
	}
</style>
