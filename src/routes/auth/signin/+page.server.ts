import { redirect } from '@sveltejs/kit';
import { signIn, signInError } from '#lib/server/auth.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	if (event.locals.session) redirect(303, '/');
	return { error: signInError(event) };
};

export const actions: Actions = { default: (event) => signIn(event) };
