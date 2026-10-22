import { fail } from '@sveltejs/kit';
import { and, desc, eq, ne } from 'drizzle-orm';
import { TZ } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { recordings } from '#lib/server/db/schema.ts';
import {
	envFor,
	kinds,
	listIntegrationsForUI,
	TRIGGERS,
	type Kind
} from '#lib/server/integrations/index.ts';
import { lastDelivery, lastSent } from '#lib/server/journal.ts';
import {
	envLocks,
	getSettings,
	getStored,
	getStoredWithStatus,
	keyReadiness,
	newWebhookSecret,
	setStored
} from '#lib/server/settings.ts';
import { CHUNK_SECONDS, PROVIDERS } from '#lib/server/transcribe/index.ts';
import { listWebhookEvents } from '#lib/server/webhook-log.ts';
import { webhookUrl } from '#lib/server/origin.ts';
import { deleteNote, saveNote, testNote } from './note-actions.ts';
import { saveTranscription, testTranscription, timeZones } from './transcription-actions.ts';
import type { Actions, PageServerLoad } from './$types';

/** The latest transcribed recording, for the note preview. Null without one */
async function sample() {
	const [r] = await db
		.select({
			recordedAt: recordings.recordedAt,
			transcript: recordings.transcript,
			languages: recordings.languages,
			trigger: recordings.trigger,
			durationMs: recordings.durationMs
		})
		.from(recordings)
		.where(and(eq(recordings.status, 'done'), ne(recordings.transcript, '')))
		.orderBy(desc(recordings.recordedAt))
		.limit(1);
	return r ? { ...r, languages: (r.languages ?? '').split(',').filter(Boolean) } : null;
}

function kindMeta(kind: Kind) {
	const k = kinds[kind];
	return { kind: k.kind, label: k.label, fields: k.fields, secrets: k.secrets };
}

export const load: PageServerLoad = async ({ url }) => {
	const [rows, example, { value: t, lost }, general, webhook, events] = await Promise.all([
		listIntegrationsForUI(),
		sample(),
		getStoredWithStatus('transcription'),
		getStored('general'),
		getSettings('webhook'),
		listWebhookEvents(50)
	]);
	const notes = await Promise.all(
		rows
			.filter((r) => Object.hasOwn(kinds, r.kind))
			.map(async (r) => {
				const [sent, last] = await Promise.all([lastSent(r.id), lastDelivery(r.id)]);
				return {
					id: r.id,
					name: r.name,
					enabled: r.enabled,
					triggers: r.triggers,
					config: r.config,
					secretsSet: r.secretsSet,
					secretsLost: r.secretsLost,
					envSet: r.envSet,
					envValues: r.envValues,
					kind: kindMeta(r.kind as Kind),
					lastSent: sent,
					lastFailed: last?.status === 'failed' ? { at: last.at, error: last.error } : null
				};
			})
	);
	const zones = timeZones();
	const isRejected = (e: { status: number }) => e.status >= 400;
	const rejected = events.filter(isRejected);
	const newest = events[0];
	const obsidian = kinds.obsidian;
	return {
		triggers: TRIGGERS,
		notes,
		newNote: {
			kind: kindMeta('obsidian'),
			config: Object.fromEntries(
				obsidian.fields.map((f) => [f.key, f.default ?? (f.type === 'boolean' ? false : '')])
			),
			...envFor(obsidian)
		},
		sample: example,
		transcription: {
			providers: PROVIDERS,
			settings: {
				provider: t.provider,
				openai: { baseUrl: t.openai.baseUrl, model: t.openai.model },
				openaiAudio: { baseUrl: t.openaiAudio.baseUrl, model: t.openaiAudio.model },
				whisperCpp: { url: t.whisperCpp.url },
				languages: t.languages,
				prompt: t.prompt,
				chunking: t.chunking
			},
			keysSet: { openai: !!t.openai.apiKey, openaiAudio: !!t.openaiAudio.apiKey },
			keysLost: {
				openai: lost.includes('openai.apiKey'),
				openaiAudio: lost.includes('openaiAudio.apiKey')
			},
			ready: keyReadiness(t, lost),
			chunkSeconds: CHUNK_SECONDS,
			envLocks
		},
		general: {
			timezone: general.timezone ?? TZ ?? 'UTC',
			envTimezone: TZ,
			timeZones:
				zones.includes(general.timezone ?? '') || !general.timezone
					? zones
					: [general.timezone, ...zones]
		},
		ring: {
			webhookUrl: webhookUrl(url),
			total: events.length,
			rejected: rejected.map((e) => ({
				id: e.id,
				at: e.at,
				status: e.status,
				reason: e.reason,
				bytes: e.bytes
			})),
			last: newest
				? { at: newest.at, status: newest.status, reason: newest.reason, test: newest.test }
				: null,
			rotatedAt: webhook.rotatedAt ?? null,
			secretLocked: envLocks.webhookSecret,
			// Masked until Reveal: the last 4 characters identify it against the app's copy
			secretHint: webhook.secret.slice(-4),
			requireSignature: webhook.requireSignature
		}
	};
};

export const actions: Actions = {
	note: saveNote,
	noteTest: testNote,
	noteDelete: deleteNote,
	transcription: saveTranscription,
	transcriptionTest: testTranscription,
	reveal: async () => {
		const { secret } = await getSettings('webhook');
		// Seen once is enough to clear the "secret was replaced" banner
		const stored = await getStored('webhook');
		if (stored.secretReset) await setStored('webhook', { ...stored, secretReset: false });
		return { action: 'reveal', secret };
	},
	rotate: async () => {
		if (envLocks.webhookSecret) {
			return fail(409, {
				action: 'rotate',
				error: 'INDEX01_WEBHOOK_SECRET sets the secret. Change it there.'
			});
		}
		const stored = await getStored('webhook');
		const secret = newWebhookSecret();
		await setStored('webhook', {
			...stored,
			secret,
			secretReset: false,
			rotatedAt: new Date().toISOString()
		});
		return { action: 'rotate', secret };
	},
	signature: async ({ request }) => {
		const data = await request.formData();
		const stored = await getStored('webhook');
		await setStored('webhook', {
			...stored,
			requireSignature: data.get('requireSignature') === 'on'
		});
		return { action: 'signature', saved: true };
	}
};
