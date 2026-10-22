import { callback } from '#lib/server/auth.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => callback(event);
