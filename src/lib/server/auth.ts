import * as client from 'openid-client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import {
	OIDC_ISSUER,
	OIDC_CLIENT_ID,
	OIDC_CLIENT_SECRET,
	OIDC_SCOPES,
	ALLOWED_EMAILS,
	AUTH_SECRET
} from '$app/env/private';

export type Session = { sub: string; email?: string; name?: string; exp: number };

const SESSION_COOKIE = 'session';
const FLOW_COOKIE = 'oidc_flow';
const SESSION_DAYS = 30;

let configPromise: Promise<client.Configuration> | undefined;

/** Discovery is lazy so the app boots while the IdP is down */
function getConfig() {
	return (configPromise ??= client
		.discovery(
			new URL(OIDC_ISSUER),
			OIDC_CLIENT_ID,
			OIDC_CLIENT_SECRET,
			undefined,
			new URL(OIDC_ISSUER).protocol === 'http:'
				? { execute: [client.allowInsecureRequests] }
				: undefined
		)
		.catch((e) => {
			configPromise = undefined;
			throw e;
		}));
}

function sign(payload: object) {
	const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
	const mac = createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
	return `${body}.${mac}`;
}

function verify<T>(token: string | undefined): T | null {
	if (!token) return null;
	const [body, mac] = token.split('.');
	if (!body || !mac) return null;
	const expected = createHmac('sha256', AUTH_SECRET).update(body).digest();
	const given = Buffer.from(mac, 'base64url');
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
	try {
		return JSON.parse(Buffer.from(body, 'base64url').toString()) as T;
	} catch {
		return null;
	}
}

/** Secure follows the request protocol (PROTOCOL_HEADER behind a proxy), so plain http works too */
const cookieOpts = (url: URL) => ({
	path: '/',
	httpOnly: true,
	sameSite: 'lax' as const,
	secure: url.protocol === 'https:'
});

/** Only same-origin relative paths survive the round trip */
function safeNext(value: string | null | undefined) {
	return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export async function signIn(event: RequestEvent): Promise<never> {
	let config: client.Configuration;
	try {
		config = await getConfig();
	} catch (e) {
		console.error('OIDC discovery failed', e);
		error(502, `Could not reach the identity provider at ${OIDC_ISSUER}`);
	}
	const code_verifier = client.randomPKCECodeVerifier();
	const code_challenge = await client.calculatePKCECodeChallenge(code_verifier);
	const state = client.randomState();
	const next = safeNext(event.url.searchParams.get('next'));
	event.cookies.set(FLOW_COOKIE, sign({ code_verifier, state, next, exp: Date.now() + 600_000 }), {
		...cookieOpts(event.url),
		maxAge: 600
	});
	const url = client.buildAuthorizationUrl(config, {
		redirect_uri: new URL('/auth/callback', event.url.origin).href,
		scope: OIDC_SCOPES,
		code_challenge,
		code_challenge_method: 'S256',
		state
	});
	redirect(303, url, { external: true });
}

export async function callback(event: RequestEvent): Promise<never> {
	const config = await getConfig();
	const flow = verify<{ code_verifier: string; state: string; next: string; exp: number }>(
		event.cookies.get(FLOW_COOKIE)
	);
	event.cookies.delete(FLOW_COOKIE, { path: '/' });
	if (!flow || flow.exp < Date.now()) redirect(303, '/auth/signin');

	const callbackUrl = new URL(event.url);
	let tokens: Awaited<ReturnType<typeof client.authorizationCodeGrant>>;
	try {
		tokens = await client.authorizationCodeGrant(config, callbackUrl, {
			pkceCodeVerifier: flow.code_verifier,
			expectedState: flow.state
		});
	} catch (e) {
		console.error('OIDC code exchange failed', e);
		redirect(303, '/auth/signin?error=exchange');
	}
	const claims = tokens.claims();
	if (!claims) redirect(303, '/auth/signin?error=exchange');

	let email = typeof claims.email === 'string' ? claims.email : undefined;
	let name = typeof claims.name === 'string' ? claims.name : undefined;
	if (!email || !name) {
		try {
			const info = await client.fetchUserInfo(config, tokens.access_token, claims.sub);
			email ??= info.email;
			name ??= info.name ?? info.preferred_username;
		} catch {
			// userinfo is optional
		}
	}
	if (ALLOWED_EMAILS.length && !(email && ALLOWED_EMAILS.includes(email.toLowerCase()))) {
		redirect(303, '/auth/signin?error=denied');
	}

	setSession(event, {
		sub: claims.sub,
		email,
		name,
		exp: Date.now() + SESSION_DAYS * 86400_000
	});
	redirect(303, safeNext(flow.next));
}

function setSession(event: RequestEvent, s: Session) {
	event.cookies.set(SESSION_COOKIE, sign(s), {
		...cookieOpts(event.url),
		maxAge: SESSION_DAYS * 86400
	});
}

export function signOut(event: RequestEvent): never {
	event.cookies.delete(SESSION_COOKIE, { path: '/' });
	redirect(303, '/auth/signin');
}

export const handle: Handle = async ({ event, resolve }) => {
	const s = verify<Session>(event.cookies.get(SESSION_COOKIE));
	event.locals.session = s && s.exp > Date.now() ? s : null;
	return resolve(event);
};
