// Recording pipeline: received -> transcribing -> routing -> done | failed.
// In-process queue with two recordings in flight; rows left mid-way are resumed by startWorker.
import { EventEmitter } from 'node:events';
import { asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from './db/index.ts';
import {
	deliveries,
	recordings,
	type Delivery,
	type Integration,
	type Recording
} from './db/schema.ts';
import { getSettings, type GeneralSettings } from './settings.ts';
import { absolutePath } from './storage.ts';
import { transcribe as realTranscribe, TranscribeError } from './transcribe/index.ts';
import type { TranscribeInput, TranscribeResult } from './transcribe/types.ts';
import { integrationMatches, kinds, listIntegrations, type Kind } from './integrations/index.ts';
import { DeliverError } from './integrations/types.ts';

const CONCURRENCY = 2;
/** Transcription: 3 attempts, waits between them */
const TRANSCRIBE_BACKOFF_MS = [2_000, 10_000];
/** Deliveries: first try plus 3 retries of retryable errors */
const DELIVERY_BACKOFF_MS = [2_000, 10_000, 30_000];
const TRANSCRIBE_TIMEOUT_MS = 15 * 60_000;
const DELIVER_TIMEOUT_MS = 2 * 60_000;
/** Prefix of the note kept on a recording that fell back to the phone's transcript */
const FALLBACK_NOTE = 'Used the app transcript';

interface Deps {
	transcribe: (input: TranscribeInput) => Promise<TranscribeResult>;
	sleep: (ms: number) => Promise<void>;
}

const deps: Deps = {
	transcribe: (input) => realTranscribe(input),
	sleep: (ms) => new Promise((r) => setTimeout(r, ms))
};

/** Tests swap the transcriber and skip the backoff waits */
export function _setPipelineDeps(over: Partial<Deps>) {
	Object.assign(deps, over);
}

type Job = { id: string; from: 'auto' | 'transcribe' | 'route'; only?: string };

interface State {
	events: EventEmitter;
	queue: Job[];
	/** Recording ids queued or running. One job per recording at a time */
	busy: Set<string>;
	running: number;
	idleWaiters: (() => void)[];
	started: boolean;
}

// On globalThis so a dev hot reload of this module keeps one queue instead of starting a second
const g = globalThis as typeof globalThis & { __index01Pipeline?: State };
const state: State = (g.__index01Pipeline ??= {
	events: new EventEmitter().setMaxListeners(0),
	queue: [],
	busy: new Set(),
	running: 0,
	idleWaiters: [],
	started: false
});
const { events, queue, busy } = state;

/** Called with a recording id on every status, transcript or delivery change. Returns unsubscribe */
export function onChange(listener: (recordingId: string) => void): () => void {
	events.on('change', listener);
	return () => events.off('change', listener);
}

const emit = (id: string) => {
	try {
		events.emit('change', id);
	} catch (e) {
		console.error('pipeline change listener failed', e);
	}
};

function pump() {
	while (state.running < CONCURRENCY && queue.length) {
		const job = queue.shift()!;
		state.running++;
		run(job)
			.catch((e) => console.error(`pipeline: recording ${job.id} crashed`, e))
			.finally(() => {
				state.running--;
				busy.delete(job.id);
				emit(job.id);
				pump();
			});
	}
	if (!state.running && !queue.length) {
		const waiters = state.idleWaiters;
		state.idleWaiters = [];
		for (const w of waiters) w();
	}
}

/** Resolves once nothing is queued or running */
export function whenIdle(): Promise<void> {
	if (!state.running && !queue.length) return Promise.resolve();
	return new Promise((r) => state.idleWaiters.push(r));
}

export const isProcessing = (recordingId: string) => busy.has(recordingId);

/** Takes the recording for one job. False when it already has one */
function reserve(id: string) {
	if (busy.has(id)) return false;
	busy.add(id);
	return true;
}

function push(job: Job) {
	queue.push(job);
	pump();
}

export function enqueue(recordingId: string): void {
	if (!reserve(recordingId)) return;
	push({ id: recordingId, from: 'auto' });
}

export function startWorker(): void {
	if (state.started) return;
	state.started = true;
	db.select({ id: recordings.id })
		.from(recordings)
		.where(inArray(recordings.status, ['received', 'transcribing', 'routing']))
		.orderBy(asc(recordings.receivedAt))
		.then((rows) => {
			if (rows.length) console.log(`pipeline: resuming ${rows.length} recordings`);
			for (const r of rows) enqueue(r.id);
		})
		.catch((e) => {
			state.started = false;
			console.error('pipeline: could not resume recordings', e);
		});
}

export async function retryRecording(
	recordingId: string,
	from: 'transcribe' | 'route'
): Promise<void> {
	const rec = await load(recordingId);
	if (!rec) throw new Error('Recording not found');
	if (from === 'transcribe' && !rec.audioPath && !rec.appTranscript?.trim()) {
		throw new Error('Nothing to transcribe: no audio and no app transcript');
	}
	if (from === 'route' && !rec.transcript?.trim()) throw new Error('No transcript to deliver');
	if (!reserve(recordingId)) throw new Error('Recording is still processing');
	try {
		if (from === 'transcribe') {
			await setRecording(recordingId, { status: 'received', error: null, attempts: 0 });
		} else {
			await setRecording(recordingId, { status: 'routing', error: fallbackNote(rec.error) });
		}
	} catch (e) {
		busy.delete(recordingId);
		throw e;
	}
	push({ id: recordingId, from });
}

export async function redeliver(deliveryId: string): Promise<void> {
	const [d] = await db.select().from(deliveries).where(eq(deliveries.id, deliveryId));
	if (!d) throw new Error('Delivery not found');
	if (!reserve(d.recordingId)) throw new Error('Recording is still processing');
	try {
		await setDelivery(d, { status: 'pending', error: null });
		const rec = await load(d.recordingId);
		await setRecording(d.recordingId, {
			status: 'routing',
			error: fallbackNote(rec?.error ?? null)
		});
	} catch (e) {
		busy.delete(d.recordingId);
		throw e;
	}
	push({ id: d.recordingId, from: 'route', only: deliveryId });
}

async function load(id: string): Promise<Recording | undefined> {
	const [row] = await db.select().from(recordings).where(eq(recordings.id, id));
	return row;
}

async function setRecording(id: string, patch: Partial<Recording>): Promise<Recording> {
	const [row] = await db
		.update(recordings)
		.set({ ...patch, updatedAt: new Date() })
		.where(eq(recordings.id, id))
		.returning();
	emit(id);
	if (!row) throw new Error(`Recording ${id} vanished`);
	return row;
}

async function setDelivery(
	d: Pick<Delivery, 'id' | 'recordingId'>,
	patch: Partial<Omit<Delivery, 'attempts'>> & { attempts?: SQL }
) {
	await db
		.update(deliveries)
		.set({ ...patch, updatedAt: new Date() })
		.where(eq(deliveries.id, d.id));
	emit(d.recordingId);
}

const fallbackNote = (error: string | null) => (error?.startsWith(FALLBACK_NOTE) ? error : null);

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e)) || 'Unknown error';

async function run(job: Job) {
	let rec = await load(job.id);
	if (!rec) return;
	if (job.from === 'route') {
		await route(rec, job.only);
		return;
	}
	if (job.from === 'transcribe' || rec.status === 'received' || rec.status === 'transcribing') {
		rec = await transcribeStep(rec);
	}
	if (rec.status === 'routing') await route(rec);
}

async function transcribeStep(rec: Recording): Promise<Recording> {
	const app = rec.appTranscript?.trim() || null;
	if (!rec.audioPath) {
		if (!app)
			return setRecording(rec.id, { status: 'failed', error: 'No audio and no transcript' });
		return setRecording(rec.id, {
			status: 'routing',
			transcript: app,
			languages: null,
			transcribedBy: 'index-app',
			transcribeMs: null,
			error: null
		});
	}

	let failure: string;
	try {
		const settings = await getSettings('transcription');
		for (let attempt = 0; ; attempt++) {
			rec = await setRecording(rec.id, {
				status: 'transcribing',
				attempts: rec.attempts + 1,
				error: attempt ? rec.error : null
			});
			const started = performance.now();
			try {
				const result = await deps.transcribe({
					path: absolutePath(rec.audioPath!),
					mime: rec.audioMime ?? 'audio/mp4',
					durationMs: rec.durationMs,
					settings,
					signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS)
				});
				const transcribeMs = Math.round(performance.now() - started);
				const text = result.text.trim();
				if (!text && app) {
					return useApp(rec, app, `${result.by} heard no speech`);
				}
				if (!text) {
					return setRecording(rec.id, {
						status: 'done',
						transcript: '',
						languages: null,
						transcribedBy: result.by,
						transcribeMs,
						error: 'No speech in the recording'
					});
				}
				return setRecording(rec.id, {
					status: 'routing',
					transcript: text,
					languages: result.languages.join(',') || null,
					transcribedBy: result.by,
					transcribeMs,
					error: null
				});
			} catch (e) {
				failure = messageOf(e);
				const retryable = !(e instanceof TranscribeError) || e.retryable;
				if (!retryable || attempt >= TRANSCRIBE_BACKOFF_MS.length) break;
				rec = await setRecording(rec.id, { error: `${failure}. Retrying` });
				await deps.sleep(TRANSCRIBE_BACKOFF_MS[attempt]!);
			}
		}
	} catch (e) {
		// Settings or database trouble outside the provider call
		failure = messageOf(e);
	}
	if (app) return useApp(rec, app, failure);
	return setRecording(rec.id, { status: 'failed', error: `Transcription failed: ${failure}` });
}

function useApp(rec: Recording, app: string, reason: string) {
	return setRecording(rec.id, {
		status: 'routing',
		transcript: app,
		languages: null,
		transcribedBy: 'index-app',
		transcribeMs: null,
		error: `${FALLBACK_NOTE}: ${reason}`
	});
}

async function route(rec: Recording, only?: string) {
	if (!rec.transcript?.trim()) {
		await setRecording(rec.id, {
			status: rec.status === 'done' ? 'done' : 'failed',
			error: rec.error ?? 'No transcript to deliver'
		});
		return;
	}
	if (rec.status !== 'routing') rec = await setRecording(rec.id, { status: 'routing' });

	let all: Integration[];
	let general: GeneralSettings;
	try {
		[all, general] = await Promise.all([listIntegrations(), getSettings('general')]);
	} catch (e) {
		await setRecording(rec.id, { status: 'failed', error: `Routing failed: ${messageOf(e)}` });
		return;
	}
	const matching = all.filter((i) => i.kind in kinds && integrationMatches(i, rec.trigger));
	const byId = new Map(matching.map((i) => [i.id, i]));
	if (matching.length) {
		await db
			.insert(deliveries)
			.values(matching.map((i) => ({ recordingId: rec.id, integrationId: i.id })))
			.onConflictDoNothing({ target: [deliveries.recordingId, deliveries.integrationId] });
	}

	const rows = await db.select().from(deliveries).where(eq(deliveries.recordingId, rec.id));
	for (const d of rows) {
		if (!byId.has(d.integrationId) && (d.status === 'pending' || d.status === 'failed')) {
			await setDelivery(d, {
				status: 'skipped',
				error: 'Integration is off or does not take this trigger'
			});
		}
	}
	const todo = rows.filter(
		(d) =>
			byId.has(d.integrationId) &&
			(only ? d.id === only : d.status === 'pending' || d.status === 'failed')
	);
	await Promise.all(todo.map((d) => deliver(d, byId.get(d.integrationId)!, rec, general)));

	const after = await db
		.select({ status: deliveries.status })
		.from(deliveries)
		.where(eq(deliveries.recordingId, rec.id));
	const failed = after.filter((d) => d.status === 'failed' || d.status === 'pending').length;
	const note = fallbackNote(rec.error);
	await setRecording(rec.id, {
		status: failed ? 'failed' : 'done',
		error: failed
			? [
					`${failed} of ${after.length} ${after.length === 1 ? 'delivery' : 'deliveries'} failed`,
					note
				]
					.filter(Boolean)
					.join('. ')
			: note
	});
}

async function deliver(
	d: Delivery,
	integration: Integration,
	rec: Recording,
	general: GeneralSettings
) {
	const kind = kinds[integration.kind as Kind];
	for (let attempt = 0; ; attempt++) {
		await setDelivery(d, { status: 'pending', attempts: sql`${deliveries.attempts} + 1` });
		try {
			const result = await kind.deliver({
				recording: rec,
				config: integration.config,
				general,
				signal: AbortSignal.timeout(DELIVER_TIMEOUT_MS)
			});
			await setDelivery(d, { status: 'sent', target: result.target, error: null });
			return;
		} catch (e) {
			const message = messageOf(e);
			const retryable = e instanceof DeliverError ? e.retryable : true;
			if (!retryable || attempt >= DELIVERY_BACKOFF_MS.length) {
				await setDelivery(d, { status: 'failed', error: message });
				return;
			}
			await setDelivery(d, { error: `${message}. Retrying` });
			await deps.sleep(DELIVERY_BACKOFF_MS[attempt]!);
		}
	}
}
