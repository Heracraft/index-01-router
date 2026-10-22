import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { recordings } from '#lib/server/db/schema.ts';
import { absolutePath } from '#lib/server/storage.ts';
import { parseRange } from './range.ts';
import type { RequestHandler } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The stored audio, with Range support so the player can seek */
export const GET: RequestHandler = async ({ params, request }) => {
	if (!UUID.test(params.id)) error(404, 'Recording not found');
	const [rec] = await db
		.select({ audioPath: recordings.audioPath, audioMime: recordings.audioMime })
		.from(recordings)
		.where(eq(recordings.id, params.id));
	if (!rec?.audioPath) error(404, 'No audio for this recording');

	const path = absolutePath(rec.audioPath);
	let size: number;
	try {
		size = (await stat(path)).size;
	} catch {
		error(404, 'Audio file missing from storage');
	}

	const headers: Record<string, string> = {
		'content-type': rec.audioMime || 'application/octet-stream',
		'accept-ranges': 'bytes',
		'cache-control': 'private, max-age=3600'
	};

	const range = parseRange(request.headers.get('range'), size);
	if (range === 'unsatisfiable') {
		return new Response(null, {
			status: 416,
			headers: { ...headers, 'content-range': `bytes */${size}` }
		});
	}
	const { start, end } = range ?? { start: 0, end: size - 1 };
	const body =
		size === 0
			? null
			: (Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>);
	return new Response(body, {
		status: range ? 206 : 200,
		headers: {
			...headers,
			'content-length': String(size === 0 ? 0 : end - start + 1),
			...(range ? { 'content-range': `bytes ${start}-${end}/${size}` } : {})
		}
	});
};
