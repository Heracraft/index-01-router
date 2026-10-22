import type { TranscribeProvider, TranscriptionSettings } from '../settings.ts';

export type { TranscribeProvider, TranscriptionSettings };

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
	/** False for errors a retry cannot fix: bad key, unknown model, quota */
	readonly retryable: boolean;
	// Plain field, not a parameter property: node's type stripping runs these modules in scripts
	constructor(message: string, retryable: boolean) {
		super(message);
		this.name = 'TranscribeError';
		this.retryable = retryable;
	}
}

/** Container a provider wants each request's audio in. All are 16 kHz mono */
export type UploadFormat = 'webm' | 'ogg' | 'wav' | 'mp3';

export interface Upload {
	bytes: Uint8Array;
	mime: string;
	/** File name with an extension matching `mime`, for multipart uploads */
	name: string;
}

/** What one request returns: text of one chunk (or the whole file) */
export interface ChunkReply {
	text: string;
	/** Codes as the provider returned them; index.ts normalises */
	languages: string[];
	/** Highest no_speech_prob among the kept segments, when the reply has them */
	noSpeech?: number;
}

export interface RequestContext {
	signal?: AbortSignal;
	fetch: typeof fetch;
	/** Backoff wait between retries; tests pass a no-op */
	sleep?: (ms: number) => Promise<void>;
	/** Per request timeout, default 120 s */
	timeoutMs?: number;
}

export interface Provider {
	id: TranscribeProvider;
	label: string;
	defaultModel: string;
	format: UploadFormat;
	/** Largest upload one request takes, in bytes */
	maxBytes: number;
	/** Chunk requests in flight, default 3 */
	concurrency?: number;
	/** Model id used for `by`, e.g. gpt-transcribe */
	model(settings: TranscriptionSettings): string;
	transcribe(
		audio: Upload,
		settings: TranscriptionSettings,
		ctx: RequestContext
	): Promise<ChunkReply>;
}
