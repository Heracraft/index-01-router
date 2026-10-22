<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { goto, refreshAll } from '$app/navigation';
	import Icon from '#lib/components/Icon.svelte';
	import { live } from '#lib/components/live.svelte.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	// Pipeline changes stream from /events. Pages that show recordings reload, debounced; keyed
	// rows update in place
	function wantsRefresh(recordingId: string) {
		const id = page.route.id;
		if (id === '/(app)' || id === '/(app)/day/[date]' || id === '/(app)/recordings') return true;
		if (id === '/(app)/recordings/[id]') return page.params.id === recordingId;
		return false;
	}
	const showsRequests = () =>
		page.route.id === '/(app)/settings' || page.route.id === '/(app)/settings/requests';

	// Offline shows only once the stream has been down for a moment
	let down = $state(false);
	let downTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		clearTimeout(downTimer);
		if (live.connected) down = false;
		else downTimer = setTimeout(() => (down = !live.connected), 4000);
		return () => clearTimeout(downTimer);
	});

	let reconnect = () => {};

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
			source?.close();
			source = new EventSource('/events');
			source.onopen = () => (live.connected = true);
			source.onmessage = (e) => {
				if (wantsRefresh(e.data)) refreshSoon();
			};
			// One per logged webhook request, accepted or not
			source.addEventListener('webhook', () => {
				if (showsRequests()) refreshSoon();
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
		reconnect = () => {
			clearTimeout(retry);
			connect();
			refreshAll();
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
			if (e.persisted && !stopped) reconnect();
		};
		// A phone waking up: the stream may have died while the tab slept
		const onVisible = () => {
			if (document.visibilityState !== 'visible' || stopped) return;
			if (!source || source.readyState === EventSource.CLOSED) reconnect();
			else refreshSoon();
		};
		window.addEventListener('pagehide', onHide);
		window.addEventListener('pageshow', onShow);
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			stopped = true;
			window.removeEventListener('pagehide', onHide);
			window.removeEventListener('pageshow', onShow);
			document.removeEventListener('visibilitychange', onVisible);
			clearTimeout(timer);
			clearTimeout(retry);
			source?.close();
			live.connected = false;
		};
	});

	// Upload from the header: pick a file, post it, open the new recording
	let fileInput = $state<HTMLInputElement>();
	let uploadForm = $state<HTMLFormElement>();
	let uploading = $state(false);
	let uploadError = $state<string | null>(null);
	let lastModified = $state('');
	function picked() {
		const file = fileInput?.files?.[0];
		if (!file) return;
		lastModified = String(file.lastModified);
		// Wait a tick so the hidden lastModified input carries the new value
		queueMicrotask(() => uploadForm?.requestSubmit());
	}

	const onSettings = $derived(page.url.pathname.startsWith('/settings'));
	const onSearch = $derived(page.url.pathname === '/recordings');
</script>

<svelte:head>
	<title>Index 01</title>
</svelte:head>

<a class="hk-skip" href="#main">Skip to content</a>

<header class="top">
	<div class="top-in">
		<a class="brand" href={resolve('/(app)')}>
			<svg class="mark" width="22" height="22" viewBox="0 0 32 32" aria-hidden="true"
				><rect width="32" height="32" rx="7" fill="#09090b" /><rect
					x="7"
					y="12"
					width="4"
					height="8"
					rx="1.5"
					fill="#3f3f46"
				/><rect x="14" y="8" width="4" height="16" rx="1.5" fill="#3f3f46" /><rect
					x="21"
					y="11"
					width="4"
					height="10"
					rx="1.5"
					fill="#60a5fa"
				/></svg
			>
			<span class="wordmark">Index 01</span>
		</a>
		<div class="top-act">
			{#if down}
				<button type="button" class="offline" onclick={() => reconnect()}
					><span class="dot idle" aria-hidden="true"></span>Offline</button
				>
			{/if}
			<a
				class="hk-btn-ghost iconbtn"
				class:is-cur={onSearch}
				href={resolve('/(app)/recordings')}
				aria-label="Search"
				title="Search"><Icon name="search" /></a
			>
			<form
				bind:this={uploadForm}
				method="POST"
				action="/?/upload"
				enctype="multipart/form-data"
				use:enhance={() => {
					uploading = true;
					uploadError = null;
					return async ({ result, update }) => {
						uploading = false;
						if (fileInput) fileInput.value = '';
						if (result.type === 'success' && typeof result.data?.uploaded === 'string') {
							await goto(resolve('/(app)/recordings/[id]', { id: result.data.uploaded }));
						} else if (result.type === 'failure') {
							uploadError = String(result.data?.upload ?? 'Upload failed');
						} else await update();
					};
				}}
			>
				<input
					bind:this={fileInput}
					class="hk-sr"
					type="file"
					name="audio"
					accept="audio/*,.m4a,.opus"
					tabindex="-1"
					aria-hidden="true"
					onchange={picked}
				/>
				<input type="hidden" name="lastModified" value={lastModified} />
				<button
					type="button"
					class="hk-btn-ghost iconbtn"
					aria-label={uploading ? 'Uploading' : 'Upload audio'}
					title="Upload audio"
					aria-busy={uploading}
					disabled={uploading}
					onclick={() => fileInput?.click()}><Icon name="upload" /></button
				>
			</form>
			<a
				class="hk-btn-ghost iconbtn"
				class:is-cur={onSettings}
				href={resolve('/(app)/settings')}
				aria-label="Settings"
				title="Settings"><Icon name="gear" /></a
			>
		</div>
	</div>
</header>

{#if uploadError || data.lostKeys.length || data.lostIntegrations.length || data.webhookSecretReset}
	<div class="banners">
		{#if uploadError}
			<p class="hk-banner hk-banner--err" role="alert">
				<span>{uploadError}</span>
				<button type="button" class="hk-btn-ghost hk-btn-sm" onclick={() => (uploadError = null)}
					>Dismiss</button
				>
			</p>
		{/if}
		{#if data.lostKeys.length || data.lostIntegrations.length || data.webhookSecretReset}
			<div class="hk-banner secret-banner" role="alert">
				<p class="banner-head">AUTH_SECRET changed</p>
				<ul>
					{#each data.lostKeys as k (k.label)}
						<li>
							<span>{k.label}</span>
							<a href="{resolve('/(app)/settings')}#transcription">Enter again</a>
						</li>
					{/each}
					{#each data.lostIntegrations as it (it.id)}
						<li>
							<span>{it.name} API key</span>
							<a href="{resolve('/(app)/settings')}#note-{it.id}">Enter again</a>
						</li>
					{/each}
					{#if data.webhookSecretReset}
						<li>
							<span>Webhook signing secret replaced</span>
							<a href="{resolve('/(app)/settings')}#ring">Show</a>
						</li>
					{/if}
				</ul>
			</div>
		{/if}
	</div>
{/if}

{@render children()}

<style>
	.mark {
		border-radius: 5px;
	}
	:global(:root[data-theme='dark']) .mark {
		box-shadow: 0 0 0 1px var(--hk-border);
	}
	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light'])) .mark {
			box-shadow: 0 0 0 1px var(--hk-border);
		}
	}
	form {
		display: contents;
	}
	.banners {
		max-width: 66rem;
		margin: 1rem auto 0;
		padding: 0 1.25rem;
	}
	.banners :global(.hk-banner) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin: 0 0 0.5rem;
	}
	.secret-banner {
		display: block !important;
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
</style>
