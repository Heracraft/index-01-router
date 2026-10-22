// Where an error page sends you to sign in: back to the page that failed, without a form
// action param such as ?/transcribe. Shared by the root and (app) error pages.

export function signInUrl(
	url: Pick<URL, 'pathname'> & { searchParams: Iterable<[string, string]> }
) {
	const params = [...url.searchParams].filter(([k]) => !k.startsWith('/'));
	const search = params.length ? `?${new URLSearchParams(params)}` : '';
	return `/auth/signin?next=${encodeURIComponent(url.pathname + search)}`;
}

/** Heading for an error: the thrown message when it says more than the status text */
export function errorHeading(status: number, message: string | undefined) {
	if (status === 401) return 'Signed out';
	if (status === 404) return message && message !== 'Not Found' ? message : 'Not found';
	return message || 'Something went wrong';
}
