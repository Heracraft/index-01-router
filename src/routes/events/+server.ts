import { onChange, onShutdown } from '#lib/server/pipeline.ts';
import { onWebhookLog } from '#lib/server/webhook-feed.ts';
import type { RequestHandler } from './$types';

/**
 * Recording ids as they change, one `data:` line each, and an `event: webhook` line per logged
 * webhook request. Session required (hooks.server.ts)
 */
export const GET: RequestHandler = ({ request }) => {
	const encoder = new TextEncoder();
	let cleanup = () => {};

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const send = (chunk: string) => {
				try {
					controller.enqueue(encoder.encode(chunk));
				} catch {
					cleanup();
				}
			};
			send('retry: 3000\n\n');
			const off = onChange((id) => send(`data: ${id}\n\n`));
			// Named event: onmessage handlers do not take it for a recording id
			const offWebhook = onWebhookLog(() => send('event: webhook\ndata: \n\n'));
			// Comment lines keep proxies (Coolify's Traefik) from closing an idle stream
			const ping = setInterval(() => send(': ping\n\n'), 25_000);
			let offShutdown = () => {};
			cleanup = () => {
				off();
				offWebhook();
				offShutdown();
				clearInterval(ping);
				request.signal.removeEventListener('abort', onAbort);
			};
			const onAbort = () => {
				cleanup();
				try {
					controller.close();
				} catch {
					// already closed
				}
			};
			request.signal.addEventListener('abort', onAbort);
			// Close on SIGTERM so the HTTP server can stop; the browser reconnects after `retry`
			offShutdown = onShutdown(onAbort);
		},
		cancel() {
			cleanup();
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
		}
	});
};

/** Session probe for the layout after the stream closed: 204 signed in, 401 from hooks if not */
export const HEAD: RequestHandler = () => new Response(null, { status: 204 });
