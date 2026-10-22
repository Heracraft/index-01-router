import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it } from 'vitest';
import {
	continuesList,
	findHeadingPath,
	obsidianConfig,
	OBSIDIAN_DEFAULTS,
	separatorBefore,
	toDeliverError
} from './obsidian.ts';
import { DeliverError } from './types.ts';

describe('findHeadingPath', () => {
	const map = {
		'2026-10-22': { Tasks: {}, Notes: { Later: {} }, Journal: {} },
		Other: { notes: {} }
	};

	it('returns the full path at any depth', () => {
		expect(findHeadingPath(map, 'Notes')).toEqual(['2026-10-22', 'Notes']);
		expect(findHeadingPath(map, 'Later')).toEqual(['2026-10-22', 'Notes', 'Later']);
		expect(findHeadingPath({ Notes: {} }, 'Notes')).toEqual(['Notes']);
	});

	it('prefers an exact match, then ignores case', () => {
		expect(findHeadingPath({ notes: {}, x: { Notes: {} } }, 'Notes')).toEqual(['x', 'Notes']);
		expect(findHeadingPath({ a: { NOTES: {} } }, 'Notes')).toEqual(['a', 'NOTES']);
	});

	it('returns null when absent', () => {
		expect(findHeadingPath({ a: { b: {} } }, 'Notes')).toBeNull();
		expect(findHeadingPath({}, 'Notes')).toBeNull();
	});
});

describe('separatorBefore', () => {
	it('leaves one blank line before appended text', () => {
		expect(separatorBefore('')).toBe('');
		expect(separatorBefore('a')).toBe('\n\n');
		expect(separatorBefore('a\n')).toBe('\n');
		expect(separatorBefore('a\n\n')).toBe('');
	});
});

describe('continuesList', () => {
	it('extends a list that ends the section', () => {
		expect(continuesList('- a\n- b\n', '- c')).toBe(true);
		expect(continuesList('Intro\n\n- a\n  more\n', '- c')).toBe(true);
		expect(continuesList('1. a\n', '- c')).toBe(true);
	});

	it('starts a new block otherwise', () => {
		expect(continuesList('', '- c')).toBe(false);
		expect(continuesList('- a\n\nSome text\n', '- c')).toBe(false);
		expect(continuesList('- a\n\n### Later\n- b\n', '- c')).toBe(false);
		expect(continuesList('- a\n', 'Plain entry')).toBe(false);
	});
});

describe('obsidianConfig', () => {
	it('fills defaults and strips heading hashes', () => {
		const c = obsidianConfig({
			url: ' http://x/mcp/ ',
			apiKey: 'k',
			heading: '## Log',
			notePath: ''
		});
		expect(c).toEqual({ ...OBSIDIAN_DEFAULTS, url: 'http://x/mcp/', apiKey: 'k', heading: 'Log' });
	});

	it('keeps an empty new note template and reads boolean strings', () => {
		const c = obsidianConfig({ newNoteTemplate: '', insecureTls: 'true' });
		expect(c.newNoteTemplate).toBe('');
		expect(c.insecureTls).toBe(true);
	});
});

describe('toDeliverError', () => {
	const url = 'http://obsidian/mcp/';
	const refused = Object.assign(new TypeError('fetch failed'), {
		cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' })
	});

	it('marks auth and missing endpoints as final', () => {
		expect(toDeliverError(new StreamableHTTPError(401, 'no'), url)).toMatchObject({
			retryable: false,
			message: 'Obsidian rejected the API key'
		});
		expect(toDeliverError(new StreamableHTTPError(404, 'no'), url).retryable).toBe(false);
	});

	it('retries network errors and server errors', () => {
		expect(toDeliverError(refused, url)).toMatchObject({
			retryable: true,
			message: `Cannot reach ${url} (ECONNREFUSED)`
		});
		expect(toDeliverError(new StreamableHTTPError(503, 'busy'), url).retryable).toBe(true);
	});

	it('explains certificate failures', () => {
		const tls = Object.assign(new TypeError('fetch failed'), {
			cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }
		});
		const e = toDeliverError(tls, url);
		expect(e.retryable).toBe(false);
		expect(e.message).toContain('insecure TLS');
	});

	it('passes DeliverError through', () => {
		const e = new DeliverError('x', false);
		expect(toDeliverError(e, url)).toBe(e);
	});
});
