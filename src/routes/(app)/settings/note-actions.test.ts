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
vi.mock('#lib/server/settings.ts', () => ({ getSettings: async () => ({ timezone: 'UTC' }) }));
vi.mock('#lib/server/pipeline.ts', () => ({ settleAfterIntegrationDelete: async () => {} }));

const { saveNote, testNote } = await import('./note-actions.ts');

function post(fields: Record<string, string>) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	body.set('name', 'Stub');
	body.set('enabled', 'on');
	body.append('triggers', 'upload');
	body.set('config.url', 'http://x');
	const request = new Request('http://localhost/settings?/note', { method: 'POST', body });
	// Only the fields the actions read
	return { request } as unknown as Parameters<typeof saveNote>[0];
}

beforeEach(() => {
	saved.length = 0;
	tested.length = 0;
});

describe('new integration actions', () => {
	it('saves the kind the form names and lands on its section', async () => {
		await expect(saveNote(post({ id: 'new', kind: 'stub' }))).rejects.toMatchObject({
			status: 303,
			location: '/settings#note-00000000-0000-4000-8000-000000000001'
		});
		expect(saved).toEqual([expect.objectContaining({ kind: 'stub' })]);
	});

	it('tests the kind the form names', async () => {
		await testNote(post({ id: 'new', kind: 'stub' }));
		expect(tested).toEqual(['stub']);
	});

	it('refuses a new integration without a kind instead of assuming obsidian', async () => {
		await expect(saveNote(post({ id: 'new' }))).rejects.toMatchObject({ status: 400 });
		await expect(testNote(post({ id: 'new' }))).rejects.toMatchObject({ status: 400 });
		expect(saved).toEqual([]);
		expect(tested).toEqual([]);
	});

	it('refuses an id that is not an integration', async () => {
		await expect(saveNote(post({ id: 'nope' }))).rejects.toMatchObject({ status: 404 });
	});
});
