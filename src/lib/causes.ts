// Short human causes for stored errors, and the raw text shown under them. Browser safe.
import { cleanError } from './recording-state.ts';

/** The stored error as the owner may see it: provider advice dropped, org ids masked */
export function rawError(msg: string | null | undefined): string | null {
	if (!msg?.trim()) return null;
	return (
		cleanError(msg)
			.replace(/\borg-[A-Za-z0-9]+/g, 'org-…')
			.replace(/^\d+ of \d+ deliver(?:y|ies) failed\.?\s*/, '')
			.trim() || null
	);
}

/** Provider named in an error, "OpenAI" from "OpenAI 429: ...", else the provider id */
function providerOf(msg: string) {
	const m = /^([A-Za-z][\w.]*(?: [A-Za-z][\w.]*)?) \d{3}\b/.exec(msg);
	return m?.[1] ?? 'the provider';
}

/** Why a transcription failed, in a few words */
export function transcribeCause(error: string | null | undefined): string {
	const msg = rawError(error) ?? '';
	if (!msg) return 'Not transcribed';
	if (/Audio was not stored/i.test(msg)) return 'Audio not stored';
	if (/\b429\b|rate limit/i.test(msg)) return `Rate limited by ${providerOf(msg)}`;
	if (/\b401\b|\b403\b|key rejected|no api key|api key/i.test(msg)) return 'Key rejected';
	if (/corrupt|unsupported|invalid file|could not decode|unreadable|\b400\b|\b415\b/i.test(msg))
		return 'Audio unreadable';
	if (/\b50\d\b|overloaded|unavailable/i.test(msg)) return `${providerOf(msg)} is down`;
	if (/timed? ?out|did not answer|timeout/i.test(msg)) return `${providerOf(msg)} didn't answer`;
	if (/could not reach|ECONN|ENOTFOUND|fetch failed/i.test(msg)) return 'Provider unreachable';
	return 'Not transcribed';
}

/** Why a delivery to a note failed */
export function deliveryCause(error: string | null | undefined, name = 'Obsidian'): string {
	const msg = rawError(error) ?? '';
	const who = /obsidian/i.test(name) || name === 'Daily note' ? 'Obsidian' : name;
	if (/did not answer|timed? ?out/i.test(msg)) return `${who} didn't answer`;
	if (/cannot reach|ECONN|ENOTFOUND|EHOST/i.test(msg)) return `${who} unreachable`;
	if (/rejected the api key|api key is not set/i.test(msg)) return `${who} rejected the key`;
	if (/changed while writing/i.test(msg)) return 'Note changed while writing';
	return 'Not sent to the note';
}

/** Primary fix for a cause: Delete when retrying cannot help */
export const deleteFixes = (cause: string) => cause === 'Audio unreadable';
