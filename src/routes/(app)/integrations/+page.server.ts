import { fail } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { deliveries, integrations } from '#lib/server/db/schema.ts';
import { kinds, listIntegrationsForUI, type Kind } from '#lib/server/integrations/index.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [rows, last] = await Promise.all([
		listIntegrationsForUI(),
		db
			.selectDistinctOn([deliveries.integrationId], {
				integrationId: deliveries.integrationId,
				status: deliveries.status,
				at: deliveries.updatedAt,
				recordingId: deliveries.recordingId
			})
			.from(deliveries)
			.orderBy(deliveries.integrationId, desc(deliveries.updatedAt))
	]);
	const lastBy = new Map(last.map((d) => [d.integrationId, d]));
	return {
		kinds: Object.values(kinds).map((k) => ({ kind: k.kind, label: k.label })),
		integrations: rows.map((r) => ({
			id: r.id,
			name: r.name,
			kind: r.kind,
			kindLabel: kinds[r.kind as Kind]?.label ?? r.kind,
			enabled: r.enabled,
			triggers: r.triggers,
			last: lastBy.get(r.id) ?? null
		}))
	};
};

export const actions: Actions = {
	enabled: async ({ request }) => {
		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		const enabled = data.get('enabled') === 'on';
		const rows = await db
			.update(integrations)
			.set({ enabled, updatedAt: new Date() })
			.where(eq(integrations.id, id))
			.returning({ id: integrations.id })
			.catch(() => []);
		if (!rows.length) return fail(404, { error: 'Integration not found' });
		return { id, enabled };
	}
};
