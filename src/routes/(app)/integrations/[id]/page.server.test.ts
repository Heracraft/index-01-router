import { beforeEach, describe, expect, it, vi } from 'vitest';

const saved = vi.hoisted(() => [] as { kind: string; id?: string }[]);
const tested = vi.hoisted(() => [] as string[]);

// A second kind next to obsidian, so a dropped ?kind= would show as the wrong kind
vi.mock('#lib/server/integrations/index.ts', () => {
	const kind = (name: string) => ({
		kind: name,
		label: name,
		fields: [{ key: 'url', label: 'URL', type: 'text' }],
		secrets: [],
		deliver: async () => ({ target: '' }),
		test: async () => 'ok'
	});
	const kinds = { obsidian: kind('obsidian'), stub: kind('stub') };
	return {
		kinds,
		TRIGGERS: ['single-click-hold', 'double-click-hold', 'upload'],
		isKind: (k: string) => Object.hasOwn(kinds, k),
		IntegrationInputError: class extends Error {},
		DeliverError: class extends Error {},
		deliveryCount: async () => 0,
		envFor: () => ({ envSet: {}, envValues: {} }),
		getIntegrationForUI: async () => null,
		deleteIntegration: async () => ({ deleted: false, recordingIds: [] }),
		saveIntegration: async (input: { kind: string }) => {
			saved.push(input);
			return { ...input, id: '00000000-0000-4000-8000-000000000001' };
		},
		testIntegration: async (kind: string) => {
			tested.push(kind);
			return { target: `${kind}.md`, state: 'new', heading: 'Notes' };
		}
	};
});
vi.mock('#lib/server/db/index.ts', () => ({ db: {} }));
vi.mock('#lib/server/settings.ts', () => ({ getSettings: async () => ({ timezone: 'UTC' }) }));
vi.mock('#lib/server/pipeline.ts', () => ({ settleAfterIntegrationDelete: async () => {} }));

const { actions } = await import('./+page.server.ts');

function post(search: string) {
	const url = new URL(`http://localhost/integrations/new${search}`);
	const body = new FormData();
	body.set('name', 'Stub');
	body.set('enabled', 'on');
	body.append('triggers', 'upload');
	body.set('config.url', 'http://x');
	const request = new Request(url, { method: 'POST', body });
	// Only the fields the actions read
	return { request, url, params: { id: 'new' } } as unknown as Parameters<
		NonNullable<typeof actions.save>
	>[0];
}

beforeEach(() => {
	saved.length = 0;
	tested.length = 0;
});

describe('new integration actions', () => {
	it('saves the kind from ?kind= next to the action param', async () => {
		await expect(actions.save!(post('?kind=stub&/save'))).rejects.toMatchObject({
			status: 303,
			location: '/integrations/00000000-0000-4000-8000-000000000001'
		});
		expect(saved).toEqual([expect.objectContaining({ kind: 'stub' })]);
	});

	it('tests the kind from ?kind=', async () => {
		await actions.test!(post('?kind=stub&/test'));
		expect(tested).toEqual(['stub']);
	});

	it('refuses a request without a kind instead of assuming obsidian', async () => {
		await expect(actions.save!(post('?/save'))).rejects.toMatchObject({ status: 400 });
		await expect(actions.test!(post('?/test'))).rejects.toMatchObject({ status: 400 });
		expect(saved).toEqual([]);
		expect(tested).toEqual([]);
	});
});
