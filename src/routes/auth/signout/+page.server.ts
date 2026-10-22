import { redirect } from '@sveltejs/kit';
import { signOut } from '#lib/server/auth.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => redirect(303, '/');
export const actions: Actions = {
	/** everywhere=1 also invalidates every other session, on every device */
	default: async (event) => {
		const form = await event.request.formData().catch(() => null);
		return signOut(event, form?.get('everywhere') === '1');
	}
};
