import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema.ts';
import { DATABASE_URL } from '$app/env/private';

const client = postgres(DATABASE_URL, { onnotice: () => {} });

export const db = drizzle(client, { schema, casing: 'snake_case' });

/** Applies ./drizzle migrations. Runs from the init hook before the server listens */
export async function runMigrations(migrationsFolder = 'drizzle') {
	const migrationClient = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
	try {
		await migrate(drizzle(migrationClient, { casing: 'snake_case' }), { migrationsFolder });
	} finally {
		await migrationClient.end();
	}
}
