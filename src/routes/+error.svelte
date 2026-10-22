<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { errorHeading, signInUrl } from '#lib/signin-url.ts';

	const signIn = $derived(signInUrl(page.url));
	const title = $derived(errorHeading(page.status, page.error?.message));

	onMount(() => {
		// Full navigation: sign-in continues at the identity provider on another origin
		if (page.status === 401) location.assign(signIn);
	});
</script>

<svelte:head>
	<title>{title} · Index 01 Router</title>
</svelte:head>

<main class="wrap">
	<div class="card">
		{#if page.status === 404}
			<p class="code hk-mono">{page.url.pathname}</p>
		{:else if page.status !== 401}
			<p class="code hk-num">{page.status}</p>
		{/if}
		<h1>{title}</h1>
		{#if page.status === 401}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a class="hk-btn" href={signIn} data-sveltekit-reload>Sign in</a>
		{:else}
			<a class="hk-btn-secondary" href={resolve('/(app)')}>Recordings</a>
		{/if}
	</div>
</main>

<style>
	.wrap {
		display: grid;
		place-items: center;
		min-height: 100dvh;
		padding: 1.25rem;
	}
	.card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		max-width: 24rem;
		margin-top: -10vh;
		text-align: center;
	}
	.code {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--hk-text-3);
		overflow-wrap: anywhere;
	}
	h1 {
		margin: 0;
		font-size: 1.5rem;
		line-height: 2rem;
		overflow-wrap: anywhere;
	}
	a {
		margin-top: 0.75rem;
	}
</style>
