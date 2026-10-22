import { asc, count, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { deliveries, integrations, type Integration } from '../db/schema.ts';
import { decrypt, encrypt, isEncrypted } from '../crypto.ts';
import { obsidian } from './obsidian.ts';
import { triggerLabel } from '../../format.ts';
import {
	IntegrationInputError,
	type FieldSpec,
	type IntegrationKind,
	type TestResult
} from './types.ts';

export { DeliverError, IntegrationInputError } from './types.ts';
export type { IntegrationKind, FieldSpec, TestResult } from './types.ts';

export type Kind = IntegrationKind['kind'];

export const kinds: Record<Kind, IntegrationKind> = { obsidian };

/** Values an integration can listen to. An empty list means all of them */
export const TRIGGERS = ['single-click-hold', 'double-click-hold', 'upload'] as const;
export type Trigger = (typeof TRIGGERS)[number];

export const isKind = (kind: string): kind is Kind => Object.hasOwn(kinds, kind);

/** An integration as the browser may see it: secrets blanked, `secretsSet` says which are stored */
export type IntegrationView = Omit<Integration, 'config'> & {
	config: Record<string, unknown>;
	secretsSet: Record<string, boolean>;
	/** Stored secrets no key in AUTH_SECRET or AUTH_SECRET_PREVIOUS opens */
	secretsLost: Record<string, boolean>;
};

function kindOf(kind: string): IntegrationKind {
	if (!isKind(kind)) throw new IntegrationInputError(`Unknown integration kind: ${kind}`);
	return kinds[kind];
}

function decryptConfig(row: Integration): Integration {
	const kind = kinds[row.kind as Kind];
	if (!kind) return row;
	const config = { ...row.config };
	for (const key of kind.secrets) {
		const v = config[key];
		if (typeof v === 'string' && isEncrypted(v)) {
			try {
				config[key] = decrypt(v);
			} catch {
				// AUTH_SECRET changed: the key cannot be recovered and must be entered again
				config[key] = '';
			}
		}
	}
	return { ...row, config };
}

/** True when a stored secret is present and readable: no key opens one AUTH_SECRET lost */
function secretUsable(v: unknown) {
	if (typeof v !== 'string' || v === '') return false;
	if (!isEncrypted(v)) return true;
	try {
		decrypt(v);
		return true;
	} catch {
		return false;
	}
}

function toView(row: Integration): IntegrationView {
	const kind = kinds[row.kind as Kind];
	const config = { ...row.config };
	const secretsSet: Record<string, boolean> = {};
	const secretsLost: Record<string, boolean> = {};
	for (const key of kind?.secrets ?? []) {
		// A secret AUTH_SECRET can no longer open shows as unset and lost, so the form asks again
		const v = config[key];
		secretsSet[key] = secretUsable(v);
		secretsLost[key] = typeof v === 'string' && isEncrypted(v) && !secretsSet[key];
		config[key] = '';
	}
	return { ...row, config, secretsSet, secretsLost };
}

/** Integrations holding a secret that no key in AUTH_SECRET or AUTH_SECRET_PREVIOUS opens */
export async function integrationsWithLostSecrets(): Promise<{ id: string; name: string }[]> {
	const rows = await db.select().from(integrations).orderBy(asc(integrations.createdAt));
	return rows
		.filter((row) =>
			(kinds[row.kind as Kind]?.secrets ?? []).some((key) => {
				const v = row.config[key];
				return typeof v === 'string' && isEncrypted(v) && !secretUsable(v);
			})
		)
		.map(({ id, name }) => ({ id, name }));
}

/** Coerces form or JSON input to the kind's fields. Unknown keys are dropped */
export function normalizeConfig(fields: FieldSpec[], input: Record<string, unknown>) {
	const out: Record<string, unknown> = {};
	for (const f of fields) {
		const v = input[f.key];
		if (f.type === 'boolean') {
			out[f.key] =
				v === undefined
					? (f.default ?? false)
					: v === true || v === 'true' || v === 'on' || v === '1';
		} else {
			const s = typeof v === 'string' ? v : v == null ? '' : String(v);
			out[f.key] = f.type === 'textarea' ? s.replace(/\r\n?/g, '\n') : s.trim();
			if (out[f.key] === '' && f.type !== 'secret' && typeof f.default === 'string') {
				out[f.key] = f.default;
			}
		}
	}
	return out;
}

function normalizeTriggers(triggers: unknown): Trigger[] {
	const list = Array.isArray(triggers) ? triggers.map(String) : [];
	const bad = list.filter((t) => !(TRIGGERS as readonly string[]).includes(t));
	if (bad.length) {
		throw new IntegrationInputError(`Unknown trigger: ${bad.join(', ')}`, { field: 'triggers' });
	}
	return [...new Set(list)] as Trigger[];
}

/** All rows, oldest first, secrets decrypted. Server side only */
export async function listIntegrations(): Promise<Integration[]> {
	const rows = await db.select().from(integrations).orderBy(asc(integrations.createdAt));
	return rows.map(decryptConfig);
}

/** All rows with secrets blanked, safe to send to the browser */
export async function listIntegrationsForUI(): Promise<IntegrationView[]> {
	const rows = await db.select().from(integrations).orderBy(asc(integrations.createdAt));
	return rows.map(toView);
}

/** One row, secrets decrypted. Server side only */
export async function getIntegration(id: string): Promise<Integration | null> {
	const [row] = await db.select().from(integrations).where(eq(integrations.id, id));
	return row ? decryptConfig(row) : null;
}

export async function getIntegrationForUI(id: string): Promise<IntegrationView | null> {
	const [row] = await db.select().from(integrations).where(eq(integrations.id, id));
	return row ? toView(row) : null;
}

export interface SaveIntegrationInput {
	id?: string;
	kind: string;
	name: string;
	enabled: boolean;
	triggers: string[];
	config: Record<string, unknown>;
}

/** Fills blank secrets from the stored row, so the UI can submit without re-entering keys */
function withStoredSecrets(
	kind: IntegrationKind,
	config: Record<string, unknown>,
	stored: Integration | null
) {
	const out = { ...config };
	for (const key of kind.secrets) {
		if (out[key] === '' && stored && typeof stored.config[key] === 'string') {
			out[key] = stored.config[key];
		}
	}
	return out;
}

/** Required fields first, then the kind's own rules. Throws for the first field at fault */
function checkConfig(kind: IntegrationKind, config: Record<string, unknown>) {
	const missing = kind.fields.find(
		(f) => f.required && (config[f.key] === '' || config[f.key] == null)
	);
	if (missing) throw new IntegrationInputError('Required.', { field: missing.key });
	kind.validate?.(config);
}

/** Inserts or updates. A blank secret keeps the stored one. Returns the row, secrets decrypted */
export async function saveIntegration(input: SaveIntegrationInput): Promise<Integration> {
	const kind = kindOf(input.kind);
	const name = input.name?.trim();
	if (!name) throw new IntegrationInputError('Required.', { field: 'name' });
	const triggers = normalizeTriggers(input.triggers);
	const existing = input.id ? await getIntegration(input.id) : null;
	if (input.id && !existing) throw new IntegrationInputError('Integration not found');
	if (existing && existing.kind !== kind.kind) {
		throw new IntegrationInputError('The kind of an integration cannot change');
	}

	const config = withStoredSecrets(
		kind,
		normalizeConfig(kind.fields, input.config ?? {}),
		existing
	);
	checkConfig(kind, config);
	const stored = { ...config };
	for (const key of kind.secrets) {
		if (typeof stored[key] === 'string' && stored[key])
			stored[key] = encrypt(stored[key] as string);
	}

	const values = { kind: kind.kind, name, enabled: !!input.enabled, triggers, config: stored };
	const [row] = existing
		? await db
				.update(integrations)
				.set({ ...values, updatedAt: new Date() })
				.where(eq(integrations.id, existing.id))
				.returning()
		: await db.insert(integrations).values(values).returning();
	return decryptConfig(row!);
}

/**
 * Deletes the row; its deliveries cascade. `recordingIds` are the recordings that had one, for
 * pipeline.settleAfterIntegrationDelete (not called here: pipeline.ts imports this module).
 */
export async function deleteIntegration(
	id: string
): Promise<{ deleted: boolean; recordingIds: string[] }> {
	return db.transaction(async (tx) => {
		const touched = await tx
			.selectDistinct({ recordingId: deliveries.recordingId })
			.from(deliveries)
			.where(eq(deliveries.integrationId, id));
		const rows = await tx.delete(integrations).where(eq(integrations.id, id)).returning();
		return {
			deleted: rows.length > 0,
			recordingIds: rows.length ? touched.map((r) => r.recordingId) : []
		};
	});
}

/**
 * Checks a config without saving it. With `id`, blank secrets come from that stored row.
 * Resolves to what the kind found, rejects with DeliverError (or IntegrationInputError).
 */
export async function testIntegration(
	kindName: string,
	config: Record<string, unknown>,
	id: string | undefined,
	timeZone: string
): Promise<TestResult> {
	const kind = kindOf(kindName);
	const stored = id ? await getIntegration(id) : null;
	const full = withStoredSecrets(kind, normalizeConfig(kind.fields, config ?? {}), stored);
	checkConfig(kind, full);
	return kind.test(full, { timeZone });
}

/** Deliveries on record for an integration, for its delete dialog */
export async function deliveryCount(id: string): Promise<number> {
	const [row] = await db
		.select({ n: count() })
		.from(deliveries)
		.where(eq(deliveries.integrationId, id));
	return row?.n ?? 0;
}

/** Why a delivery was skipped, as the deliveries table shows it: "Off", "Takes single click" */
export function skipReason(integration: Pick<Integration, 'enabled' | 'triggers'> | undefined) {
	if (!integration || !integration.enabled || !integration.triggers.length) return 'Off';
	return `Takes ${integration.triggers.map((t) => triggerLabel(t).toLowerCase()).join(' or ')}`;
}

/** Enabled, and listening to `trigger` (an empty trigger list means all) */
export function integrationMatches(
	integration: Pick<Integration, 'enabled' | 'triggers'>,
	trigger: string
) {
	if (!integration.enabled) return false;
	return integration.triggers.length === 0 || integration.triggers.includes(trigger);
}
