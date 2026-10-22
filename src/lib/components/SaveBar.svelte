<script lang="ts">
	/* Save and Discard for one settings section. Sticky inside the section, so it shows only
	   while that section is on screen */
	import { getContext } from 'svelte';
	import type { DirtyForms } from './dirty.svelte.ts';

	interface Props {
		dirty: DirtyForms;
		/** Form keys this section owns */
		keys: string[];
		/** Narrows when this bar shows, for a section that owns only part of a form */
		when?: boolean;
	}
	let { dirty, keys, when = true }: Props = $props();
	const discard = getContext<() => void>('settings-discard');
	const shown = $derived(when && keys.some((k) => k in dirty.changed));
	const others = $derived(Object.keys(dirty.changed).filter((k) => !keys.includes(k)).length);
</script>

{#if shown}
	<div class="savebar" role="region" aria-label="Unsaved changes">
		<div class="savebar-in">
			<span class="sb-t"
				>{others
					? `Unsaved here and in ${others === 1 ? 'one other section' : `${others} other sections`}`
					: 'Unsaved changes'}</span
			>
			<span class="sb-a">
				<button
					type="button"
					class="hk-btn-ghost hk-btn-sm"
					onclick={() => discard?.()}
					disabled={dirty.busy}>Discard</button
				>
				<button
					type="button"
					class="hk-btn hk-btn-sm"
					onclick={() => dirty.saveAll()}
					disabled={dirty.busy}
					aria-busy={dirty.busy}>{dirty.busy ? 'Saving…' : 'Save'}</button
				>
			</span>
		</div>
	</div>
{/if}
