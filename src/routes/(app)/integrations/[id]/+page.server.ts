import { error, fail, redirect } from '@sveltejs/kit';
import {
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
import type { Actions, PageServerLoad } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function kindMeta(kind: Kind) {
	const k = kinds[kind];
	return { kind: k.kind, label: k.label, fields: k.fields, secrets: k.secrets };
}

export const load: PageServerLoad = async ({ params, url }) => {
	if (params.id === 'new') {
		const kind = url.searchParams.get('kind') ?? 'obsidian';
		if (!isKind(kind)) error(404, `Unknown integration kind: ${kind}`);
		const meta = kindMeta(kind);
		const config: Record<string, unknown> = {};
		for (const f of meta.fields) config[f.key] = f.default ?? (f.type === 'boolean' ? false : '');
		return {
			kind: meta,
			triggers: TRIGGERS,
			integration: {
				id: null,
				name: meta.label,
				enabled: true,
				triggers: [] as string[],
				config,
				secretsSet: {} as Record<string, boolean>
			}
		};
	}
	if (!UUID.test(params.id)) error(404, 'Integration not found');
	const row = await getIntegrationForUI(params.id);
	if (!row || !isKind(row.kind)) error(404, 'Integration not found');
	return {
		kind: kindMeta(row.kind),
		triggers: TRIGGERS,
		integration: {
			id: row.id,
			name: row.name,
			enabled: row.enabled,
			triggers: row.triggers,
			config: row.config,
			secretsSet: row.secretsSet
		}
	};
};

/** Form fields to the shape saveIntegration and testIntegration take */
async function readForm(request: Request, kindName: string) {
	const data = await request.formData();
	const kind = kinds[kindName as Kind];
	const config: Record<string, unknown> = {};
	for (const f of kind.fields) {
		const key = `config.${f.key}`;
		if (f.type === 'boolean') config[f.key] = data.get(key) === 'on';
		else config[f.key] = String(data.get(key) ?? '');
	}
	const picked = data.getAll('triggers').map(String);
	return {
		name: String(data.get('name') ?? ''),
		enabled: data.get('enabled') === 'on',
		// Every trigger ticked is stored as "all", so a trigger added later reaches it too
		triggers: picked.length === TRIGGERS.length ? [] : picked,
		noTriggers: picked.length === 0,
		config
	};
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function kindFor(id: string, url: URL) {
	if (id === 'new') {
		// The form keeps ?kind= in its action URLs; without it the kind is unknown
		const kind = url.searchParams.get('kind');
		if (!kind) error(400, 'Missing integration kind');
		return kind;
	}
	const row = UUID.test(id) ? await getIntegrationForUI(id) : null;
	if (!row) error(404, 'Integration not found');
	return row.kind;
}

export const actions: Actions = {
	save: async ({ request, params, url }) => {
		const kind = await kindFor(params.id, url);
		if (!isKind(kind)) error(404, `Unknown integration kind: ${kind}`);
		const input = await readForm(request, kind);
		if (input.noTriggers) {
			return fail(400, {
				action: 'save',
				error: 'Triggers: pick at least one.',
				field: 'triggers'
			});
		}
		try {
			const row = await saveIntegration({
				id: params.id === 'new' ? undefined : params.id,
				kind,
				name: input.name,
				enabled: input.enabled,
				triggers: input.triggers,
				config: input.config
			});
			if (params.id === 'new') redirect(303, `/integrations/${row.id}`);
			return { action: 'save', saved: true };
		} catch (e) {
			if (e instanceof IntegrationInputError) {
				return fail(400, { action: 'save', error: e.message, field: null });
			}
			throw e;
		}
	},
	test: async ({ request, params, url }) => {
		const kind = await kindFor(params.id, url);
		if (!isKind(kind)) error(404, `Unknown integration kind: ${kind}`);
		const input = await readForm(request, kind);
		try {
			const result = await testIntegration(
				kind,
				input.config,
				params.id === 'new' ? undefined : params.id
			);
			return { action: 'test', test: { ok: true, message: result } };
		} catch (e) {
			return { action: 'test', test: { ok: false, message: message(e) } };
		}
	},
	delete: async ({ params }) => {
		if (UUID.test(params.id)) {
			const { recordingIds } = await deleteIntegration(params.id);
			await settleAfterIntegrationDelete(recordingIds);
		}
		redirect(303, '/integrations');
	}
};
