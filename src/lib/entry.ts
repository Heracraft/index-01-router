// One recording as a line in the day sheet: its state, its fix, and the exceptions worth a word.
// Browser safe, shared by the day sheet, the search list and the recording page.
import { deleteFixes, deliveryCause, rawError, transcribeCause } from './causes.ts';
import { languageName } from './format.ts';

export interface EntryDelivery {
	id: string;
	status: 'pending' | 'sent' | 'failed' | 'skipped';
	error: string | null;
	attempts: number;
	target: string | null;
	/** Sent before the transcript last changed */
	stale: boolean;
	name: string;
	updatedAt: Date | string;
}

export interface EntryRec {
	id: string;
	recordedAt: Date | string;
	durationMs: number | null;
	status: string;
	transcript: string | null;
	error: string | null;
	attempts: number;
	trigger: string;
	languages: string[];
	transcribedBy: string | null;
	hasAudio: boolean;
	hasAppTranscript: boolean;
	deliveries: EntryDelivery[];
}

export interface Fix {
	/** Form action on /recordings/[id] */
	action: 'transcribe' | 'route' | 'redeliver' | 'delete';
	delivery?: string;
}

export type EntryState =
	| { kind: 'done' }
	| { kind: 'nospeech' }
	| { kind: 'waiting' }
	| { kind: 'transcribing' }
	| { kind: 'sending' }
	| {
			kind: 'failed';
			step: 'transcribe' | 'deliver';
			cause: string;
			raw: string | null;
			fix: Fix;
	  };

export const isInFlight = (s: EntryState) =>
	s.kind === 'waiting' || s.kind === 'transcribing' || s.kind === 'sending';

export function entryState(r: EntryRec): EntryState {
	const text = !!r.transcript?.trim();
	if (r.status === 'received') return { kind: 'waiting' };
	if (r.status === 'transcribing') return { kind: 'transcribing' };
	if (r.status === 'routing') return { kind: 'sending' };
	if (r.status === 'failed') {
		if (!text) {
			const cause = transcribeCause(r.error);
			const canRetry = (r.hasAudio || r.hasAppTranscript) && !deleteFixes(cause);
			return {
				kind: 'failed',
				step: 'transcribe',
				cause,
				raw: rawError(r.error),
				fix: { action: canRetry ? 'transcribe' : 'delete' }
			};
		}
		const failed = r.deliveries.filter((d) => d.status === 'failed');
		const first = failed[0];
		return {
			kind: 'failed',
			step: 'deliver',
			cause: first ? deliveryCause(first.error, first.name) : 'Not sent to the note',
			raw: rawError(first?.error ?? r.error),
			fix: failed.length === 1 ? { action: 'redeliver', delivery: first!.id } : { action: 'route' }
		};
	}
	return text ? { kind: 'done' } : { kind: 'nospeech' };
}

/**
 * The one exception worth a muted word under a settled line: words that never reached a note,
 * an edit after sending, or several languages, in that order. Ordinary lines get none. How it
 * came in (trigger, upload, phone transcript) is for the recording's Details
 */
export function entryMeta(r: EntryRec): string[] {
	const text = !!r.transcript?.trim();
	if (
		text &&
		r.status === 'done' &&
		r.deliveries.length > 0 &&
		!r.deliveries.some((d) => d.status === 'sent')
	)
		return ['Not sent'];
	if (r.deliveries.some((d) => d.status === 'sent' && d.stale)) return ['Edited'];
	if (r.languages.length > 1) return [r.languages.map(languageName).join(', ')];
	return [];
}

/** Deterministic bar heights (0.2 to 1) from an id, for a waveform before real peaks load */
export function seededBars(id: string, n: number): number[] {
	let h = 2166136261;
	for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
	const out: number[] = [];
	let prev = 0.5;
	for (let i = 0; i < n; i++) {
		h = Math.imul(h ^ (h >>> 15), 2246822507);
		h = Math.imul(h ^ (h >>> 13), 3266489909);
		const r = ((h ^= h >>> 16) >>> 0) / 4294967296;
		prev = prev * 0.45 + r * 0.55;
		out.push(0.2 + prev * 0.8);
	}
	return out;
}
