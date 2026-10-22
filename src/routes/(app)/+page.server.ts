import { randomUUID } from 'node:crypto';
import { fail, redirect } from '@sveltejs/kit';
import { createRecording } from '#lib/server/ingest.ts';
import { loadDay } from '#lib/server/journal.ts';
import { getSettings } from '#lib/server/settings.ts';
import { dayKey } from '#lib/format.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	// The old list filters live on the search page now
	const status = url.searchParams.get('status');
	if (status) redirect(308, `/recordings?status=${encodeURIComponent(status)}`);
	if (url.searchParams.has('before')) redirect(308, '/recordings');
	const { timezone } = await getSettings('general');
	return loadDay(dayKey(new Date(), timezone), timezone, url.searchParams.get('m'));
};

const EXTENSION_MIME: Record<string, string> = {
	m4a: 'audio/mp4',
	mp4: 'audio/mp4',
	aac: 'audio/aac',
	mp3: 'audio/mpeg',
	wav: 'audio/wav',
	ogg: 'audio/ogg',
	oga: 'audio/ogg',
	opus: 'audio/ogg',
	webm: 'audio/webm',
	flac: 'audio/flac'
};

/** The browser's type when it is audio, else a guess from the extension */
function audioMime(file: File) {
	if (file.type.startsWith('audio/')) return file.type;
	const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
	if (file.type === 'video/mp4' || file.type === 'video/webm' || file.type === 'video/ogg') {
		return file.type.replace('video/', 'audio/');
	}
	return EXTENSION_MIME[ext] ?? null;
}

export const actions: Actions = {
	upload: async ({ request }) => {
		const data = await request.formData();
		const file = data.get('audio');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { upload: 'No file' });
		}
		const mime = audioMime(file);
		if (!mime) {
			return fail(400, { upload: 'Not audio' });
		}
		// A file's modified time is when it was copied or downloaded as often as when it was
		// recorded, so an upload sits at the moment it arrived: the newest line of today
		const recordedAt = new Date();
		try {
			const { recording } = await createRecording({
				source: 'upload',
				trigger: 'upload',
				deliveryId: `upload_${randomUUID()}`,
				signed: false,
				recordedAt,
				audio: { bytes: new Uint8Array(await file.arrayBuffer()), mime }
			});
			const { timezone } = await getSettings('general');
			return {
				uploaded: recording.id,
				day: dayKey(recordedAt, timezone),
				today: dayKey(new Date(), timezone)
			};
		} catch (e) {
			console.error('upload failed', e);
			return fail(500, { upload: 'Upload failed' });
		}
	}
};
