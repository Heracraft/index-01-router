// errorSummary runs everywhere. The trim test needs Postgres and uses its own table rows:
//   INGEST_TEST_DATABASE_URL=postgres://root:pebble@localhost:5432/ingest_test pnpm exec vitest run src/lib/server/webhook-log.test.ts
import { describe, expect, it, vi } from 'vitest';

const url = process.env.INGEST_TEST_DATABASE_URL;

vi.mock('$app/env/private', () => ({
	DATABASE_URL: process.env.INGEST_TEST_DATABASE_URL ?? 'postgres://invalid'
}));

const { errorSummary, listWebhookEvents, logWebhookEvent } = await import('./webhook-log.ts');

describe.skipIf(url)('logWebhookEvent notifications', () => {
	it('tells /events listeners once per request, even when the log write fails', async () => {
		const { onWebhookLog } = await import('./webhook-feed.ts');
		const seen = vi.fn();
		const off = onWebhookLog(seen);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			await logWebhookEvent({ status: 401, reason: 'signature required' });
		} finally {
			off();
			vi.restoreAllMocks();
		}
		expect(seen).toHaveBeenCalledTimes(1);
	});
});

describe('errorSummary', () => {
	it('keeps fs codes and paths', () => {
		const e = Object.assign(
			new Error("ENOSPC: no space left on device, open '/data/audio/2026/10/x.m4a'"),
			{ code: 'ENOSPC' }
		);
		expect(errorSummary(e)).toBe(
			"ENOSPC: no space left on device, open '/data/audio/2026/10/x.m4a'"
		);
	});

	it('shows the driver error of a failed query without the SQL', () => {
		const cause = Object.assign(new Error('relation "recordings" does not exist'), {
			code: '42P01'
		});
		const e = new Error('Failed query: insert into "recordings" values ($1)\nparams: secret-ish', {
			cause
		});
		const s = errorSummary(e);
		expect(s).toBe('relation "recordings" does not exist: 42P01');
		expect(s).not.toContain('insert');
		expect(s).not.toContain('params');
	});

	it('names a failed query without a cause and truncates long messages', () => {
		expect(errorSummary(new Error('Failed query: select 1'))).toBe('database query failed');
		const long = errorSummary(new Error('x '.repeat(200)), 40);
		expect(long).toHaveLength(40);
		expect(long.endsWith('...')).toBe(true);
		expect(errorSummary('plain\n\tstring')).toBe('plain string');
	});
});

describe.skipIf(!url)('webhook log trimming', async () => {
	const { db, runMigrations } = await import('./db/index.ts');
	const { webhookEvents } = await import('./db/schema.ts');

	it('keeps real deliveries when junk floods in', async () => {
		await runMigrations();
		await db.delete(webhookEvents);
		for (let i = 0; i < 5; i++)
			await logWebhookEvent({
				status: 200,
				reason: 'stored',
				signed: true,
				deliveryId: `real-${i}`
			});
		await logWebhookEvent({ status: 401, reason: 'bad signature', signed: true });
		await logWebhookEvent({ status: 500, reason: 'internal error: ENOSPC' });
		for (let i = 0; i < 60; i++)
			await logWebhookEvent({ status: 401, reason: 'signature required' });

		const all = await db.select().from(webhookEvents);
		expect(all.filter((r) => r.reason === 'signature required')).toHaveLength(50);
		expect(all.filter((r) => r.reason === 'stored')).toHaveLength(5);
		expect(all.filter((r) => r.reason === 'bad signature')).toHaveLength(1);
		expect(all.filter((r) => r.status === 500)).toHaveLength(1);

		const shown = await listWebhookEvents(50);
		expect(shown.filter((r) => r.reason === 'stored')).toHaveLength(5);
		expect(shown.filter((r) => r.reason === 'signature required')).toHaveLength(10);
		expect(shown.map((r) => r.at.getTime())).toEqual(
			shown.map((r) => r.at.getTime()).sort((a, b) => b - a)
		);
		await db.delete(webhookEvents);
	});
});
