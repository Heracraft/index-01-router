// Tells /events listeners that the webhook request log changed
import { EventEmitter } from 'node:events';

// On globalThis so a dev hot reload keeps one emitter for the open streams
const g = globalThis as typeof globalThis & { __index01WebhookFeed?: EventEmitter };
const feed = (g.__index01WebhookFeed ??= new EventEmitter().setMaxListeners(0));

export function notifyWebhookLog(): void {
	try {
		feed.emit('logged');
	} catch (e) {
		console.error('webhook log listener failed', e);
	}
}

/** Called once per logged webhook request. Returns unsubscribe */
export function onWebhookLog(listener: () => void): () => void {
	feed.on('logged', listener);
	return () => feed.off('logged', listener);
}
