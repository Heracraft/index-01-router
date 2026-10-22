import type { Recording } from '../db/schema.ts';
import type { GeneralSettings } from '../settings.ts';

export interface DeliverContext {
	recording: Recording;
	/** Decrypted config of the integration row */
	config: Record<string, unknown>;
	general: GeneralSettings;
	signal?: AbortSignal;
}

export interface DeliverResult {
	/** Where it landed, shown in the UI, e.g. Daily/2026-10-22.md */
	target: string;
}

export interface FieldSpec {
	key: string;
	label: string;
	type: 'text' | 'url' | 'secret' | 'textarea' | 'boolean';
	default?: string | boolean;
	/** One short constraint, shown under the field. Optional */
	hint?: string;
	required?: boolean;
}

export interface IntegrationKind {
	kind: 'obsidian';
	label: string;
	fields: FieldSpec[];
	/** Keys of fields stored encrypted */
	secrets: string[];
	deliver(ctx: DeliverContext): Promise<DeliverResult>;
	/** Checks the connection and returns a one line description of what was found */
	test(config: Record<string, unknown>): Promise<string>;
}

/** Plain field, not a parameter property: Node's type stripping rejects those */
export class DeliverError extends Error {
	readonly retryable: boolean;
	constructor(message: string, retryable: boolean) {
		super(message);
		this.retryable = retryable;
	}
}
