<script lang="ts">
	import { resolve } from '$app/paths';
	/* Settings sections in the rail. A dot marks only a section with a problem */
	interface Item {
		id: string;
		label: string;
		tone?: 'warn' | 'err' | null;
	}
	interface Props {
		items: Item[];
		/** Section in view, or 'requests' on the request log */
		current: string;
	}
	let { items, current }: Props = $props();
	const settings = resolve('/(app)/settings');
</script>

<aside class="rail">
	<nav class="snav" aria-label="Settings">
		{#each items as s (s.id)}
			<a
				href="{settings}#{s.id}"
				class:cur={current === s.id}
				aria-current={current === s.id ? 'true' : undefined}
				>{s.label}{#if s.tone}<span
						class="sdot {s.tone}"
						aria-label={s.tone === 'warn' ? 'Needs a look' : 'Broken'}
					></span>{/if}</a
			>
		{/each}
		<span class="snav-sep" aria-hidden="true"></span>
		<a
			href={resolve('/(app)/settings/requests')}
			class:cur={current === 'requests'}
			aria-current={current === 'requests' ? 'page' : undefined}>Requests</a
		>
	</nav>
</aside>

<!-- Phone: the same sections as a row of chips under the header -->
<nav class="snav-m" aria-label="Settings sections">
	{#each items as s (s.id)}
		<a href="{settings}#{s.id}" class:cur={current === s.id}
			>{s.label}{#if s.tone}<span class="sdot {s.tone}" aria-hidden="true"></span>{/if}</a
		>
	{/each}
	<a href={resolve('/(app)/settings/requests')} class:cur={current === 'requests'}>Requests</a>
</nav>
