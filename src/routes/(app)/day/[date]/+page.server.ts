import { error, redirect } from '@sveltejs/kit';
import { isDayKey, loadDay } from '#lib/server/journal.ts';
import { getSettings } from '#lib/server/settings.ts';
import { dayKey } from '#lib/format.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	if (!isDayKey(params.date)) error(404, 'No such day');
	const { timezone } = await getSettings('general');
	const today = dayKey(new Date(), timezone);
	if (params.date === today) redirect(307, `/${url.search}`);
	if (params.date > today) error(404, 'That day has not come yet');
	return loadDay(params.date, timezone, url.searchParams.get('m'));
};
