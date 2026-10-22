<script lang="ts">
	/* Timezone, theme, and who is signed in */
	import Modal from './Modal.svelte';
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
	let leaving = $state(false);
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
					<option value={z} selected={z === general.timezone}>{z.replaceAll('_', ' ')}</option>
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
		<span class="srow-l">Account</span>
		<span class="srow-v">
			<span class="muted">{email ?? 'Signed in'}</span>
			<button type="button" class="hk-btn-secondary hk-btn-sm" onclick={() => (leaving = true)}
				>Sign out</button
			>
		</span>
	</div>
	<Modal bind:open={leaving} title="Sign out" size="sm">
		<p>{email ?? 'This account'}</p>
		{#snippet footer()}
			<form method="POST" action="/auth/signout" class="out">
				<button class="hk-btn-secondary" name="everywhere" value="1">Sign out everywhere</button>
				<button class="hk-btn">Sign out here</button>
			</form>
		{/snippet}
	</Modal>
	<SaveBar {dirty} keys={['transcription']} when={zone !== general.timezone} />
</section>

<style>
	.out {
		display: flex;
		gap: 0.5rem;
	}
	.full {
		flex-basis: 100%;
		text-align: right;
	}
</style>
