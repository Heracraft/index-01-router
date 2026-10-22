import { error, redirect } from '@sveltejs/kit';
import { sequence, type Handle, type ServerInit } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { handle as authenticationHandle } from '#lib/server/auth.ts';
import { runMigrations } from '#lib/server/db/index.ts';
import { startWorker } from '#lib/server/pipeline.ts';

export const init: ServerInit = async () => {
	if (building) return;
	await runMigrations();
	startWorker();
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
		if (origin !== url.origin) error(403, 'Cross-site requests are forbidden');
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
