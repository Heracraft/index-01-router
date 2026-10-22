import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Each integration is a section of /settings now
export const GET: RequestHandler = ({ params }) =>
	redirect(308, params.id === 'new' ? '/settings#note' : `/settings#note-${params.id}`);
