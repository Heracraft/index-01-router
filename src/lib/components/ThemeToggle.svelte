<script lang="ts">
	import { onMount } from 'svelte';
	import Segmented from './Segmented.svelte';

	type Theme = 'system' | 'light' | 'dark';
	let theme = $state<Theme>('system');

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
