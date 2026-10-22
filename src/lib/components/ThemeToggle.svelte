<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Segmented from './Segmented.svelte';

	type Theme = 'system' | 'light' | 'dark';
	// The server renders the choice from the cookie the head script keeps; storage has the last word
	let theme = $state<Theme>(page.data.theme ?? 'system');

	onMount(() => {
		const t = document.documentElement.dataset.theme;
		theme = t === 'light' || t === 'dark' ? t : 'system';
	});

	function set(value: Theme) {
		const root = document.documentElement;
		try {
			if (value === 'system') localStorage.removeItem('hk-theme');
			else localStorage.setItem('hk-theme', value);
		} catch {
			// storage blocked: the choice lasts for this page only
		}
		document.cookie =
			value === 'system'
				? 'hk-theme=; path=/; max-age=0; samesite=lax'
				: `hk-theme=${value}; path=/; max-age=31536000; samesite=lax`;
		if (value === 'system') delete root.dataset.theme;
		else root.dataset.theme = value;
	}
</script>

<Segmented
	name="theme"
	label="Theme"
	size="sm"
	bind:value={theme}
	onchange={set}
	options={[
		{ value: 'system', label: 'System' },
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' }
	]}
/>
