import * as client from 'openid-client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { redirect, type RequestEvent } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import {
	OIDC_ISSUER,
	OIDC_CLIENT_ID,
	OIDC_CLIENT_SECRET,
	OIDC_SCOPES,
	ALLOWED_EMAILS,
	ALLOWED_SUBS,
	OIDC_REQUIRE_VERIFIED_EMAIL,
	AUTH_SECRET
} from '$app/env/private';
import { bumpSessionEpoch, sessionEpoch } from './settings.ts';
import { appOrigin } from './origin.ts';

/** `epoch` is missing on cookies from before epochs existed, which counts as 0 */
export type Session = { sub: string; email?: string; name?: string; exp: number; epoch?: number };

const SESSION_COOKIE = 'session';
const FLOW_COOKIE = 'oidc_flow';
/** The ID token, kept for id_token_hint at the identity provider's logout */
const ID_TOKEN_COOKIE = 'oidc_idt';
/** Carries an error across the identity provider's logout, which drops query parameters */
const ERROR_COOKIE = 'signin_error';
const SESSION_DAYS = 30;

/** ALLOWED_EMAILS ("*" allows any) and, when set, ALLOWED_SUBS */
export function isAllowed(user: { sub?: string; email?: string }) {
	if (ALLOWED_SUBS?.length && !(user.sub && ALLOWED_SUBS.includes(user.sub))) return false;
	if (ALLOWED_EMAILS.includes('*')) return true;
	return !!user.email && ALLOWED_EMAILS.includes(user.email.toLowerCase());
}

/**
 * Why a fresh sign-in is refused, or null. With an email allowlist in effect, an email the issuer
 * marks unverified is refused; an absent flag passes unless OIDC_REQUIRE_VERIFIED_EMAIL is set,
 * since many issuers omit it.
 */
export function signInDenial(user: { sub?: string; email?: string; verified?: boolean }) {
	if (!isAllowed(user)) return 'denied';
	if (ALLOWED_EMAILS.includes('*')) return null;
	if (user.verified === false || (OIDC_REQUIRE_VERIFIED_EMAIL && user.verified !== true)) {
		return 'unverified';
	}
	return null;
}

/** Some issuers send the flag as a string */
const flag = (v: unknown) =>
	v === true || v === 'true' ? true : v === false || v === 'false' ? false : undefined;

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

/** Only same-origin paths survive the round trip. Parsing catches '/\\host' and tab tricks */
export function safeNext(value: string | null | undefined) {
	if (!value || !value.startsWith('/')) return '/';
	try {
		const base = 'http://n.invalid';
		const u = new URL(value, base);
		return u.origin === base ? u.pathname + u.search + u.hash : '/';
	} catch {
		return '/';
	}
}

async function configOrSignInError(): Promise<client.Configuration> {
	try {
		return await getConfig();
	} catch (e) {
		console.error('OIDC discovery failed', e);
		redirect(303, '/auth/signin?error=idp');
	}
}

/** The IdP's logout URL, or null when it has none or cannot be reached */
async function endSessionUrl(event: RequestEvent, idToken: string | undefined) {
	try {
		const config = await getConfig();
		if (!config.serverMetadata().end_session_endpoint) return null;
		const params: Record<string, string> = {
			client_id: OIDC_CLIENT_ID,
			post_logout_redirect_uri: new URL('/auth/signin', appOrigin(event.url)).href
		};
		if (idToken) params.id_token_hint = idToken;
		return client.buildEndSessionUrl(config, params).href;
	} catch (e) {
		console.error('OIDC logout URL unavailable', e);
		return null;
	}
}

/** Error code for the sign-in page, from ?error= or from the cookie set before an IdP logout */
export function signInError(event: RequestEvent) {
	const fromCookie = event.cookies.get(ERROR_COOKIE);
	if (fromCookie) event.cookies.delete(ERROR_COOKIE, { path: '/' });
	return event.url.searchParams.get('error') ?? fromCookie ?? null;
}

export async function signIn(event: RequestEvent): Promise<never> {
	const form = await event.request.formData().catch(() => null);
	const config = await configOrSignInError();
	const code_verifier = client.randomPKCECodeVerifier();
	const code_challenge = await client.calculatePKCECodeChallenge(code_verifier);
	const state = client.randomState();
	const next = safeNext(event.url.searchParams.get('next'));
	event.cookies.set(FLOW_COOKIE, sign({ code_verifier, state, next, exp: Date.now() + 600_000 }), {
		...cookieOpts(event.url),
		maxAge: 600
	});
	const url = client.buildAuthorizationUrl(config, {
		redirect_uri: new URL('/auth/callback', appOrigin(event.url)).href,
		scope: OIDC_SCOPES,
		code_challenge,
		code_challenge_method: 'S256',
		state,
		// After a denial: make the IdP ask for credentials instead of reusing its session
		...(form?.get('switch') ? { prompt: 'login' } : {})
	});
	redirect(303, url, { external: true });
}

export async function callback(event: RequestEvent): Promise<never> {
	const flow = verify<{ code_verifier: string; state: string; next: string; exp: number }>(
		event.cookies.get(FLOW_COOKIE)
	);
	event.cookies.delete(FLOW_COOKIE, { path: '/' });
	if (!flow || flow.exp < Date.now()) redirect(303, '/auth/signin');
	const config = await configOrSignInError();

	// Same redirect_uri as signIn sent, which openid-client builds from origin and path
	const callbackUrl = new URL(event.url.pathname + event.url.search, appOrigin(event.url));
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
	let verified = flag(claims.email_verified);
	let name = typeof claims.name === 'string' ? claims.name : undefined;
	if (!email || verified === undefined || !name) {
		try {
			const info = await client.fetchUserInfo(config, tokens.access_token, claims.sub);
			if (!email && typeof info.email === 'string') {
				email = info.email;
				verified = flag(info.email_verified);
			} else if (email === info.email) {
				verified ??= flag(info.email_verified);
			}
			name ??= info.name ?? info.preferred_username;
		} catch {
			// userinfo is optional
		}
	}

	const denial = signInDenial({ sub: claims.sub, email, verified });
	if (denial) {
		// End the IdP session too, or the next sign-in logs the same account straight back in
		const logout = await endSessionUrl(event, tokens.id_token);
		if (logout) {
			event.cookies.set(ERROR_COOKIE, denial, { ...cookieOpts(event.url), maxAge: 600 });
			redirect(303, logout, { external: true });
		}
		redirect(303, `/auth/signin?error=${denial}`);
	}

	setSession(event, {
		sub: claims.sub,
		email,
		name,
		exp: Date.now() + SESSION_DAYS * 86400_000,
		epoch: await sessionEpoch()
	});
	if (tokens.id_token) {
		event.cookies.set(ID_TOKEN_COOKIE, tokens.id_token, {
			...cookieOpts(event.url),
			maxAge: SESSION_DAYS * 86400
		});
	}
	redirect(303, safeNext(flow.next));
}

function setSession(event: RequestEvent, s: Session) {
	event.cookies.set(SESSION_COOKIE, sign(s), {
		...cookieOpts(event.url),
		maxAge: SESSION_DAYS * 86400
	});
}

function clearSession(event: RequestEvent) {
	event.cookies.delete(SESSION_COOKIE, { path: '/' });
	event.cookies.delete(ID_TOKEN_COOKIE, { path: '/' });
}

/** Ends the local session, then the IdP session when the IdP has a logout endpoint */
export async function signOut(event: RequestEvent, everywhere = false): Promise<never> {
	if (everywhere && event.locals.session) await bumpSessionEpoch();
	const idToken = event.cookies.get(ID_TOKEN_COOKIE);
	clearSession(event);
	const logout = await endSessionUrl(event, idToken);
	if (logout) redirect(303, logout, { external: true });
	redirect(303, '/auth/signin');
}

export const handle: Handle = async ({ event, resolve }) => {
	let s = verify<Session>(event.cookies.get(SESSION_COOKIE));
	if (s && (s.exp <= Date.now() || !isAllowed(s) || (s.epoch ?? 0) !== (await sessionEpoch()))) {
		clearSession(event);
		s = null;
	}
	event.locals.session = s;
	return resolve(event);
};
