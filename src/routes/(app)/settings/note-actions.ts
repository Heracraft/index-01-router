// Daily note sections on /settings: one form per integration, posting its id (or "new" and
// the kind). Kept apart from +page.server.ts so tests load only what these need.
import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { getSettings } from '#lib/server/settings.ts';
import {
	DeliverError,
	deleteIntegration,
	getIntegrationForUI,
	IntegrationInputError,
	isKind,
	kinds,
	saveIntegration,
	testIntegration,
	TRIGGERS,
	type Kind
} from '#lib/server/integrations/index.ts';
import { settleAfterIntegrationDelete } from '#lib/server/pipeline.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The integration a form posts for, and its kind. A new one must name its kind */
async function target(data: FormData) {
	const id = String(data.get('id') ?? '');
	if (id === 'new') {
		const kind = String(data.get('kind') ?? '');
		if (!kind) error(400, 'Missing integration kind');
		if (!isKind(kind)) error(404, `Unknown integration kind: ${kind}`);
		return { id: null, kind };
	}
	const row = UUID.test(id) ? await getIntegrationForUI(id) : null;
	if (!row || !isKind(row.kind)) error(404, 'Integration not found');
	return { id: row.id, kind: row.kind as Kind };
}

/** Form fields to the shape saveIntegration and testIntegration take */
function readForm(data: FormData, kindName: Kind) {
	const kind = kinds[kindName];
	const config: Record<string, unknown> = {};
	for (const f of kind.fields) {
		const key = `config.${f.key}`;
		if (f.type === 'boolean') config[f.key] = data.get(key) === 'on';
		else config[f.key] = String(data.get(key) ?? '');
	}
	const picked = data.getAll('triggers').map(String);
	// Remove on a stored secret: blank it, so its env variable applies again
	const clearSecrets = kind.secrets.filter((k) => data.get(`config.${k}.clear`) === '1');
	return {
		name: String(data.get('name') ?? ''),
		enabled: data.get('enabled') === 'on',
		// Every trigger ticked is stored as "all", so a trigger added later reaches it too
		triggers: picked.length === TRIGGERS.length ? [] : picked,
		noTriggers: picked.length === 0,
		config,
		clearSecrets
	};
}

export async function saveNote({ request }: RequestEvent) {
	const data = await request.formData();
	const { id, kind } = await target(data);
	const input = readForm(data, kind);
	const key = id ?? 'new';
	if (input.noTriggers) {
		return fail(400, { action: 'note', id: key, error: 'Pick at least one.', field: 'triggers' });
	}
	try {
		const row = await saveIntegration({
			id: id ?? undefined,
			kind,
			name: input.name,
			enabled: input.enabled,
			triggers: input.triggers,
			config: input.config,
			clearSecrets: input.clearSecrets
		});
		if (!id) redirect(303, `/settings#note-${row.id}`);
		return { action: 'note', id: key, saved: true };
	} catch (e) {
		if (e instanceof IntegrationInputError) {
			return fail(400, { action: 'note', id: key, error: e.message, field: e.field ?? null });
		}
		throw e;
	}
}

export async function testNote({ request }: RequestEvent) {
	const data = await request.formData();
	const { id, kind } = await target(data);
	const input = readForm(data, kind);
	const { timezone } = await getSettings('general');
	const key = id ?? 'new';
	try {
		const found = await testIntegration(
			kind,
			input.config,
			id ?? undefined,
			timezone,
			input.clearSecrets
		);
		return { action: 'noteTest', id: key, test: { ok: true as const, ...found }, field: null };
	} catch (e) {
		const field =
			e instanceof DeliverError || e instanceof IntegrationInputError ? (e.field ?? null) : null;
		return {
			action: 'noteTest',
			id: key,
			test: { ok: false as const, message: message(e) },
			field
		};
	}
}

export async function deleteNote({ request }: RequestEvent) {
	const id = String((await request.formData()).get('id') ?? '');
	if (UUID.test(id)) {
		const { recordingIds } = await deleteIntegration(id);
		await settleAfterIntegrationDelete(recordingIds);
	}
	redirect(303, '/settings#note');
}
