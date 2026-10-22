<script lang="ts">
	/* Filter links with their counts in the tab. The selected tab changes background only */
	interface Item {
		value: string;
		label: string;
		count?: number;
		tone?: 'err';
	}
	interface Props {
		/** aria-label of the nav */
		label: string;
		items: Item[];
		current: string;
		href: (value: string) => string;
	}
	let { label, items, current, href }: Props = $props();
</script>

<nav class="hk-seg hk-seg--sm tabs" aria-label={label}>
	<!-- eslint-disable svelte/no-navigation-without-resolve -- callers build href with resolve() -->
	{#each items as item (item.value)}
		<a
			href={href(item.value)}
			class:on={current === item.value}
			aria-current={current === item.value ? 'page' : undefined}
			data-sveltekit-reset="false"
			data-sveltekit-replacestate
		>
			{item.label}
			{#if item.count !== undefined}
				<span class="count hk-num" class:err={item.tone === 'err' && item.count > 0}
					>{item.count.toLocaleString('en-US')}</span
				>
			{/if}
		</a>
	{/each}
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
</nav>

<style>
	.tabs a {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		height: 1.5rem;
		padding: 0 0.625rem;
		border-radius: var(--hk-radius-6);
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--hk-text-3);
		text-decoration: none;
		white-space: nowrap;
		transition: color var(--hk-dur-fast) var(--hk-ease);
	}
	.tabs a:hover,
	.tabs a.on {
		color: var(--hk-text);
	}
	.tabs a.on {
		background: var(--hk-surface);
		box-shadow:
			0 0 0 1px var(--hk-border),
			0 1px 2px rgb(0 0 0 / 0.06);
	}
	.count {
		font-weight: 400;
		color: var(--hk-text-3);
	}
	.count.err {
		color: var(--hk-err);
	}
</style>
