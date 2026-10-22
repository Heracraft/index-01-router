import { redirect } from '@sveltejs/kit';
import { signIn } from '#lib/server/auth.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.session) redirect(303, '/');
	return { error: url.searchParams.get('error') };
};

export const actions: Actions = { default: (event) => signIn(event) };
