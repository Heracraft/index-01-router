<script lang="ts">
	/* Timezone with the local time it gives, theme, and who is signed in */
	import { onMount } from 'svelte';
	import ThemeToggle from './ThemeToggle.svelte';
	import { formatDate } from '#lib/notes/time.ts';

	interface Props {
		general: { timezone: string; envTimezone: string | undefined; timeZones: string[] };
		email: string | null;
		error?: string | null;
	}
	let { general, email, error = null }: Props = $props();

	let zone = $state('');
	let seen = '';
	$effect.pre(() => {
		if (general.timezone === seen) return;
		seen = general.timezone;
		zone = general.timezone;
	});
	let now = $state(new Date());
	onMount(() => {
		const t = setInterval(() => (now = new Date()), 30_000);
		return () => clearInterval(t);
	});
	const clock = $derived.by(() => {
		try {
			return formatDate(now, 'HH:mm', zone || 'UTC');
		} catch {
			return '';
		}
	});
</script>

<section class="sset" id="general" aria-labelledby="general-h">
	<div class="sset-h">
		<h2 class="sec-h" id="general-h">General</h2>
	</div>
	<div class="srow srow--top">
		<label class="srow-l" for="timezone">Timezone</label>
		<span class="srow-v tz">
			<!-- Posted with the Transcription form, which stores it -->
			<select
				id="timezone"
				name="timezone"
				form="f-transcription"
				class="hk-select"
				bind:value={zone}
				aria-invalid={!!error || undefined}
			>
				{#each general.timeZones as z (z)}
					<option value={z}
						>{z.replaceAll('_', ' ')}{z === general.envTimezone ? ' · TZ' : ''}</option
					>
				{/each}
			</select>
			<span class="muted hk-num">{clock}</span>
		</span>
		{#if error}<p class="f-err full">{error}</p>{/if}
	</div>
	<div class="srow">
		<span class="srow-l">Theme</span>
		<span class="srow-v"><ThemeToggle /></span>
	</div>
	<div class="srow">
		<span class="srow-l">{email ?? 'Signed in'}</span>
		<form method="POST" action="/auth/signout" class="srow-v">
			<button class="hk-btn-ghost hk-btn-sm" name="everywhere" value="1">Sign out everywhere</button
			>
			<button class="hk-btn-secondary hk-btn-sm">Sign out</button>
		</form>
	</div>
</section>

<style>
	.full {
		flex-basis: 100%;
		text-align: right;
	}
</style>
