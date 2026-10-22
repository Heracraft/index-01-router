<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	// Back to the page that failed, without a form action param such as ?/transcribe
	const next = $derived.by(() => {
		const params = [...page.url.searchParams].filter(([k]) => !k.startsWith('/'));
		const search = params.length ? `?${new URLSearchParams(params)}` : '';
		return page.url.pathname + search;
	});
	const signIn = $derived(`/auth/signin?next=${encodeURIComponent(next)}`);
	const title = $derived(
		page.status === 401
			? 'Signed out'
			: page.status === 404
				? 'Not found'
				: (page.error?.message ?? 'Something went wrong')
	);

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
		<p class="code hk-num">{page.status}</p>
		<h1>{title}</h1>
		{#if page.status === 401}
			<p>Your session ended.</p>
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a class="hk-btn" href={signIn} data-sveltekit-reload>Sign in again</a>
		{:else}
			{#if page.status === 404 && page.error?.message && page.error.message !== 'Not Found'}
				<p>{page.error.message}</p>
			{/if}
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
	}
	h1 {
		margin: 0;
		font-size: 1.5rem;
		line-height: 2rem;
		overflow-wrap: anywhere;
	}
	p {
		margin: 0;
		color: var(--hk-text-2);
		overflow-wrap: anywhere;
	}
	a {
		margin-top: 0.75rem;
	}
</style>
