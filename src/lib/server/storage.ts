// CONTRACT (implemented by the ingest agent)
// Audio lives under DATA_DIR/audio/YYYY/MM/<recordingId>.<ext>; the DB stores the relative path.
//
// export async function saveAudio(recordingId: string, recordedAt: Date, bytes: Uint8Array, mime: string): Promise<{ path: string; bytes: number }>
// export function absolutePath(relative: string): string
// export async function deleteAudio(relative: string): Promise<void>
// export async function probeDurationMs(absPath: string): Promise<number | null>   // ffprobe, null when unavailable
export {};
