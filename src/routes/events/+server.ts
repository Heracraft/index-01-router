import { onChange } from '#lib/server/pipeline.ts';
import type { RequestHandler } from './$types';

/** Recording ids as they change, one `data:` line each. Session required (hooks.server.ts) */
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
			// Comment lines keep proxies (Coolify's Traefik) from closing an idle stream
			const ping = setInterval(() => send(': ping\n\n'), 25_000);
			cleanup = () => {
				off();
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
