// Recording pipeline: received -> transcribing -> routing -> done | failed.
// In-process queue with two recordings in flight; rows left mid-way are resumed by startWorker.
import { EventEmitter } from 'node:events';
import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { db } from './db/index.ts';
import {
	deliveries,
	recordings,
	type Delivery,
	type Integration,
	type Recording
} from './db/schema.ts';
import { getSettings, type GeneralSettings } from './settings.ts';
import { absolutePath, deleteAudio, listAudioFiles } from './storage.ts';
import {
	MAX_AUDIO_SECONDS,
	transcribe as realTranscribe,
	TranscribeError
} from './transcribe/index.ts';
import type { TranscribeInput, TranscribeResult } from './transcribe/types.ts';
import {
	integrationMatches,
	kinds,
	listIntegrations,
	skipReason,
	type Kind
} from './integrations/index.ts';
import { DeliverError } from './integrations/types.ts';

const CONCURRENCY = 2;
/** Transcription: 3 attempts, waits between them */
const TRANSCRIBE_BACKOFF_MS = [2_000, 10_000];
/** Deliveries: first try plus 3 retries of retryable errors */
const DELIVERY_BACKOFF_MS = [2_000, 10_000, 30_000];
/** Least time a transcription gets; longer recordings get more, see transcribeBudgetMs */
const TRANSCRIBE_TIMEOUT_MS = 15 * 60_000;
const DELIVER_TIMEOUT_MS = 2 * 60_000;
/** Error on a row whose audio was never stored */
export const INCOMPLETE_ERROR = 'Audio was not stored; resend from the Index app';
/** Audio files without a row are deleted once older than this */
const ORPHAN_AGE_MS = 60 * 60_000;
/** Prefix of the note kept on a recording that fell back to the phone's transcript */
const FALLBACK_NOTE = 'Used the app transcript';

interface Deps {
	transcribe: (input: TranscribeInput) => Promise<TranscribeResult>;
	sleep: (ms: number) => Promise<void>;
	/** Signal that aborts after `ms` with a TimeoutError */
	deadline: (ms: number) => AbortSignal;
}

const deps: Deps = {
	transcribe: (input) => realTranscribe(input),
	sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
	deadline: (ms) => AbortSignal.timeout(ms)
};

/** Tests swap the transcriber, skip the backoff waits and shorten deadlines */
export function _setPipelineDeps(over: Partial<Deps>) {
	Object.assign(deps, over);
}

type Job = {
	id: string;
	from: 'auto' | 'transcribe' | 'route';
	/** Deliver this one delivery only */
	only?: string;
	/** Asked for from the UI: also deliver rows skipped while their integration was off */
	manual?: boolean;
};

interface State {
	events: EventEmitter;
	queue: Job[];
	/** Recording ids queued or running. One job per recording at a time */
	busy: Set<string>;
	running: number;
	idleWaiters: (() => void)[];
	started: boolean;
	/** Set on SIGTERM: queued jobs stay queued and resume on the next boot */
	stopping?: boolean;
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
	while (!state.stopping && state.running < CONCURRENCY && queue.length) {
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
	if (isIdle()) {
		const waiters = state.idleWaiters;
		state.idleWaiters = [];
		for (const w of waiters) w();
	}
}

/** Nothing running, and nothing queued unless stopping (queued jobs then wait for the next boot) */
const isIdle = () => !state.running && (state.stopping || !queue.length);

/** Resolves once nothing is queued or running. While stopping, once nothing is running */
export function whenIdle(): Promise<void> {
	if (isIdle()) return Promise.resolve();
	return new Promise((r) => state.idleWaiters.push(r));
}

/**
 * Stops starting jobs, for a shutdown. Running ones finish; queued ones keep their status and
 * startWorker resumes them on the next boot. Fires the onShutdown listeners once.
 */
export function stopAccepting(): void {
	if (state.stopping) return;
	state.stopping = true;
	try {
		events.emit('shutdown');
	} catch (e) {
		console.error('pipeline shutdown listener failed', e);
	}
	pump();
}

/** Runs `listener` when the server starts shutting down, at once if it already is. Returns unsubscribe */
export function onShutdown(listener: () => void): () => void {
	if (state.stopping) {
		listener();
		return () => {};
	}
	events.once('shutdown', listener);
	return () => events.off('shutdown', listener);
}

/** Tests only: accept jobs again after stopAccepting */
export function _resumeAccepting(): void {
	state.stopping = false;
	pump();
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
	sweepOrphanAudio().catch((e) => console.error('pipeline: orphan audio sweep failed', e));
}

/**
 * Deletes audio files, and temp files from interrupted writes, that no recording points to and
 * that are older than an hour. They are left by a crash between the file write and the insert.
 * Returns the deleted relative paths.
 */
export async function sweepOrphanAudio(now = Date.now()): Promise<string[]> {
	const old = (await listAudioFiles()).filter((f) => now - f.mtimeMs > ORPHAN_AGE_MS);
	const removed: string[] = [];
	for (let i = 0; i < old.length; i += 500) {
		const batch = old.slice(i, i + 500).map((f) => f.path);
		const rows = await db
			.select({ path: recordings.audioPath })
			.from(recordings)
			.where(inArray(recordings.audioPath, batch));
		const used = new Set(rows.map((r) => r.path));
		for (const rel of batch) {
			if (used.has(rel)) continue;
			await deleteAudio(rel);
			removed.push(rel);
		}
	}
	if (removed.length) console.log(`pipeline: deleted ${removed.length} orphaned audio files`);
	return removed;
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
	push({ id: recordingId, from, manual: from === 'route' });
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

/**
 * Replaces the transcript with text the owner typed. The version goes up, so deliveries of the
 * old text show as stale and can be sent again
 */
export async function editTranscript(recordingId: string, text: string): Promise<void> {
	const transcript = text.replace(/\r\n?/g, '\n').trim();
	if (!transcript) throw new Error('The transcript cannot be empty');
	const rec = await load(recordingId);
	if (!rec) throw new Error('Recording not found');
	if (rec.status !== 'done' && rec.status !== 'failed') {
		throw new Error('Recording is still processing');
	}
	if (!reserve(recordingId)) throw new Error('Recording is still processing');
	try {
		await setRecording(recordingId, { transcript });
	} finally {
		busy.delete(recordingId);
	}
}

async function load(id: string): Promise<Recording | undefined> {
	const [row] = await db.select().from(recordings).where(eq(recordings.id, id));
	return row;
}

async function setRecording(
	id: string,
	patch: Partial<Omit<Recording, 'transcriptVersion'>>
): Promise<Recording> {
	// A changed transcript gets a new version, so deliveries of the old text show as stale
	const version =
		patch.transcript === undefined
			? {}
			: {
					transcriptVersion: sql`CASE WHEN ${recordings.transcript} IS DISTINCT FROM ${patch.transcript} THEN ${recordings.transcriptVersion} + 1 ELSE ${recordings.transcriptVersion} END`
				};
	const [row] = await db
		.update(recordings)
		.set({ ...patch, ...version, updatedAt: new Date() })
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

/**
 * Time allowed for one transcription attempt: the recording's length (three times that for a
 * local whisper.cpp on CPU), at least 15 minutes. Without a probed duration the length is
 * estimated from the file size at 16 KB per second.
 */
export function transcribeBudgetMs(
	rec: Pick<Recording, 'durationMs' | 'audioBytes'>,
	provider: string
): number {
	const audioMs = rec.durationMs ?? ((rec.audioBytes ?? 0) / 16_000) * 1000;
	const factor = provider === 'whisper-cpp' ? 3 : 1;
	return Math.min(MAX_AUDIO_SECONDS * 3 * 1000, Math.max(TRANSCRIBE_TIMEOUT_MS, audioMs * factor));
}

/** The fallback note in an error, alone or after "N of M deliveries failed. " */
function fallbackNote(error: string | null) {
	const at = error?.indexOf(FALLBACK_NOTE) ?? -1;
	return at === 0 || (at > 0 && error!.slice(0, at).endsWith('. ')) ? error!.slice(at) : null;
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e)) || 'Unknown error';

async function run(job: Job) {
	let rec = await load(job.id);
	if (!rec) return;
	if (job.from === 'route') {
		await route(rec, job.only, job.manual);
		return;
	}
	if (job.from === 'transcribe' || rec.status === 'received' || rec.status === 'transcribing') {
		rec = await transcribeStep(rec);
	}
	if (rec.status === 'routing') await route(rec);
}

async function transcribeStep(rec: Recording): Promise<Recording> {
	const app = rec.appTranscript?.trim() || null;
	if (!rec.audioPath && rec.audioMime) {
		// Audio was expected but never stored (a crash during ingest in an older version). Fail
		// it so a resend from the Index app can attach the audio; the WHERE leaves a row alone
		// that such a resend completed meanwhile, and this job then transcribes it.
		const [failed] = await db
			.update(recordings)
			.set({ status: 'failed', error: INCOMPLETE_ERROR, updatedAt: new Date() })
			.where(and(eq(recordings.id, rec.id), isNull(recordings.audioPath)))
			.returning();
		emit(rec.id);
		if (failed) return failed;
		const fresh = await load(rec.id);
		if (!fresh?.audioPath) throw new Error(`Recording ${rec.id} vanished`);
		rec = fresh;
	}
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
			const budgetMs = transcribeBudgetMs(rec, settings.provider);
			const deadline = deps.deadline(budgetMs);
			try {
				const result = await deps.transcribe({
					path: absolutePath(rec.audioPath!),
					mime: rec.audioMime ?? 'audio/mp4',
					durationMs: rec.durationMs,
					settings,
					signal: deadline
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
				// Starting over from scratch would run into the same limit
				if (deadline.aborted) {
					failure = `Transcription took longer than ${Math.round(budgetMs / 60_000)} min`;
					break;
				}
				failure = messageOf(e);
				const retryable = !(e instanceof TranscribeError) || e.retryable;
				if (!retryable || attempt >= TRANSCRIBE_BACKOFF_MS.length) break;
				rec = await setRecording(rec.id, { error: failure });
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

async function route(rec: Recording, only?: string, manual = false) {
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
	const everyone = new Map(all.map((i) => [i.id, i]));
	for (const d of rows) {
		if (!byId.has(d.integrationId) && (d.status === 'pending' || d.status === 'failed')) {
			await setDelivery(d, { status: 'skipped', error: skipReason(everyone.get(d.integrationId)) });
		}
	}
	const todo = rows.filter(
		(d) =>
			byId.has(d.integrationId) &&
			(only
				? d.id === only
				: d.status === 'pending' || d.status === 'failed' || (manual && d.status === 'skipped'))
	);
	await Promise.all(todo.map((d) => deliver(d, byId.get(d.integrationId)!, rec, general)));

	const after = await db
		.select({ status: deliveries.status })
		.from(deliveries)
		.where(eq(deliveries.recordingId, rec.id));
	await setRecording(rec.id, routedState(after, rec.error));
}

/** Status and error of a recording once its deliveries are settled. Keeps the fallback note */
function routedState(
	rows: Pick<Delivery, 'status'>[],
	error: string | null
): Pick<Recording, 'status' | 'error'> {
	const failed = rows.filter((d) => d.status === 'failed' || d.status === 'pending').length;
	const note = fallbackNote(error);
	if (!failed) return { status: 'done', error: note };
	const what = `${failed} of ${rows.length} ${rows.length === 1 ? 'delivery' : 'deliveries'} failed`;
	return { status: 'failed', error: [what, note].filter(Boolean).join('. ') };
}

/**
 * Recomputes failed recordings after an integration and its deliveries were deleted, so one
 * whose only failures went with it ends `done`. Recordings with a job running are left to it.
 */
export async function settleAfterIntegrationDelete(recordingIds: string[]): Promise<void> {
	for (const id of new Set(recordingIds)) {
		if (busy.has(id)) continue;
		const rec = await load(id);
		if (!rec || rec.status !== 'failed' || !rec.transcript?.trim()) continue;
		const rows = await db
			.select({ status: deliveries.status })
			.from(deliveries)
			.where(eq(deliveries.recordingId, id));
		// A job may have taken it while the deliveries were read
		if (busy.has(id)) continue;
		await setRecording(id, routedState(rows, rec.error));
	}
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
				signal: AbortSignal.timeout(DELIVER_TIMEOUT_MS),
				// d.attempts is the count before this run: a resend or a resumed job is not first
				firstAttempt: attempt === 0 && d.attempts === 0
			});
			await setDelivery(d, {
				status: 'sent',
				target: result.target,
				error: null,
				sentVersion: rec.transcriptVersion
			});
			return;
		} catch (e) {
			const message = messageOf(e);
			const retryable = e instanceof DeliverError ? e.retryable : true;
			if (!retryable || attempt >= DELIVERY_BACKOFF_MS.length) {
				await setDelivery(d, { status: 'failed', error: message });
				return;
			}
			await setDelivery(d, { error: message });
			await deps.sleep(DELIVERY_BACKOFF_MS[attempt]!);
		}
	}
}
