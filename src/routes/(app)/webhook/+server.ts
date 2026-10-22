import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// The URL and secret live under Settings > Ring, the full log under /settings/requests
export const GET: RequestHandler = ({ url }) =>
	redirect(
		308,
		url.searchParams.has('show') ? `/settings/requests${url.search}` : '/settings#ring'
	);
