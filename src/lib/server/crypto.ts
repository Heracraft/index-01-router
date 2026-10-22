import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { AUTH_SECRET } from '$app/env/private';

const PREFIX = 'enc:v1:';
const key = () => createHash('sha256').update(`index-01-router:${AUTH_SECRET}`).digest();

/** AES-256-GCM, keyed from AUTH_SECRET. Used for API keys stored in the database */
export function encrypt(plain: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key(), iv);
	const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
	return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

export function decrypt(value: string): string {
	if (!value.startsWith(PREFIX)) return value;
	const raw = Buffer.from(value.slice(PREFIX.length), 'base64url');
	const decipher = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
	decipher.setAuthTag(raw.subarray(12, 28));
	return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

export const isEncrypted = (value: unknown) => typeof value === 'string' && value.startsWith(PREFIX);
