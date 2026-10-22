<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const error = $derived(data.error);
	// Denied and unverified need another account; the rest a second go
	const switching = $derived(error?.code === 'denied' || error?.code === 'unverified');
	const label = $derived(!error ? 'Sign in' : switching ? 'Use another account' : 'Try again');
	let busy = $state(false);
</script>

<svelte:head>
	<title>Sign in · Index 01 Router</title>
</svelte:head>

<main class="wrap">
	<div class="card">
		<img class="mark" src={favicon} alt="" width="40" height="40" />
		<p class="brand">
			<span class="wordmark">Index 01</span>
			<span class="slash" aria-hidden="true"></span>
			<span class="sub">Router</span>
		</p>
		{#if error}
			<p class="hk-banner hk-banner--err" role="alert">
				{#if error.code === 'denied'}
					{#if error.email}<span><code>{error.email}</code> is not on the allow list.</span
						>{:else}This account is not on the allow list.{/if}
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
					<span>Sign-in failed: <code>{error.code}</code></span>
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
		align-items: center;
		width: 100%;
		max-width: 20rem;
		margin-top: -10vh;
	}
	.mark {
		border-radius: 9px;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.625rem;
		margin: 1.25rem 0 2rem;
		white-space: nowrap;
	}
	.wordmark {
		font-family: var(--hk-font-display);
		font-size: 1.5rem;
		font-weight: 600;
		color: var(--hk-text);
	}
	.slash {
		width: 1px;
		height: 1.25rem;
		background: var(--hk-border-strong);
		transform: rotate(18deg);
	}
	.sub {
		font-size: 1rem;
		font-weight: 500;
		color: var(--hk-text-3);
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
</style>
