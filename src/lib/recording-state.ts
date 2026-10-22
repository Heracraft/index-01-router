// Reads a recording's stored status and error into what each part of the UI shows: the
// transcript slot, the fallback reason, the retry state, and any error that fits none of them.
// Pure and browser safe, so the list and the detail page read the same.
import { isPending } from './format.ts';

export type Slot =
	/** Transcript present */
	| { kind: 'text' }
	/** Still working: a skeleton */
	| { kind: 'pending' }
	| { kind: 'no-speech' }
	/** No transcript because of this error, cleaned */
	| { kind: 'error'; text: string };

export interface RecordingLike {
	status: string;
	error: string | null;
	/** Full transcript (detail) */
	transcript?: string | null;
	/** First line (list) */
	line?: string;
	/** Transcription attempts so far */
	attempts: number;
}

export interface RecordingState {
	slot: Slot;
	/** "gpt-transcribe heard no speech" from "Used the app transcript: openai:gpt-transcribe heard no speech" */
	fallbackReason: string | null;
	/** Set while transcription is pending and attempts > 1: last error, cleaned */
	retry: { attempt: number; lastError: string | null } | null;
	/** Error that fits none of the above ("Routing failed: …") */
	other: string | null;
}

const FALLBACK = 'Used the app transcript';
const DELIVERY_SUMMARY = /^\d+ of \d+ deliver(?:y|ies) failed/;
const NO_SPEECH = 'No speech in the recording';

/**
 * A stored error as the UI shows it: without the "Transcription failed: " prefix (the red slot
 * says that), the ". Retrying" suffix older rows carry, and provider advice from
 * ". Please try again" on
 */
export function cleanError(msg: string): string {
	return msg
		.trim()
		.replace(/^Transcription failed:\s*/, '')
		.replace(/\.?\s*Retrying\.?$/, '')
		.replace(/\.?\s*Please try again\b[\s\S]*$/, '')
		.trim();
}

/** The fallback note's reason, with an internal provider id like "openai:" dropped */
function fallbackOf(error: string | null): string | null {
	if (!error) return null;
	const at = error.indexOf(`${FALLBACK}: `);
	if (at < 0) return null;
	const reason = cleanError(error.slice(at + FALLBACK.length + 2));
	return reason.replace(/^[a-z][a-z0-9-]*:(?=\S)/, '') || null;
}

export function describeRecording(r: RecordingLike): RecordingState {
	const error = r.error?.trim() || null;
	const hasText = !!(r.transcript?.trim() || r.line?.trim());
	const pending = isPending(r.status);
	const fallbackReason = fallbackOf(error);
	// What the error says once the fallback note and a delivery summary are taken out
	const rest =
		error && !fallbackReason && !error.startsWith(FALLBACK) && !DELIVERY_SUMMARY.test(error)
			? cleanError(error)
			: null;

	const retry =
		pending && r.status !== 'routing' && r.attempts > 1
			? { attempt: r.attempts, lastError: rest }
			: null;

	let slot: Slot;
	let other: string | null = null;
	if (hasText) {
		slot = { kind: 'text' };
		if (rest && !pending) other = rest;
	} else if (pending) {
		slot = { kind: 'pending' };
	} else if (r.status === 'failed') {
		slot = { kind: 'error', text: rest ?? 'Failed' };
	} else {
		slot = { kind: 'no-speech' };
		if (rest && rest !== NO_SPEECH) other = rest;
	}
	return { slot, fallbackReason, retry, other };
}
