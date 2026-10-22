import { createHash } from 'node:crypto';

export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

export interface IndexPayload {
	audio: File | null;
	/** Trimmed app transcript, null when absent or empty */
	transcription: string | null;
	/** recordedAt as sent, null when missing or not a number */
	recordedAtMs: number | null;
	testField: boolean;
	client: string | null;
}

const field = (form: FormData, name: string) => {
	const v = form.get(name);
	return typeof v === 'string' ? v : null;
};

export function readIndexForm(form: FormData): IndexPayload {
	const audio = form.get('audio');
	const transcription = field(form, 'transcription')?.trim() || null;
	const recordedAtText = field(form, 'recordedAt')?.trim() ?? '';
	const recordedAtMs = /^\d{1,15}$/.test(recordedAtText) ? Number(recordedAtText) : null;
	return {
		audio: audio instanceof File && audio.size > 0 ? audio : null,
		transcription,
		recordedAtMs,
		testField: field(form, 'test')?.trim() === 'true',
		client: field(form, 'client')
	};
}

export function isTestEvent(headers: Headers, testField: boolean) {
	return (
		testField ||
		headers.get('x-index-test') === 'true' ||
		headers.get('x-index-trigger') === 'test-event'
	);
}

const sha12 = (data: string | Uint8Array) =>
	createHash('sha256').update(data).digest('hex').slice(0, 12);

/** Filename stems the app uses when it has no delivery id, so they identify nothing */
const GENERIC_STEMS = new Set(['recording', 'audio', 'blob', 'file']);

/** Audio filename stem when it looks like an app delivery id, else null */
export function filenameStem(filename: string | null | undefined) {
	if (!filename) return null;
	const base = filename.split(/[/\\]/).pop() ?? '';
	const stem = base.replace(/\.[A-Za-z0-9]{1,5}$/, '');
	if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(stem) || GENERIC_STEMS.has(stem.toLowerCase())) return null;
	return stem;
}

/**
 * Idempotency key for a delivery. Signed: X-Index-Delivery. Unsigned: the audio filename stem;
 * transcription only: text-<recordedAt>-<sha256(transcript) first 12>. Audio with a generic
 * filename falls back to audio-<recordedAt>-<sha256(audio) first 12>.
 */
export function resolveDeliveryId(p: {
	headerId?: string | null;
	filename?: string | null;
	transcription?: string | null;
	recordedAtMs: number;
	audioBytes?: Uint8Array | null;
}): string | null {
	if (p.headerId) return p.headerId;
	const stem = filenameStem(p.filename);
	if (stem) return stem;
	if (p.audioBytes?.length) return `audio-${p.recordedAtMs}-${sha12(p.audioBytes)}`;
	if (p.transcription) return `text-${p.recordedAtMs}-${sha12(p.transcription)}`;
	return null;
}
