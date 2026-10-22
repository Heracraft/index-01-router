<script lang="ts">
	import BrandMark from '#lib/components/BrandMark.svelte';
	import { seededBars } from '#lib/entry.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const error = $derived(data.error);
	// Denied and unverified need another account; the rest a second go
	const switching = $derived(error?.code === 'denied' || error?.code === 'unverified');
	const label = $derived(!error ? 'Sign in' : switching ? 'Use another account' : 'Try again');
	let busy = $state(false);
	// The ring's waveform as the page's one picture, in one neutral tone: the mark above holds
	// the only blue
	const bars = seededBars('index-01', 36);
</script>

<svelte:head>
	<title>Sign in · Index 01 Router</title>
</svelte:head>

<main class="wrap">
	<div class="card">
		<p class="brand">
			<BrandMark size={40} />
			<span class="wordmark">Index 01</span>
		</p>
		<div class="sigwave" aria-hidden="true">
			{#each bars as h, i (i)}<i style:height="{Math.round(h * 100)}%"></i>{/each}
		</div>
		{#if error}
			<p class="hk-banner hk-banner--err" role="alert">
				{#if error.code === 'denied'}
					{#if error.email}<span
							><code>{error.email}</code> is not in <code>ALLOWED_EMAILS</code>.</span
						>{:else}<span>This account is not in <code>ALLOWED_EMAILS</code>.</span>{/if}
				{:else if error.code === 'unverified'}
					{#if error.email}<span
							><code>{error.email}</code> is not verified at the identity provider.</span
						>{:else}This email is not verified at the identity provider.{/if}
				{:else if error.code === 'exchange'}
					The identity provider rejected the sign-in.
				{:else if error.code === 'idp'}
					{#if error.host}<span>Cannot reach <code>{error.host}</code>.</span>{:else}Cannot reach
						the identity provider.{/if}
				{:else}
					Sign-in failed.
				{/if}
			</p>
		{/if}
		<form method="POST" onsubmit={() => (busy = true)}>
			{#if switching}
				<input type="hidden" name="switch" value="1" />
			{/if}
			<button class="hk-btn hk-btn-lg" aria-busy={busy}>{busy ? 'Signing in…' : label}</button>
		</form>
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
		align-items: stretch;
		width: 100%;
		max-width: 20rem;
		/* The group's centre on the optical centre, about 45% down */
		margin-top: -10vh;
	}
	.sigwave {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 3rem;
		margin: 0 0 2rem;
	}
	.sigwave i {
		flex: 0 0 3px;
		border-radius: 2px;
		background: var(--hk-border-strong);
	}
	.brand {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.875rem;
		margin: 0 0 1.5rem;
		white-space: nowrap;
	}
	.wordmark {
		font-family: var(--hk-font-display);
		font-size: 1.875rem;
		line-height: 2.25rem;
		font-weight: 600;
		color: var(--hk-text);
	}
	.hk-banner {
		display: block;
		width: 100%;
		margin-bottom: 1rem;
		overflow-wrap: anywhere;
	}
	code {
		font-family: var(--hk-font-mono);
		font-size: 0.8125rem;
	}
	form,
	button {
		width: 100%;
	}
	button {
		justify-content: center;
	}
</style>
