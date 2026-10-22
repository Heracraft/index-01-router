<script lang="ts">
	/* The note as a delivery would write it, laid out as the vault shows it: path on top, the
	   new entry's lines marked with the accent dot */
	interface Props {
		/** Rendered note path; null when pathError is set */
		path: string | null;
		pathError?: string | null;
		barId?: string;
		/** Rendered text: new-note template plus entry, or the entry alone */
		body: string;
		/** Lines of body that are the new entry, as [first, end) */
		entryLines?: [number, number];
	}
	let { path, pathError = null, barId, body, entryLines }: Props = $props();

	const lines = $derived(body.split('\n'));
	const isEntry = (i: number) => !!entryLines && i >= entryLines[0] && i < entryLines[1];
	const heading = (l: string) => /^#{1,6}\s/.test(l);
</script>

<article class="sheet sheet--sm np">
	<div class="sheet-bar" id={barId}>
		{#if pathError}
			<span class="path err">{pathError}</span>
		{:else}
			<span class="path">{path}</span>
		{/if}
	</div>
	<div class="sheet-body">
		{#each lines as line, i (i)}
			{#if heading(line)}
				<h3 class="nh">{line.replace(/^#+\s*/, '')}</h3>
			{:else if line.trim()}
				<p class="ln" class:e--this={isEntry(i)}>{line}</p>
			{/if}
		{/each}
	</div>
</article>

<style>
	.np {
		max-width: 40rem;
	}
	.err {
		color: var(--hk-err);
	}
	.ln {
		position: relative;
		margin: 0;
		padding: 0.25rem 0;
		font-size: 0.9375rem;
		line-height: 1.6;
		color: var(--hk-text-2);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.ln.e--this {
		color: var(--hk-text);
	}
	.ln.e--this::before {
		top: 0.85rem;
	}
</style>
