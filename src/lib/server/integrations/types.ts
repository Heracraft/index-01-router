import type { Recording } from '../db/schema.ts';
import type { GeneralSettings } from '../settings.ts';

export interface DeliverContext {
	recording: Recording;
	/** Decrypted config of the integration row */
	config: Record<string, unknown>;
	general: GeneralSettings;
	signal?: AbortSignal;
	/**
	 * True when no earlier attempt of this delivery ran, so nothing of it can be in the target
	 * yet. A kind then writes the entry even when identical text is already there (two
	 * recordings saying the same thing in the same minute). Otherwise it skips an entry already
	 * present, so a retry after a lost response does not add a second copy
	 */
	firstAttempt?: boolean;
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
	placeholder?: string;
	/** Placeholders offered as insert chips under a textarea, e.g. 'time:HH:mm' */
	tokens?: string[];
	required?: boolean;
	/** Env variable used while the stored value is blank. A stored value overrides it */
	env?: string;
}

/** What a connection test found: the note a delivery today would write to, and its state */
export interface TestResult {
	target: string;
	/** heading: note and heading exist; note: note exists without the heading; new: no note yet */
	state: 'heading' | 'note' | 'new';
	/** The heading looked for */
	heading: string;
}

/** Context a test needs beyond the config */
export interface TestContext {
	timeZone: string;
	now?: Date;
}

export interface IntegrationKind {
	kind: 'obsidian';
	label: string;
	fields: FieldSpec[];
	/** Keys of fields stored encrypted */
	secrets: string[];
	deliver(ctx: DeliverContext): Promise<DeliverResult>;
	/** Input rules beyond required fields. Throws IntegrationInputError naming the field */
	validate?(config: Record<string, unknown>): void;
	/** Checks the connection and reports the note today's delivery would write to */
	test(config: Record<string, unknown>, ctx: TestContext): Promise<TestResult>;
}

/** Form fields an error can point at */
export type FieldKey = string;

/** Plain field, not a parameter property: Node's type stripping rejects those */
export class DeliverError extends Error {
	readonly retryable: boolean;
	/** The form field the error is about, when there is one */
	readonly field: FieldKey | undefined;
	constructor(message: string, retryable: boolean, field?: FieldKey) {
		super(message);
		this.retryable = retryable;
		this.field = field;
	}
}

/** Thrown for input the UI shows under `field` (or by the buttons without one) */
export class IntegrationInputError extends Error {
	readonly field: FieldKey | undefined;
	constructor(message: string, opts: { field?: FieldKey } = {}) {
		super(message);
		this.name = 'IntegrationInputError';
		this.field = opts.field;
	}
}
