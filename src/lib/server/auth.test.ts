import { createHmac } from 'node:crypto';
import { isRedirect, type RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The callback test talks to the dev mock IdP. Opt in:
//   OIDC_TEST_ISSUER=http://localhost:8090/default pnpm exec vitest run src/lib/server/auth.test.ts
const issuer = process.env.OIDC_TEST_ISSUER;
const SECRET = 's'.repeat(32);

const env = vi.hoisted(() => ({
	OIDC_ISSUER: process.env.OIDC_TEST_ISSUER ?? 'http://localhost:8090/default',
	ALLOWED_EMAILS: [] as string[],
	ALLOWED_SUBS: [] as string[],
	OIDC_REQUIRE_VERIFIED_EMAIL: false
}));
const epoch = vi.hoisted(() => ({ value: 0, bumps: 0 }));

vi.mock('$app/env/private', () => ({
	get OIDC_ISSUER() {
		return env.OIDC_ISSUER;
	},
	OIDC_CLIENT_ID: 'index-01-router',
	OIDC_CLIENT_SECRET: undefined,
	OIDC_SCOPES: 'openid profile email',
	PUBLIC_URL: undefined,
	AUTH_SECRET: 's'.repeat(32),
	get ALLOWED_EMAILS() {
		return env.ALLOWED_EMAILS;
	},
	get ALLOWED_SUBS() {
		return env.ALLOWED_SUBS;
	},
	get OIDC_REQUIRE_VERIFIED_EMAIL() {
		return env.OIDC_REQUIRE_VERIFIED_EMAIL;
	}
}));
vi.mock('./settings.ts', () => ({
	sessionEpoch: async () => epoch.value,
	bumpSessionEpoch: async () => {
		epoch.bumps++;
		epoch.value++;
	}
}));

const auth = await import('./auth.ts');

beforeEach(() => {
	env.OIDC_ISSUER = issuer ?? 'http://localhost:8090/default';
	env.ALLOWED_EMAILS = ['me@example.com'];
	env.ALLOWED_SUBS = [];
	env.OIDC_REQUIRE_VERIFIED_EMAIL = false;
	epoch.value = 0;
	epoch.bumps = 0;
});

function fakeEvent(url: string, cookies: Record<string, string> = {}, form?: FormData) {
	const jar = { ...cookies };
	const event = {
		url: new URL(url),
		request: new Request(url, form ? { method: 'POST', body: form } : undefined),
		cookies: {
			get: (n: string) => jar[n],
			set: (n: string, v: string) => void (jar[n] = v),
			delete: (n: string) => void delete jar[n]
		},
		locals: {} as App.Locals
	};
	return { event: event as unknown as RequestEvent, jar };
}

function cookieFor(payload: object) {
	const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
	return `${body}.${createHmac('sha256', SECRET).update(body).digest('base64url')}`;
}

async function redirectOf(p: Promise<unknown>) {
	try {
		await p;
	} catch (e) {
		if (isRedirect(e)) return e.location;
		throw e;
	}
	throw new Error('no redirect');
}

async function runHandle(session: object) {
	const { event, jar } = fakeEvent('http://app.test/', { session: cookieFor(session) });
	await auth.handle({ event, resolve: async () => new Response('ok') });
	return { session: event.locals.session, jar };
}

const valid = { sub: 'u1', email: 'Me@example.com', exp: Date.now() + 60_000 };

describe('handle', () => {
	it('keeps a valid session, including one from before epochs', async () => {
		expect((await runHandle(valid)).session?.sub).toBe('u1');
		expect((await runHandle({ ...valid, epoch: 0 })).session?.sub).toBe('u1');
	});

	it('drops a session whose email left ALLOWED_EMAILS', async () => {
		env.ALLOWED_EMAILS = ['other@example.com'];
		const { session, jar } = await runHandle(valid);
		expect(session).toBeNull();
		expect(jar.session).toBeUndefined();
	});

	it('drops a session without email unless "*" is set', async () => {
		expect((await runHandle({ ...valid, email: undefined })).session).toBeNull();
		env.ALLOWED_EMAILS = ['*'];
		expect((await runHandle({ ...valid, email: undefined })).session?.sub).toBe('u1');
	});

	it('drops a session from an older epoch', async () => {
		epoch.value = 2;
		expect((await runHandle({ ...valid, epoch: 1 })).session).toBeNull();
		expect((await runHandle(valid)).session).toBeNull();
		expect((await runHandle({ ...valid, epoch: 2 })).session?.sub).toBe('u1');
	});

	it('drops expired and forged sessions', async () => {
		expect((await runHandle({ ...valid, exp: Date.now() - 1 })).session).toBeNull();
		const { event } = fakeEvent('http://app.test/', { session: 'e30.bad' });
		await auth.handle({ event, resolve: async () => new Response('ok') });
		expect(event.locals.session).toBeNull();
	});
});

describe('signInDenial', () => {
	it('checks emails, subjects and email_verified', () => {
		expect(auth.signInDenial({ sub: 'u1', email: 'ME@example.com' })).toBeNull();
		expect(auth.signInDenial({ sub: 'u1', email: 'me@example.com', verified: true })).toBeNull();
		expect(auth.signInDenial({ sub: 'u1', email: 'me@example.com', verified: false })).toBe(
			'unverified'
		);
		expect(auth.signInDenial({ sub: 'u1', email: 'x@example.com' })).toBe('denied');
		expect(auth.signInDenial({ sub: 'u1' })).toBe('denied');

		env.OIDC_REQUIRE_VERIFIED_EMAIL = true;
		expect(auth.signInDenial({ sub: 'u1', email: 'me@example.com' })).toBe('unverified');

		env.ALLOWED_SUBS = ['u2'];
		expect(auth.signInDenial({ sub: 'u1', email: 'me@example.com', verified: true })).toBe(
			'denied'
		);
		env.ALLOWED_EMAILS = ['*'];
		expect(auth.signInDenial({ sub: 'u2' })).toBeNull();
	});
});

describe('safeNext', () => {
	it('keeps same-origin paths only', () => {
		expect(auth.safeNext('/x?y=1#z')).toBe('/x?y=1#z');
		expect(auth.safeNext('/webhook')).toBe('/webhook');
		for (const bad of ['//e.com', '/\\e.com', '/\\\\e.com/x', '/\t/e.com', 'https://e.com', '']) {
			expect(auth.safeNext(bad)).toBe('/');
		}
		expect(auth.safeNext(null)).toBe('/');
	});
});

/** Payload of the signed sign-in error cookie */
const errorOf = (cookie: string) =>
	JSON.parse(Buffer.from(cookie.split('.')[0]!, 'base64url').toString()) as object;

describe('callback without the IdP', () => {
	it('sends a stale callback back to sign-in before discovery', async () => {
		env.OIDC_ISSUER = 'http://127.0.0.1:9/down';
		const { event } = fakeEvent('http://app.test/auth/callback?code=x&state=y');
		expect(await redirectOf(auth.callback(event))).toBe('/auth/signin');
	});

	it('shows the idp error when discovery fails', async () => {
		env.OIDC_ISSUER = 'http://127.0.0.1:9/down';
		const flow = cookieFor({ code_verifier: 'v', state: 'y', next: '/', exp: Date.now() + 1000 });
		const cb = fakeEvent('http://app.test/auth/callback?code=x&state=y', { oidc_flow: flow });
		expect(await redirectOf(auth.callback(cb.event))).toBe('/auth/signin?error=idp');
		const si = fakeEvent('http://app.test/auth/signin', {}, new FormData());
		expect(await redirectOf(auth.signIn(si.event))).toBe('/auth/signin?error=idp');
	});
});

describe.skipIf(!issuer)('callback against the mock IdP', () => {
	async function signInAndReturn(form?: FormData, claims: object = {}) {
		const { event, jar } = fakeEvent('http://app.test/auth/signin?next=/webhook', {}, form);
		const authorize = await redirectOf(auth.signIn(event));
		// The mock's login form: any username, extra claims as JSON
		const res = await fetch(authorize, {
			method: 'POST',
			body: new URLSearchParams({ username: 'u1', claims: JSON.stringify(claims) }),
			redirect: 'manual'
		});
		const back = res.headers.get('location')!;
		expect(back).toContain('http://app.test/auth/callback?');
		const cb = fakeEvent(back, { oidc_flow: jar.oidc_flow });
		return { authorize, location: await redirectOf(auth.callback(cb.event)), jar: cb.jar };
	}

	it('ends the IdP session when the account is denied', async () => {
		const { location, jar } = await signInAndReturn();
		const meta = await (await fetch(`${issuer}/.well-known/openid-configuration`)).json();
		expect(location.startsWith(meta.end_session_endpoint)).toBe(true);
		const u = new URL(location);
		expect(u.searchParams.get('id_token_hint')).toBeTruthy();
		expect(u.searchParams.get('post_logout_redirect_uri')).toBe('http://app.test/auth/signin');
		expect(errorOf(jar.signin_error)).toEqual({ code: 'denied' });
		expect(jar.session).toBeUndefined();
	});

	it('refuses an allowed email the issuer marks unverified', async () => {
		const { location, jar } = await signInAndReturn(undefined, {
			email: 'me@example.com',
			email_verified: false
		});
		expect(new URL(location).pathname).toBe('/default/endsession');
		expect(errorOf(jar.signin_error)).toEqual({ code: 'unverified', email: 'me@example.com' });
		expect(jar.session).toBeUndefined();
	});

	it('signs in an allowed, verified email', async () => {
		const { location, jar } = await signInAndReturn(undefined, {
			email: 'me@example.com',
			email_verified: true
		});
		expect(location).toBe('/webhook');
		expect(jar.session).toBeTruthy();
	});

	it('signs in with "*", stamps the epoch and keeps next', async () => {
		env.ALLOWED_EMAILS = ['*'];
		epoch.value = 3;
		const { location, jar } = await signInAndReturn();
		expect(location).toBe('/webhook');
		const payload = JSON.parse(Buffer.from(jar.session.split('.')[0], 'base64url').toString());
		expect(payload.epoch).toBe(3);
		expect(jar.oidc_idt).toBeTruthy();
	});

	it('asks for a fresh login when switching accounts', async () => {
		const form = new FormData();
		form.set('switch', '1');
		const { authorize } = await signInAndReturn(form);
		expect(new URL(authorize).searchParams.get('prompt')).toBe('login');
	});
});

describe('signOut', () => {
	it('bumps the epoch only for "everywhere" with a session', async () => {
		const { event } = fakeEvent('http://app.test/auth/signout', { session: 'x' });
		event.locals.session = { ...valid };
		await redirectOf(auth.signOut(event));
		expect(epoch.bumps).toBe(0);
		const second = fakeEvent('http://app.test/auth/signout', { session: 'x', oidc_idt: 't' });
		second.event.locals.session = { ...valid };
		await redirectOf(auth.signOut(second.event, true));
		expect(epoch.bumps).toBe(1);
		expect(second.jar.session).toBeUndefined();
		expect(second.jar.oidc_idt).toBeUndefined();
	});
});
