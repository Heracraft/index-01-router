<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { refreshAll } from '$app/navigation';
	import Icon, { type IconName } from '#lib/components/Icon.svelte';
	import Signal from '#lib/components/Signal.svelte';
	import ThemeToggle from '#lib/components/ThemeToggle.svelte';
	import { live } from '#lib/components/live.svelte.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	type RailRoute = '/(app)' | '/(app)/integrations' | '/(app)/transcription' | '/(app)/webhook';
	const RAIL: { route: RailRoute; path: string; label: string; icon: IconName }[] = [
		{ route: '/(app)', path: '/', label: 'Recordings', icon: 'recordings' },
		{
			route: '/(app)/integrations',
			path: '/integrations',
			label: 'Integrations',
			icon: 'integrations'
		},
		{
			route: '/(app)/transcription',
			path: '/transcription',
			label: 'Transcription',
			icon: 'transcription'
		},
		{ route: '/(app)/webhook', path: '/webhook', label: 'Webhook', icon: 'webhook' }
	];

	const path = $derived(page.url.pathname);
	const isOn = (href: string) =>
		href === '/'
			? path === '/' || path.startsWith('/recordings/')
			: path === href || path.startsWith(`${href}/`);

	// Phone strip: keep the current tab in view and fade only an edge with more tabs past it
	let strip = $state<HTMLUListElement>();
	let fadeL = $state(false);
	let fadeR = $state(false);
	function edges() {
		if (!strip) return;
		const max = strip.scrollWidth - strip.clientWidth;
		fadeL = max > 1 && strip.scrollLeft > 1;
		fadeR = max > 1 && strip.scrollLeft < max - 1;
	}
	$effect(() => {
		void path;
		const a = strip?.querySelector<HTMLElement>('a[aria-current="page"]');
		if (strip && a && strip.scrollWidth > strip.clientWidth) {
			strip.scrollLeft = a.offsetLeft - (strip.clientWidth - a.offsetWidth) / 2;
		}
		edges();
	});
	$effect(() => {
		if (!strip) return;
		const ro = new ResizeObserver(edges);
		ro.observe(strip);
		return () => ro.disconnect();
	});

	// Pipeline changes stream from /events. Pages that show recordings reload, debounced
	function wantsRefresh(recordingId: string) {
		const id = page.route.id;
		if (id === '/(app)' || id === '/(app)/webhook') return true;
		if (id === '/(app)/recordings/[id]') return page.params.id === recordingId;
		return false;
	}

	onMount(() => {
		let source: EventSource | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let retry: ReturnType<typeof setTimeout> | undefined;
		let stopped = false;
		const refreshSoon = () => {
			clearTimeout(timer);
			timer = setTimeout(() => refreshAll(), 400);
		};

		const connect = () => {
			source = new EventSource('/events');
			source.onopen = () => (live.connected = true);
			source.onmessage = (e) => {
				if (wantsRefresh(e.data)) refreshSoon();
			};
			// One per logged webhook request, accepted or not
			source.addEventListener('webhook', () => {
				if (page.route.id === '/(app)/webhook') refreshSoon();
			});
			source.onerror = () => {
				live.connected = false;
				// EventSource retries by itself unless the server closed it for good (auth, 5xx)
				if (source?.readyState !== EventSource.CLOSED || stopped) return;
				fetch('/events', { method: 'HEAD' })
					.then((r) => {
						if (stopped) return;
						// Session ended: the reload gets the same 401 and the error page sends you to sign-in
						if (r.status === 401) refreshAll();
						else retry = setTimeout(connect, 5000);
					})
					.catch(() => {
						if (!stopped) retry = setTimeout(connect, 5000);
					});
			};
		};
		connect();
		// A page left for another one can stay in the back/forward cache with its stream open,
		// and each one held takes one of the browser's six connections to this host. Close it
		// on the way out and open a new one if the page comes back
		const onHide = () => {
			clearTimeout(retry);
			source?.close();
			live.connected = false;
		};
		const onShow = (e: PageTransitionEvent) => {
			if (e.persisted && !stopped) connect();
		};
		window.addEventListener('pagehide', onHide);
		window.addEventListener('pageshow', onShow);
		return () => {
			stopped = true;
			window.removeEventListener('pagehide', onHide);
			window.removeEventListener('pageshow', onShow);
			clearTimeout(timer);
			clearTimeout(retry);
			source?.close();
			live.connected = false;
		};
	});

	let account = $state<HTMLDetailsElement>();
</script>

<svelte:window
	onclick={(e) => {
		if (account?.open && !account.contains(e.target as Node)) account.open = false;
	}}
/>

<a class="hk-skip" href="#main">Skip to content</a>

<div class="shell">
	<header class="top">
		<div class="hk-container top-in">
			<a class="brand" href={resolve('/(app)')}>
				<span class="wordmark">Index 01</span>
				<span class="slash" aria-hidden="true"></span>
				<span class="sub">Router</span>
			</a>
			<details class="account" bind:this={account}>
				<summary title={data.user.email ?? data.user.name ?? undefined}>
					<span class="who">{data.user.email ?? data.user.name ?? 'Signed in'}</span>
					<Icon name="chevron" />
				</summary>
				<div class="menu">
					<div class="menu-theme">
						<ThemeToggle />
					</div>
					<form method="POST" action="/auth/signout">
						<button class="menu-item">Sign out</button>
						<button class="menu-item menu-item--tight" name="everywhere" value="1">
							Sign out everywhere
						</button>
					</form>
				</div>
			</details>
		</div>
	</header>

	<div class="hk-container body">
		<nav class="rail" aria-label="Sections">
			<ul bind:this={strip} onscroll={edges} class:fade-l={fadeL} class:fade-r={fadeR}>
				{#each RAIL as item (item.path)}
					<li>
						<a
							href={resolve(item.route)}
							class:on={isOn(item.path)}
							aria-current={isOn(item.path) ? 'page' : undefined}
						>
							<Icon name={item.icon} />
							<span>{item.label}</span>
						</a>
					</li>
				{/each}
			</ul>
			<div class="rail-foot">
				<a class="rail-provider" href={resolve('/(app)/transcription')}>
					<p class="hk-label">Provider</p>
					<p class="rail-value">{data.provider.label}</p>
					{#if data.provider.model || data.provider.ready}
						<p class="rail-model">
							{#if data.provider.ready === 'ok'}
								<Signal tone="ok" label="Key set" hideLabel />
							{:else if data.provider.ready === 'lost'}
								<Signal tone="err" label="Key unreadable" hideLabel />
							{:else if data.provider.ready === 'missing'}
								<Signal tone="idle" label="No key" hideLabel />
							{/if}
							<span class="hk-mono">{data.provider.model}</span>
						</p>
					{/if}
				</a>
				<p class="hk-label rail-tz-label">Timezone</p>
				<p class="rail-tz">{data.timezone.replaceAll('_', ' ')}</p>
			</div>
		</nav>

		<main id="main" tabindex="-1">
			{#if data.lostKeys.length || data.lostIntegrations.length || data.webhookSecretReset}
				<div class="hk-banner secret-banner" role="alert">
					<p class="banner-head">AUTH_SECRET changed</p>
					<ul>
						{#each data.lostKeys as k (k.label)}
							<li>
								<span>{k.label}</span>
								<a href="{resolve('/(app)/transcription')}{k.field ? `#${k.field}` : ''}"
									>Enter again</a
								>
							</li>
						{/each}
						{#each data.lostIntegrations as it (it.id)}
							<li>
								<span>{it.name} API key</span>
								<a href={resolve('/(app)/integrations/[id]', { id: it.id })}>Enter again</a>
							</li>
						{/each}
						{#if data.webhookSecretReset}
							<li>
								<span>Webhook signing secret replaced</span>
								<a href={resolve('/(app)/webhook')}>Show</a>
							</li>
						{/if}
					</ul>
				</div>
			{/if}
			{@render children()}
		</main>
	</div>
</div>

<style>
	.shell {
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
	}
	.top {
		border-bottom: 1px solid var(--hk-hairline);
		background: color-mix(in srgb, var(--hk-bg) 88%, transparent);
		backdrop-filter: saturate(1.4) blur(10px);
		z-index: 20;
	}
	@media (min-width: 640px) {
		.top {
			position: sticky;
			top: 0;
		}
	}
	.top-in {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		height: 3.5rem;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.625rem;
		color: var(--hk-text);
		text-decoration: none;
		white-space: nowrap;
	}
	.wordmark {
		font-family: var(--hk-font-display);
		font-size: 1.125rem;
		font-weight: 600;
	}
	.slash {
		width: 1px;
		height: 1rem;
		background: var(--hk-border-strong);
		transform: rotate(18deg);
	}
	.sub {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--hk-text-3);
	}

	.account {
		position: relative;
	}
	.account summary {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		height: 2rem;
		max-width: 13rem;
		padding: 0 0.5rem 0 0.625rem;
		border: 1px solid var(--hk-border);
		border-radius: var(--hk-radius-7);
		font-size: 0.8125rem;
		color: var(--hk-text-2);
		cursor: pointer;
		list-style: none;
		transition: border-color var(--hk-dur-fast) var(--hk-ease);
	}
	.account summary::-webkit-details-marker {
		display: none;
	}
	.account summary:hover {
		border-color: var(--hk-border-strong);
		color: var(--hk-text);
	}
	.account summary :global(svg) {
		color: var(--hk-text-3);
		transition: transform var(--hk-dur) var(--hk-ease);
	}
	.account[open] summary :global(svg) {
		transform: rotate(180deg);
	}
	.who {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.menu {
		position: absolute;
		right: 0;
		top: calc(100% + 0.375rem);
		z-index: 30;
		width: 15rem;
		padding: 0.375rem;
		border-radius: var(--hk-radius);
		background: var(--hk-surface);
		box-shadow: var(--hk-shadow-pop);
	}
	.menu-theme {
		display: flex;
		flex-direction: column;
		padding: 0.625rem 0.5rem;
		border-bottom: 1px solid var(--hk-hairline);
	}
	.menu-item {
		display: flex;
		width: 100%;
		margin-top: 0.375rem;
		padding: 0 0.5rem;
		height: 2rem;
		align-items: center;
		border: 0;
		border-radius: var(--hk-radius-6);
		background: none;
		font: inherit;
		font-size: 0.8125rem;
		color: var(--hk-text-2);
		cursor: pointer;
	}
	.menu-item--tight {
		margin-top: 0;
	}
	.menu-item:hover {
		background: var(--hk-hover);
		color: var(--hk-text);
	}

	.body {
		flex: 1;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		align-content: start;
		padding-bottom: 5rem;
	}
	.rail {
		position: sticky;
		top: 0;
		z-index: 4;
		margin: 0 calc(-1 * var(--hk-gutter));
		padding: 0 var(--hk-gutter);
		background: color-mix(in srgb, var(--hk-bg) 92%, transparent);
		backdrop-filter: blur(8px);
		border-bottom: 1px solid var(--hk-hairline);
	}
	.rail ul {
		display: flex;
		gap: 0.25rem;
		list-style: none;
		margin: 0;
		padding: 0.5rem 0;
		overflow-x: auto;
		scrollbar-width: none;
		--fl: 0px;
		--fr: 0px;
		mask-image: linear-gradient(
			to right,
			transparent,
			#000 var(--fl),
			#000 calc(100% - var(--fr)),
			transparent
		);
	}
	.rail ul.fade-l {
		--fl: 2.5rem;
	}
	.rail ul.fade-r {
		--fr: 2.5rem;
	}
	.rail ul::-webkit-scrollbar {
		display: none;
	}
	.rail ul a {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		height: 2rem;
		padding: 0 0.625rem;
		border-radius: var(--hk-radius-7);
		font-size: 0.8125rem;
		color: var(--hk-text-2);
		text-decoration: none;
		white-space: nowrap;
		transition:
			color var(--hk-dur-fast) var(--hk-ease),
			background-color var(--hk-dur-fast) var(--hk-ease);
	}
	.rail ul a:hover {
		color: var(--hk-text);
		background: var(--hk-hover);
	}
	.rail ul a.on {
		color: var(--hk-text);
		background: var(--hk-surface-2);
		box-shadow: inset 0 0 0 1px var(--hk-hairline);
	}
	.rail ul a :global(svg) {
		color: var(--hk-text-3);
	}
	.rail ul a.on :global(svg) {
		color: var(--hk-accent);
	}
	.rail-foot {
		display: none;
	}
	main {
		min-width: 0;
		padding-top: 1.75rem;
	}
	.secret-banner {
		display: block;
	}
	.secret-banner p,
	.secret-banner ul {
		margin: 0;
	}
	.banner-head {
		font-weight: 500;
	}
	.secret-banner ul {
		list-style: none;
		padding: 0;
		margin-top: 0.375rem;
	}
	.secret-banner li {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding-block: 0.125rem;
	}
	.rail-provider {
		display: block;
		margin: -0.375rem -0.5rem;
		padding: 0.375rem 0.5rem;
		border-radius: var(--hk-radius-7);
		color: inherit;
		text-decoration: none;
		transition: background-color var(--hk-dur-fast) var(--hk-ease);
	}
	.rail-provider:hover {
		background: var(--hk-hover);
	}

	@media (max-width: 479.98px) {
		.rail ul {
			gap: 0;
		}
		.rail ul a {
			padding: 0 0.5rem;
		}
		.rail ul a :global(svg) {
			display: none;
		}
	}

	@media (min-width: 768px) {
		.body {
			grid-template-columns: 12.5rem minmax(0, 1fr);
			gap: 3rem;
		}
		.rail {
			position: sticky;
			top: 3.5rem;
			align-self: start;
			margin: 0;
			padding: 2rem 0;
			background: none;
			backdrop-filter: none;
			border-bottom: 0;
		}
		.rail ul {
			flex-direction: column;
			gap: 0.125rem;
			padding: 0;
			overflow: visible;
			mask-image: none;
		}
		.rail-foot {
			display: block;
			margin-top: 2rem;
			padding-top: 1.25rem;
			border-top: 1px solid var(--hk-hairline);
		}
		.rail-foot p {
			margin: 0;
		}
		.rail-value {
			margin-top: 0.25rem !important;
			font-family: var(--hk-font-display);
			font-size: 1.25rem;
			line-height: 1.75rem;
			color: var(--hk-text);
		}
		.rail-model {
			display: flex;
			align-items: center;
			gap: 0.375rem;
		}
		.rail-model,
		.rail-tz {
			font-size: 0.75rem;
			color: var(--hk-text-3);
		}
		.rail-tz-label {
			margin-top: 1rem !important;
		}
		.rail-tz {
			font-size: 0.8125rem !important;
			color: var(--hk-text) !important;
		}
		main {
			padding-top: 2.25rem;
		}
	}
</style>
