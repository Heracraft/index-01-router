<script lang="ts">
	/* The note as a delivery would write it: path in the bar, Markdown bytes in the body, the new
	   entry's lines marked. A code pane, since it shows file content rather than prose */
	interface Props {
		/** Rendered note path; null when pathError is set */
		path: string | null;
		/** "Note path cannot contain .." */
		pathError?: string | null;
		/** id for the bar, so a field can point at a path error */
		barId?: string;
		/** Rendered text: new-note template plus entry, or the entry alone */
		body: string;
		/** Lines of body that are the new entry, as [first, end) */
		entryLines?: [number, number];
	}
	let { path, pathError = null, barId, body, entryLines }: Props = $props();

	const lines = $derived(body.split('\n'));
	const isEntry = (i: number) => !!entryLines && i >= entryLines[0] && i < entryLines[1];
</script>

<div class="hk-code hk-code--wrap preview">
	<div class="hk-code-bar" id={barId}>
		{#if pathError}
			<span class="path err">{pathError}</span>
		{:else}
			<span class="path hk-mono">{path}</span>
		{/if}
	</div>
	<div class="hk-code-body">
		<pre><code
				>{#each lines as line, i (i)}<span class="ln" class:entry={isEntry(i)}>{line || ' '}</span
					>{/each}</code
			></pre>
	</div>
</div>

<style>
	.preview {
		max-width: 40rem;
	}
	.path {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.75rem;
	}
	.err {
		color: var(--hk-code-5xx);
	}
	.hk-code-body {
		padding-inline: 0;
	}
	.ln {
		display: block;
		padding-inline: var(--cb-pad);
	}
	.entry {
		background: color-mix(in srgb, var(--hk-code-string) 12%, transparent);
		box-shadow: inset 2px 0 0 color-mix(in srgb, var(--hk-code-string) 55%, transparent);
	}
</style>
