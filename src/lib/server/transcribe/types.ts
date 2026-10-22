import type { TranscriptionSettings } from '../settings.ts';

export interface TranscribeInput {
	/** Absolute path to the stored audio file */
	path: string;
	mime: string;
	durationMs: number | null;
	settings: TranscriptionSettings;
	signal?: AbortSignal;
}

export interface TranscribeResult {
	text: string;
	/** ISO 639-1 codes, most spoken first. Empty when the provider does not say */
	languages: string[];
	/** provider:model, e.g. openai:gpt-transcribe */
	by: string;
}

export class TranscribeError extends Error {
	constructor(
		message: string,
		/** False for errors a retry cannot fix: bad key, unknown model, quota */
		readonly retryable: boolean
	) {
		super(message);
	}
}
