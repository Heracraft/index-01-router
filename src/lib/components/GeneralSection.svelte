<script lang="ts">
	/* Timezone, theme, and who is signed in */
	import SaveBar from './SaveBar.svelte';
	import ThemeToggle from './ThemeToggle.svelte';
	import type { DirtyForms } from './dirty.svelte.ts';

	interface Props {
		general: { timezone: string; timeZones: string[] };
		email: string | null;
		error?: string | null;
		dirty: DirtyForms;
	}
	let { general, email, error = null, dirty }: Props = $props();

	let zone = $state('');
	let seen = '';
	$effect.pre(() => {
		if (general.timezone === seen) return;
		seen = general.timezone;
		zone = general.timezone;
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
					<option value={z}>{z.replaceAll('_', ' ')}</option>
				{/each}
			</select>
		</span>
		{#if error}<p class="f-err full">{error}</p>{/if}
	</div>
	<div class="srow">
		<span class="srow-l">Theme</span>
		<span class="srow-v"><ThemeToggle /></span>
	</div>
	<div class="srow">
		<span class="srow-l acct">Account<span class="muted">{email ?? 'Signed in'}</span></span>
		<form method="POST" action="/auth/signout" class="srow-v">
			<button class="hk-btn-ghost hk-btn-sm" name="everywhere" value="1">Sign out everywhere</button
			>
			<button class="hk-btn-secondary hk-btn-sm">Sign out</button>
		</form>
	</div>
	<SaveBar {dirty} keys={['transcription']} when={zone !== general.timezone} />
</section>

<style>
	.acct {
		display: flex;
		flex-direction: column;
		line-height: 1.35;
	}
	.acct .muted {
		font-size: 0.8125rem;
	}
	.full {
		flex-basis: 100%;
		text-align: right;
	}
</style>
