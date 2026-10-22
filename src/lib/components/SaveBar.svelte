<script lang="ts">
	/* Save and Discard for one settings section. Sticky inside the section, so it shows only
	   while that section is on screen */
	import { getContext, untrack } from 'svelte';
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
	const changed = $derived(when && keys.some((k) => k in dirty.changed));
	// After a save the bar stays a moment and says so, then goes
	let saved = $state(false);
	let saving = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const busy = dirty.busy;
		const pending = changed;
		untrack(() => {
			if (busy && pending) saving = true;
			if (busy || !saving) return;
			saving = false;
			if (pending) return;
			saved = true;
			clearTimeout(timer);
			timer = setTimeout(() => (saved = false), 2400);
		});
	});
	$effect(() => {
		if (changed) saved = false;
	});
	$effect(() => () => clearTimeout(timer));
	const shown = $derived(changed || saved);
	const others = $derived(Object.keys(dirty.changed).filter((k) => !keys.includes(k)).length);
</script>

{#if shown}
	<div class="savebar" role="region" aria-label="Unsaved changes">
		<div class="savebar-in">
			{#if saved && !changed}
				<span class="sb-t sb-ok" role="status"
					><span class="dot" aria-hidden="true"></span>Saved</span
				>
			{:else}
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
			{/if}
		</div>
	</div>
{/if}
