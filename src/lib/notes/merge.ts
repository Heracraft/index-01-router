// The day sheet's lines: the note's own lines with recordings matched to the ones they wrote,
// the rest placed by time. Browser safe and free of I/O, so it is tested on its own.
import { renderEntry } from './template.ts';
import { entryRaw, type Block } from './sheet.ts';
import { entryState, isInFlight, type EntryRec } from '../entry.ts';

export type SheetLine =
	| { type: 'typed'; key: string; time: string | null; text: string; task: boolean | null }
	| { type: 'rec'; key: string; rec: EntryRec };

/**
 * The day as the note reads: note lines in their order, recordings matched to the lines they
 * wrote, failed and unsent recordings slotted in by time, and recordings in flight after them,
 * where an append would put them.
 */
export function mergeSheet(
	recs: EntryRec[],
	blocks: Block[] | null,
	opts: { path: string | null; entryTemplate: string; timeZone: string }
): SheetLine[] {
	const timeOf = (r: EntryRec) =>
		new Intl.DateTimeFormat('en-GB', {
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23',
			timeZone: opts.timeZone
		}).format(new Date(r.recordedAt));
	const ascending = [...recs].sort(
		(a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
	);
	const settled = ascending.filter((r) => !isInFlight(entryState(r)));
	const sentHere = (r: EntryRec) =>
		r.deliveries.some((d) => d.status === 'sent' && (!opts.path || d.target === opts.path));
	const raw = new Map(
		ascending.map((r) => {
			try {
				return [
					r.id,
					entryRaw(
						renderEntry(opts.entryTemplate, {
							recordedAt: new Date(r.recordedAt),
							timeZone: opts.timeZone,
							transcript: r.transcript ?? '',
							languages: r.languages,
							trigger: r.trigger,
							durationMs: r.durationMs
						})
					)
				];
			} catch {
				return [r.id, ''];
			}
		})
	);

	const placed: SheetLine[] = [];
	const used = new Set<string>();
	const texts = (blocks ?? []).filter((b) => b.type !== 'heading');
	texts.forEach((b, i) => {
		// The exact entry first, then a line at the same minute from a recording sent here (its
		// transcript was edited after sending)
		const hit =
			ascending.find((r) => !used.has(r.id) && !!r.transcript && raw.get(r.id) === b.raw) ??
			(b.time
				? settled.find((r) => !used.has(r.id) && sentHere(r) && timeOf(r) === b.time)
				: undefined);
		if (hit) {
			used.add(hit.id);
			placed.push({ type: 'rec', key: hit.id, rec: hit });
		} else {
			placed.push({ type: 'typed', key: `t${i}`, time: b.time, text: b.text, task: b.task });
		}
	});
	// A settled recording that is not in the note (failed, unsent) slots in by its time, so the
	// day still reads in order; one in flight goes last, where its append will land
	const lineTime = (l: SheetLine) => (l.type === 'typed' ? l.time : timeOf(l.rec));
	for (const r of ascending) {
		if (used.has(r.id)) continue;
		const line: SheetLine = { type: 'rec', key: r.id, rec: r };
		if (isInFlight(entryState(r))) {
			placed.push(line);
			continue;
		}
		const t = timeOf(r);
		const at = placed.findIndex((l) => {
			const lt = lineTime(l);
			return lt !== null && lt > t;
		});
		if (at < 0) placed.push(line);
		else placed.splice(at, 0, line);
	}
	return placed;
}

export type SheetSection = { heading: string; lines: SheetLine[] };

/**
 * Sections of the note other than `heading` that hold a line a recording wrote, in note order,
 * each with its own lines; for a note whose heading setting changed after some lines landed.
 * `at` is where the configured section sits among them. Recordings matched here are in `used`.
 */
export function otherSections(
	recs: EntryRec[],
	blocks: Block[],
	heading: string,
	opts: { entryTemplate: string; timeZone: string }
): { sections: SheetSection[]; at: number; used: Set<string> } {
	const want = heading.trim().toLowerCase();
	const flat: { heading: string; level: number; blocks: Block[] }[] = [];
	let mainLevel = 0;
	let inMain = false;
	let at = -1;
	for (const b of blocks) {
		if (b.type === 'heading') {
			if (inMain && b.level > mainLevel) continue;
			inMain = b.text.trim().toLowerCase() === want && at < 0;
			if (inMain) {
				mainLevel = b.level;
				at = flat.length;
				continue;
			}
			flat.push({ heading: b.text, level: b.level, blocks: [] });
		} else if (!inMain) flat.at(-1)?.blocks.push(b);
	}
	const raw = new Map<string, string>();
	for (const r of recs) {
		if (!r.transcript) continue;
		try {
			raw.set(
				entryRaw(
					renderEntry(opts.entryTemplate, {
						recordedAt: new Date(r.recordedAt),
						timeZone: opts.timeZone,
						transcript: r.transcript,
						languages: r.languages,
						trigger: r.trigger,
						durationMs: r.durationMs
					})
				),
				r.id
			);
		} catch {
			// a bad template: nothing matches
		}
	}
	const byId = new Map(recs.map((r) => [r.id, r]));
	const used = new Set<string>();
	const sections: SheetSection[] = [];
	const kept: number[] = [];
	flat.forEach((f, n) => {
		const hits = f.blocks.map((b) => {
			const id = b.type === 'heading' ? undefined : raw.get(b.raw);
			return id && !used.has(id) ? id : null;
		});
		if (!hits.some(Boolean)) return;
		const lines = f.blocks.flatMap((b, i): SheetLine[] => {
			if (b.type === 'heading') return [];
			const id = hits[i];
			if (id) {
				used.add(id);
				return [{ type: 'rec', key: id, rec: byId.get(id)! }];
			}
			return [{ type: 'typed', key: `s${n}-${i}`, time: b.time, text: b.text, task: b.task }];
		});
		sections.push({ heading: f.heading, lines });
		kept.push(n);
	});
	return { sections, at: at < 0 ? sections.length : kept.filter((k) => k < at).length, used };
}
