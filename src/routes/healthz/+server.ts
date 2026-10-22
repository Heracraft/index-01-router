import { sql } from 'drizzle-orm';
import { text } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';

export const GET = async () => {
	await db.execute(sql`select 1`);
	return text('ok');
};
