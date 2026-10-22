import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/env/private', () => ({
	DATABASE_URL: 'postgres://invalid',
	AUTH_SECRET: 'x'.repeat(32)
}));

const { integrationMatches, kinds, normalizeConfig, TRIGGERS } = await import('./index.ts');

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
			newNoteTemplate: '## Notes\n'
		});
	});

	it('reads form booleans', () => {
		expect(normalizeConfig(fields, { insecureTls: 'on' }).insecureTls).toBe(true);
		expect(normalizeConfig(fields, { insecureTls: false }).insecureTls).toBe(false);
	});
});
