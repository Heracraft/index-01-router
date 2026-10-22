<script lang="ts">
	/* The note as a delivery would write it, laid out as the day sheet shows it: path and heading
	   in the bar, then time-column rows, the new entry outlined where it would land */
	import { parseNote } from '#lib/notes/sheet.ts';

	interface Props {
		/** Rendered note path; null when pathError is set */
		path: string | null;
		/** The heading lines go under, named in the bar after the path */
		heading?: string | null;
		pathError?: string | null;
		barId?: string;
		/** Rendered text: new-note template plus entry, or the entry alone */
		body: string;
		/** Lines of body that are the new entry, as [first, end) */
		entryLines?: [number, number];
	}
	let { path, heading = null, pathError = null, barId, body, entryLines }: Props = $props();

	type Row =
		| { type: 'heading'; text: string }
		| { type: 'line'; time: string | null; text: string; task: boolean | null; entry: boolean };

	const rows = $derived.by(() => {
		const lines = body.split('\n');
		const [from, end] = entryLines ?? [lines.length, lines.length];
		const read = (md: string, entry: boolean): Row[] =>
			parseNote(md).map((b) =>
				b.type === 'heading'
					? { type: 'heading', text: b.text }
					: { type: 'line', time: b.time, text: b.text, task: b.task, entry }
			);
		const out = [...read(lines.slice(0, from).join('\n'), false)];
		// The entry reads as one row, however many lines its template has
		const entry = read(lines.slice(from, end).join('\n'), true).filter((r) => r.type === 'line');
		if (entry.length) {
			const [first, ...rest] = entry as Extract<Row, { type: 'line' }>[];
			out.push({ ...first!, text: [first!.text, ...rest.map((r) => r.text)].join(' ') });
		}
		out.push(...read(lines.slice(end).join('\n'), false));
		return out;
	});
</script>

<article class="sheet sheet--sm np">
	<div class="sheet-bar" id={barId}>
		{#if pathError}
			<span class="path err">{pathError}</span>
		{:else}
			<span class="path"
				>{path}{#if heading}<span class="path-h">{` › ${heading}`}</span>{/if}</span
			>
		{/if}
	</div>
	<div class="sheet-body">
		<ul class="notes">
			{#each rows as r, i (i)}
				<!-- Headings stay out of the body: the bar names the one lines go under -->
				{#if r.type === 'line'}
					<li class="e" class:e--typed={!r.entry} class:e--pending={r.entry}>
						<span class="e-t">{r.time ?? ''}</span>
						<div class="e-b">
							<p class="e-x">
								{#if r.task !== null}<span class="task" class:on={r.task}></span>{/if}{r.text}
							</p>
						</div>
					</li>
				{/if}
			{/each}
		</ul>
	</div>
</article>

<style>
	.np {
		max-width: 40rem;
	}
	.err {
		color: var(--hk-err);
	}
	.notes {
		margin: 0;
	}
</style>
