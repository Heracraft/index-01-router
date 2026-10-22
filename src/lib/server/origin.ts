import { PUBLIC_URL } from '$app/env/private';

/** The origin of an http(s) URL, or undefined when it is empty or not one */
export function originOf(value: string | undefined): string | undefined {
	if (!value) return undefined;
	try {
		const u = new URL(value);
		return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : undefined;
	} catch {
		return undefined;
	}
}

/** Origin from PUBLIC_URL. Browsers and the identity provider reach the app here */
export const publicOrigin = originOf(PUBLIC_URL);
if (PUBLIC_URL && !publicOrigin) console.warn(`PUBLIC_URL is not an http(s) URL: ${PUBLIC_URL}`);

/** PUBLIC_URL's origin when set, else the origin adapter-node derived for the request */
export const appOrigin = (url: URL) => publicOrigin ?? url.origin;
