// CONTRACT (implemented by the pipeline agent)
//
// export function startWorker(): void
//   Called once from the init hook. Resumes recordings left in received/transcribing/routing
//   (crash recovery), then processes new work. In-process queue, concurrency 2, no external broker.
//
// export function enqueue(recordingId: string): void
//   Called by the webhook and the upload action after the row and audio are stored.
//
// export async function retryRecording(recordingId: string, from: 'transcribe' | 'route'): Promise<void>
//   UI action. 'transcribe' re-runs transcription then routing. 'route' re-sends failed/pending deliveries.
//
// export async function redeliver(deliveryId: string): Promise<void>
//
// export function onChange(listener: (recordingId: string) => void): () => void
//   For server sent events in the UI.
export function startWorker() {}
export {};
