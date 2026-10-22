import { error, redirect } from '@sveltejs/kit';
import { sequence, type Handle, type ServerInit } from '@sveltejs/kit/hooks';
import { building, dev } from '$app/env';
import { handle as authenticationHandle } from '#lib/server/auth.ts';
import { closeDb, runMigrations } from '#lib/server/db/index.ts';
import { startWorker, stopAccepting, whenIdle } from '#lib/server/pipeline.ts';
import { installShutdown } from '#lib/server/shutdown.ts';
import { publicOrigin } from '#lib/server/origin.ts';
import { reencryptStored } from '#lib/server/settings.ts';
import { ALLOWED_EMAILS } from '$app/env/private';

export const init: ServerInit = async () => {
	if (building) return;
	await runMigrations();
	await reencryptStored();
	if (ALLOWED_EMAILS.includes('*')) {
		console.warn('ALLOWED_EMAILS is "*": any account at the identity provider can sign in');
	}
	startWorker();
	// Vite handles Ctrl+C in dev; a signal listener there would keep the process alive
	if (!dev) installShutdown({ stopAccepting, whenIdle, closeDb });
};

/** Reachable without a session. The webhook authenticates by signature */
const PUBLIC = ['/auth/', '/api/index01/webhook', '/healthz'];
const isPublic = (path: string) => PUBLIC.some((p) => path === p || path.startsWith(p));

/**
 * csrf.trustedOrigins is ['*'] so the Index 01 app (multipart, no Origin header) gets through.
 * The same-origin check for everything else lives here instead.
 */
const originHandle: Handle = async ({ event, resolve }) => {
	const { request, url } = event;
	if (
		request.method !== 'GET' &&
		request.method !== 'HEAD' &&
		!url.pathname.startsWith('/api/index01/webhook')
	) {
		const origin = request.headers.get('origin');
		// PUBLIC_URL counts too, in case the proxy headers give another scheme or host
		const sameOrigin = origin === url.origin || (!!publicOrigin && origin === publicOrigin);
		if (!sameOrigin) error(403, 'Cross-site requests are forbidden');
	}
	return resolve(event);
};

const authorizationHandle: Handle = async ({ event, resolve }) => {
	if (!isPublic(event.url.pathname) && !event.locals.session) {
		if (event.request.method === 'GET' && !event.isRemoteRequest && !event.isDataRequest) {
			redirect(
				303,
				`/auth/signin?next=${encodeURIComponent(event.url.pathname + event.url.search)}`
			);
		}
		error(401, 'Sign in first');
	}
	return resolve(event);
};

export const handle: Handle = sequence(originHandle, authenticationHandle, authorizationHandle);
