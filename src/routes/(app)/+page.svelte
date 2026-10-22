<script lang="ts">
	import DayPage from '#lib/components/DayPage.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<DayPage {data} />
