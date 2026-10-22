import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { AUTH_SECRET, AUTH_SECRET_PREVIOUS } from '$app/env/private';

const PREFIX = 'enc:v1:';
const derive = (secret: string) =>
	createHash('sha256').update(`index-01-router:${secret}`).digest();

/** The current key first, then keys from AUTH_SECRET_PREVIOUS that still decrypt older values */
const keys = () => [AUTH_SECRET, ...(AUTH_SECRET_PREVIOUS ?? [])].map(derive);

/** AES-256-GCM, keyed from AUTH_SECRET. Used for API keys stored in the database */
export function encrypt(plain: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', keys()[0], iv);
	const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
	return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

/**
 * Decrypts with AUTH_SECRET, then with each AUTH_SECRET_PREVIOUS value. `stale` means an earlier
 * key matched and the value should be encrypted again. Throws when no key matches.
 */
export function decryptWithStatus(value: string): { plain: string; stale: boolean } {
	if (!value.startsWith(PREFIX)) return { plain: value, stale: false };
	const raw = Buffer.from(value.slice(PREFIX.length), 'base64url');
	const all = keys();
	for (const [i, key] of all.entries()) {
		try {
			const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
			decipher.setAuthTag(raw.subarray(12, 28));
			const plain = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
			return { plain: plain.toString('utf8'), stale: i > 0 };
		} catch (e) {
			if (i === all.length - 1) throw e;
		}
	}
	throw new Error('No key to decrypt with');
}

export const decrypt = (value: string) => decryptWithStatus(value).plain;

export const isEncrypted = (value: unknown) =>
	typeof value === 'string' && value.startsWith(PREFIX);
