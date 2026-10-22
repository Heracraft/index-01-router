// Which forms on a page differ from what was loaded, for a save bar that appears only then.
// A form counts as changed when its posted fields differ from the snapshot taken after load or
// save. Fields outside the <form> that name it with form="" count too.

const snapshot = (form: HTMLFormElement) => {
	const out: string[] = [];
	for (const [k, v] of new FormData(form)) {
		if (typeof v === 'string') out.push(`${k}=${v}`);
	}
	return out.join('\n');
};

interface Tracked {
	el: HTMLFormElement;
	base: string;
	label: string;
	done: (() => void) | null;
}

export class DirtyForms {
	/** key -> label, for forms that changed */
	changed = $state<Record<string, string>>({});
	busy = $state(false);
	// Bookkeeping only; `changed` is the reactive part
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#forms = new Map<string, Tracked>();

	/** use:dirty.track={{ key, label }} on a <form> */
	track = (el: HTMLFormElement, opts: { key: string; label: string }) => {
		const t: Tracked = { el, base: snapshot(el), label: opts.label, done: null };
		this.#forms.set(opts.key, t);
		// Fields outside the form that name it may mount after it: snapshot once all are in
		setTimeout(() => {
			t.base = snapshot(el);
			this.check();
		});
		const check = () => this.check();
		const doc = el.ownerDocument;
		doc.addEventListener('input', check);
		doc.addEventListener('change', check);
		return {
			destroy: () => {
				doc.removeEventListener('input', check);
				doc.removeEventListener('change', check);
				if (this.#forms.get(opts.key) === t) this.#forms.delete(opts.key);
				delete this.changed[opts.key];
			}
		};
	};

	/** Compare every form with its snapshot. Call after a change no input event reports */
	check() {
		for (const [key, t] of this.#forms) {
			const now = snapshot(t.el) !== t.base;
			if (now && this.changed[key] !== t.label) this.changed[key] = t.label;
			else if (!now && key in this.changed) delete this.changed[key];
		}
	}

	/** Take a new snapshot, after a save or a reload */
	rebase(key: string) {
		const t = this.#forms.get(key);
		if (!t) return;
		t.base = snapshot(t.el);
		delete this.changed[key];
	}

	/** A form's enhance callback finished */
	finished(key: string) {
		const t = this.#forms.get(key);
		t?.done?.();
		if (t) t.done = null;
	}

	/** Submits each changed form in turn, waiting for each to finish */
	async saveAll() {
		this.busy = true;
		try {
			for (const key of Object.keys(this.changed)) {
				const t = this.#forms.get(key);
				if (!t) continue;
				if (!t.el.checkValidity()) {
					t.el.reportValidity();
					return;
				}
				await new Promise<void>((resolve) => {
					t.done = resolve;
					t.el.requestSubmit();
				});
			}
		} finally {
			this.busy = false;
		}
	}

	get count() {
		return Object.keys(this.changed).length;
	}
}
