// Enhance for one settings section: its result stays with the section (several forms share the
// page), a save reloads the page data and takes a new snapshot, a test changes nothing stored.
import { tick } from 'svelte';
import { applyAction, type SubmitFunction } from '$app/forms';
import { goto, refreshAll } from '$app/navigation';
import type { DirtyForms } from './dirty.svelte.ts';

export type SectionResult = Record<string, unknown> | null;

export function sectionSubmit(
	dirty: DirtyForms,
	key: string,
	on: {
		start?: (test: boolean) => void;
		result: (data: SectionResult, test: boolean, ok: boolean) => void;
	}
): SubmitFunction {
	return ({ submitter }) => {
		const test = /Test$/.test(submitter?.getAttribute('formaction') ?? '');
		on.start?.(test);
		return async ({ result }) => {
			try {
				if (result.type === 'redirect') {
					// A path the server built, already resolved
					// eslint-disable-next-line svelte/no-navigation-without-resolve
					await goto(result.location, { refreshAll: true });
				} else if (result.type === 'error') {
					await applyAction(result);
				} else {
					const ok = result.type === 'success';
					on.result((result.data as SectionResult) ?? null, test, ok);
					if (ok && !test) {
						await refreshAll();
						await tick();
						dirty.rebase(key);
					}
				}
			} finally {
				if (!test) dirty.finished(key);
			}
		};
	};
}
