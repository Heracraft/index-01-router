// Day keys (YYYY-MM-DD) for links and labels. Browser safe
export const dayHref = (key: string, today: string) => (key === today ? '/' : `/day/${key}`);

const at = (key: string) => new Date(`${key}T12:00:00Z`);

export function addDays(key: string, n: number) {
	const t = at(key);
	t.setUTCDate(t.getUTCDate() + n);
	return t.toISOString().slice(0, 10);
}

/** Thursday, October 22 */
export const longDay = (key: string) =>
	at(key).toLocaleDateString('en-US', {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		timeZone: 'UTC'
	});

/** Oct 21 */
export const shortDay = (key: string) =>
	at(key).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Today, Yesterday, or null */
export function relativeDay(key: string, today: string) {
	if (key === today) return 'Today';
	if (key === addDays(today, -1)) return 'Yesterday';
	return null;
}

export const weekdayLetter = (key: string) =>
	at(key).toLocaleDateString('en-US', { weekday: 'narrow', timeZone: 'UTC' });

export const monthLabel = (month: string) =>
	at(`${month}-01`).toLocaleDateString('en-US', {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	});

/** Day keys of a month in Monday-first weeks, null for the blanks before the 1st */
export function monthGrid(month: string): (string | null)[] {
	const first = at(`${month}-01`);
	const lead = (first.getUTCDay() + 6) % 7;
	const out: (string | null)[] = Array(lead).fill(null);
	for (let d = first; d.toISOString().slice(0, 7) === month; d.setUTCDate(d.getUTCDate() + 1)) {
		out.push(d.toISOString().slice(0, 10));
	}
	return out;
}
