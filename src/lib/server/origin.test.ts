import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/env/private', () => ({ PUBLIC_URL: 'https://index.example.com/some/path/' }));

const { appOrigin, originOf, publicOrigin } = await import('./origin.ts');

describe('originOf', () => {
	it('keeps scheme, host and port only', () => {
		expect(originOf('http://localhost:3000/')).toBe('http://localhost:3000');
		expect(originOf('https://index.example.com/hooks?x=1')).toBe('https://index.example.com');
	});

	it('rejects empty, relative and non-http values', () => {
		expect(originOf(undefined)).toBeUndefined();
		expect(originOf('')).toBeUndefined();
		expect(originOf('index.example.com')).toBeUndefined();
		expect(originOf('ftp://index.example.com')).toBeUndefined();
	});
});

describe('appOrigin', () => {
	it('prefers PUBLIC_URL over the detected origin', () => {
		expect(publicOrigin).toBe('https://index.example.com');
		expect(appOrigin(new URL('http://10.0.0.5:3000/auth/signin'))).toBe(
			'https://index.example.com'
		);
	});
});
