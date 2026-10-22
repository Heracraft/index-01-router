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
 * wrote, the rest placed by time, and recordings still in flight at the end.
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
	const flying = ascending.filter((r) => isInFlight(entryState(r)));
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

	type Placed = { line: SheetLine; time: string | null };
	const placed: Placed[] = [];
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
			placed.push({ line: { type: 'rec', key: hit.id, rec: hit }, time: timeOf(hit) });
		} else {
			placed.push({
				line: { type: 'typed', key: `t${i}`, time: b.time, text: b.text, task: b.task },
				time: b.time
			});
		}
	});
	// Untimed note lines sort with the line above them
	let last: string | null = null;
	for (const p of placed) {
		if (p.time) last = p.time;
		else p.time = last;
	}
	for (const r of settled) {
		if (used.has(r.id)) continue;
		const t = timeOf(r);
		const at = placed.findIndex((p) => p.time !== null && p.time > t);
		const item: Placed = { line: { type: 'rec', key: r.id, rec: r }, time: t };
		if (at < 0) placed.push(item);
		else placed.splice(at, 0, item);
	}
	return [
		...placed.map((p) => p.line),
		...flying
			.filter((r) => !used.has(r.id))
			.map((r): SheetLine => ({ type: 'rec', key: r.id, rec: r }))
	];
}
