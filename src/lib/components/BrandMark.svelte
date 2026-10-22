<script lang="ts">
	/* The app mark: ink tile, three level bars, the last one blue. One drawing at every size */
	interface Props {
		size?: number;
	}
	let { size = 22 }: Props = $props();
</script>

<svg class="bm" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
	<rect width="32" height="32" rx="7" fill="#09090b" />
	<rect x="7" y="12" width="4" height="8" rx="2" fill="#a1a1aa" />
	<rect x="14" y="8" width="4" height="16" rx="2" fill="#a1a1aa" />
	<rect x="21" y="11" width="4" height="10" rx="2" fill="#60a5fa" />
</svg>

<style>
	.bm {
		display: block;
		flex: none;
		border-radius: 22%;
	}
	:global(:root[data-theme='dark']) .bm {
		box-shadow: 0 0 0 1px var(--hk-border-strong);
	}
	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light'])) .bm {
			box-shadow: 0 0 0 1px var(--hk-border-strong);
		}
	}
</style>
