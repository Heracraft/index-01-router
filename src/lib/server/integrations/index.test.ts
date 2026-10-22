import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
	OBSIDIAN_MCP_URL: undefined as string | undefined,
	OBSIDIAN_API_KEY: undefined as string | undefined
}));

vi.mock('$app/env/private', () => ({
	DATABASE_URL: 'postgres://invalid',
	AUTH_SECRET: 'x'.repeat(32),
	AUTH_SECRET_PREVIOUS: [],
	get OBSIDIAN_MCP_URL() {
		return env.OBSIDIAN_MCP_URL;
	},
	get OBSIDIAN_API_KEY() {
		return env.OBSIDIAN_API_KEY;
	}
}));

// eq() returns something the fake database below can read
vi.mock('drizzle-orm', async (orig) => ({
	...(await orig<typeof import('drizzle-orm')>()),
	eq: (column: { name: string }, value: unknown) => ({ column: column.name, value })
}));

type Row = {
	id: string;
	kind: string;
	name: string;
	enabled: boolean;
	triggers: string[];
	config: Record<string, unknown>;
	createdAt: Date;
	updatedAt: Date;
};
const store = vi.hoisted(() => ({ rows: [] as Row[] }));

vi.mock('../db/index.ts', () => {
	type Cond = { column: string; value: unknown };
	const field = (column: string) => (column === 'kind' ? 'kind' : 'id');
	const matching = (c: Cond) =>
		store.rows.filter((r) => r[field(c.column) as 'id' | 'kind'] === c.value);
	const copy = (rows: Row[]) => rows.map((r) => structuredClone(r));
	return {
		db: {
			select: () => ({
				from: () => ({
					orderBy: async () => copy(store.rows),
					where: (c: Cond) =>
						Object.assign(Promise.resolve(copy(matching(c))), {
							limit: async (n: number) => copy(matching(c)).slice(0, n)
						})
				})
			}),
			insert: () => ({
				values: (v: Omit<Row, 'id' | 'createdAt' | 'updatedAt'>) => ({
					returning: async () => {
						const row = {
							...structuredClone(v),
							id: `row-${store.rows.length + 1}`,
							createdAt: new Date(),
							updatedAt: new Date()
						};
						store.rows.push(row);
						return [structuredClone(row)];
					}
				})
			}),
			update: () => ({
				set: (v: Partial<Row>) => ({
					where: (c: Cond) => ({
						returning: async () => {
							const rows = matching(c);
							for (const r of rows) Object.assign(r, structuredClone(v));
							return copy(rows);
						}
					})
				})
			})
		}
	};
});

const {
	ensureEnvIntegrations,
	envFor,
	getIntegration,
	getIntegrationForUI,
	integrationMatches,
	kinds,
	listIntegrations,
	normalizeConfig,
	saveIntegration,
	testIntegration,
	TRIGGERS
} = await import('./index.ts');
const { decrypt } = await import('../crypto.ts');

const ENV_URL = 'https://vault.example.com/mcp/';

beforeEach(() => {
	store.rows = [];
	env.OBSIDIAN_MCP_URL = undefined;
	env.OBSIDIAN_API_KEY = undefined;
	vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('integrationMatches', () => {
	it('takes every trigger when the list is empty', () => {
		for (const t of TRIGGERS)
			expect(integrationMatches({ enabled: true, triggers: [] }, t)).toBe(true);
	});

	it('filters by trigger and by enabled', () => {
		const i = { enabled: true, triggers: ['double-click-hold'] };
		expect(integrationMatches(i, 'double-click-hold')).toBe(true);
		expect(integrationMatches(i, 'single-click-hold')).toBe(false);
		expect(integrationMatches({ ...i, enabled: false }, 'double-click-hold')).toBe(false);
	});
});

describe('normalizeConfig', () => {
	const fields = kinds.obsidian.fields;

	it('applies defaults, trims and drops unknown keys', () => {
		const c = normalizeConfig(fields, {
			url: ' http://o:27123/mcp/ ',
			apiKey: '',
			heading: '',
			entryTemplate: '- {{time}}\r\n{{transcript}}',
			extra: 'x'
		});
		expect(c).toEqual({
			url: 'http://o:27123/mcp/',
			apiKey: '',
			insecureTls: false,
			notePath: '{{date:YYYY-MM-DD}}.md',
			heading: 'Notes',
			entryTemplate: '- {{time}}\n{{transcript}}',
			newNoteTemplate: '## {{heading}}\n'
		});
	});

	it('has no default URL', () => {
		expect(normalizeConfig(fields, {}).url).toBe('');
	});

	it('reads form booleans', () => {
		expect(normalizeConfig(fields, { insecureTls: 'on' }).insecureTls).toBe(true);
		expect(normalizeConfig(fields, { insecureTls: false }).insecureTls).toBe(false);
	});
});

const input = (config: Record<string, unknown>) => ({
	kind: 'obsidian',
	name: 'Vault',
	enabled: true,
	triggers: [],
	config
});

describe('env fallbacks', () => {
	it('names the env variables that are set, and the URL value only', () => {
		expect(envFor(kinds.obsidian)).toEqual({ envSet: {}, envValues: {} });
		env.OBSIDIAN_MCP_URL = ENV_URL;
		env.OBSIDIAN_API_KEY = 'env-key';
		expect(envFor(kinds.obsidian)).toEqual({
			envSet: { url: 'OBSIDIAN_MCP_URL', apiKey: 'OBSIDIAN_API_KEY' },
			envValues: { url: ENV_URL }
		});
	});

	it('requires URL and key while the env has neither', async () => {
		await expect(saveIntegration(input({}))).rejects.toMatchObject({ field: 'url' });
		await expect(saveIntegration(input({ url: ENV_URL }))).rejects.toMatchObject({
			field: 'apiKey'
		});
	});

	it('saves blank fields blank and reads the env at use', async () => {
		env.OBSIDIAN_MCP_URL = ENV_URL;
		env.OBSIDIAN_API_KEY = 'env-key';
		const saved = await saveIntegration(input({}));
		expect(store.rows[0]!.config).toMatchObject({ url: '', apiKey: '' });
		expect(saved.config).toMatchObject({ url: ENV_URL, apiKey: 'env-key' });
		expect((await getIntegration(saved.id))!.config).toMatchObject({
			url: ENV_URL,
			apiKey: 'env-key'
		});
		expect((await listIntegrations())[0]!.config).toMatchObject({ apiKey: 'env-key' });
	});

	it('lets stored values override the env', async () => {
		env.OBSIDIAN_MCP_URL = ENV_URL;
		env.OBSIDIAN_API_KEY = 'env-key';
		const saved = await saveIntegration(
			input({ url: 'http://127.0.0.1:27123/mcp/', apiKey: 'own-key' })
		);
		expect(decrypt(store.rows[0]!.config.apiKey as string)).toBe('own-key');
		expect((await getIntegration(saved.id))!.config).toMatchObject({
			url: 'http://127.0.0.1:27123/mcp/',
			apiKey: 'own-key'
		});
	});

	it('does not store the env key when a save keeps blank secrets', async () => {
		env.OBSIDIAN_MCP_URL = ENV_URL;
		env.OBSIDIAN_API_KEY = 'env-key';
		const saved = await saveIntegration(input({}));
		await saveIntegration({ ...input({ heading: 'Inbox' }), id: saved.id });
		expect(store.rows[0]!.config).toMatchObject({ url: '', apiKey: '', heading: 'Inbox' });
	});

	it('drops a stored key on clear, so the env key applies again', async () => {
		env.OBSIDIAN_API_KEY = 'env-key';
		const saved = await saveIntegration(input({ url: ENV_URL, apiKey: 'own-key' }));
		await saveIntegration({ ...input({ url: ENV_URL }), id: saved.id });
		expect(decrypt(store.rows[0]!.config.apiKey as string)).toBe('own-key');
		await saveIntegration({ ...input({ url: ENV_URL }), id: saved.id, clearSecrets: ['apiKey'] });
		expect(store.rows[0]!.config.apiKey).toBe('');
		expect((await getIntegration(saved.id))!.config.apiKey).toBe('env-key');
	});

	it('tests with env values when the form leaves URL and key blank', async () => {
		const test = vi
			.spyOn(kinds.obsidian, 'test')
			.mockResolvedValue({ target: 'x.md', state: 'new', heading: 'Notes' });
		try {
			await expect(testIntegration('obsidian', {}, undefined, 'UTC')).rejects.toMatchObject({
				field: 'url'
			});
			env.OBSIDIAN_MCP_URL = ENV_URL;
			env.OBSIDIAN_API_KEY = 'env-key';
			const saved = await saveIntegration(input({}));
			await testIntegration('obsidian', { url: '', apiKey: '' }, saved.id, 'UTC');
			expect(test).toHaveBeenLastCalledWith(
				expect.objectContaining({ url: ENV_URL, apiKey: 'env-key' }),
				{ timeZone: 'UTC' }
			);
		} finally {
			test.mockRestore();
		}
	});

	it('never sends a key to the browser', async () => {
		env.OBSIDIAN_MCP_URL = ENV_URL;
		env.OBSIDIAN_API_KEY = 'env-key';
		const saved = await saveIntegration(input({}));
		const view = (await getIntegrationForUI(saved.id))!;
		expect(view.config).toMatchObject({ url: '', apiKey: '' });
		expect(view.secretsSet).toEqual({ apiKey: false });
		expect(view.envSet).toEqual({ url: 'OBSIDIAN_MCP_URL', apiKey: 'OBSIDIAN_API_KEY' });
		expect(view.envValues).toEqual({ url: ENV_URL });
		expect(JSON.stringify(view)).not.toContain('env-key');
	});
});

describe('ensureEnvIntegrations', () => {
	it('does nothing without OBSIDIAN_MCP_URL', async () => {
		expect(await ensureEnvIntegrations()).toBeNull();
		expect(store.rows).toEqual([]);
	});

	it('creates the Daily note integration once, reading URL and key from the env', async () => {
		env.OBSIDIAN_MCP_URL = ENV_URL;
		env.OBSIDIAN_API_KEY = 'env-key';
		const id = await ensureEnvIntegrations();
		expect(store.rows).toHaveLength(1);
		expect(store.rows[0]).toMatchObject({
			id,
			kind: 'obsidian',
			name: 'Daily note',
			enabled: true,
			triggers: [],
			config: normalizeConfig(kinds.obsidian.fields, {})
		});
		expect(store.rows[0]!.config).toMatchObject({ url: '', apiKey: '' });
		expect((await getIntegration(id!))!.config).toMatchObject({
			url: ENV_URL,
			apiKey: 'env-key'
		});
		expect(await ensureEnvIntegrations()).toBeNull();
		expect(store.rows).toHaveLength(1);
	});

	it('leaves an existing Obsidian integration alone', async () => {
		env.OBSIDIAN_MCP_URL = ENV_URL;
		env.OBSIDIAN_API_KEY = 'env-key';
		await saveIntegration(input({ url: 'http://127.0.0.1:27123/mcp/', apiKey: 'k' }));
		expect(await ensureEnvIntegrations()).toBeNull();
		expect(store.rows.map((r) => r.name)).toEqual(['Vault']);
	});
});
