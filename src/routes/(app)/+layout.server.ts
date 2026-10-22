import { getSettings } from '#lib/server/settings.ts';
import { PROVIDERS } from '#lib/server/transcribe/index.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	const [general, transcription] = await Promise.all([
		getSettings('general'),
		getSettings('transcription')
	]);
	const provider = PROVIDERS.find((p) => p.id === transcription.provider);
	const model =
		transcription.provider === 'openai'
			? transcription.openai.model
			: transcription.provider === 'openai-audio'
				? transcription.openaiAudio.model
				: transcription.provider === 'gemini'
					? transcription.gemini.model
					: '';
	return {
		user: { email: locals.session?.email ?? null, name: locals.session?.name ?? null },
		timezone: general.timezone,
		provider: { label: provider?.label ?? transcription.provider, model }
	};
};
