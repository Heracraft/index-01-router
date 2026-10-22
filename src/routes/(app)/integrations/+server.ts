import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Daily note settings moved to /settings
export const GET: RequestHandler = () => redirect(308, '/settings#note');
