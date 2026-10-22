// Display helpers shared by server loads and components. Browser safe: Intl only, no node imports.

type DateInput = Date | string | number;

const toDate = (d: DateInput) => (d instanceof Date ? d : new Date(d));

const formatters = new Map<string, Intl.DateTimeFormat>();
function dtf(timeZone: string, opts: Intl.DateTimeFormatOptions) {
	const key = timeZone + JSON.stringify(opts);
	let f = formatters.get(key);
	if (!f) {
		try {
			f = new Intl.DateTimeFormat('en-US', { timeZone, ...opts });
		} catch {
			f = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts });
		}
		formatters.set(key, f);
	}
	return f;
}

interface Parts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}

/** Wall clock fields of `date` in `timeZone` */
export function zonedParts(date: DateInput, timeZone: string): Parts {
	const parts = dtf(timeZone, {
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		hour: 'numeric',
		minute: 'numeric',
		second: 'numeric',
		hourCycle: 'h23'
	}).formatToParts(toDate(date));
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
	return {
		year: get('year'),
		month: get('month'),
		day: get('day'),
		hour: get('hour') % 24,
		minute: get('minute'),
		second: get('second')
	};
}

/** The instant of a wall clock time in `timeZone`. Two passes settle DST edges */
function zonedToUtc(p: Parts, timeZone: string) {
	const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
	let guess = wall;
	for (let i = 0; i < 2; i++) {
		const seen = zonedParts(guess, timeZone);
		const seenWall = Date.UTC(
			seen.year,
			seen.month - 1,
			seen.day,
			seen.hour,
			seen.minute,
			seen.second
		);
		guess += wall - seenWall;
	}
	return new Date(guess);
}

/** Midnight of the day `date` falls on, in `timeZone` */
export function startOfDay(date: DateInput, timeZone: string) {
	const p = zonedParts(date, timeZone);
	return zonedToUtc({ ...p, hour: 0, minute: 0, second: 0 }, timeZone);
}

/** Midnight of the Monday of the week `date` falls in, in `timeZone` */
export function startOfWeek(date: DateInput, timeZone: string) {
	const p = zonedParts(date, timeZone);
	const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
	const back = (weekday + 6) % 7;
	const monday = new Date(Date.UTC(p.year, p.month - 1, p.day - back));
	return zonedToUtc(
		{
			year: monday.getUTCFullYear(),
			month: monday.getUTCMonth() + 1,
			day: monday.getUTCDate(),
			hour: 0,
			minute: 0,
			second: 0
		},
		timeZone
	);
}

/** YYYY-MM-DD in `timeZone`, for grouping rows by day */
export function dayKey(date: DateInput, timeZone: string) {
	const p = zonedParts(date, timeZone);
	return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 14:02, or 14:02:09 with seconds */
export function formatTime(date: DateInput, timeZone: string, seconds = false) {
	const p = zonedParts(date, timeZone);
	return `${pad(p.hour)}:${pad(p.minute)}${seconds ? `:${pad(p.second)}` : ''}`;
}

/** Oct 22, or Oct 22, 2025 when the year differs from `now` */
export function formatDay(date: DateInput, timeZone: string, now: DateInput = new Date()) {
	const d = toDate(date);
	const sameYear = zonedParts(d, timeZone).year === zonedParts(now, timeZone).year;
	return dtf(timeZone, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
		.format(d)
		.replace(/\u202f/g, ' ');
}

/** Oct 22, 14:02 */
export function formatDateTime(
	date: DateInput,
	timeZone: string,
	opts: { seconds?: boolean; now?: DateInput } = {}
) {
	return `${formatDay(date, timeZone, opts.now)}, ${formatTime(date, timeZone, opts.seconds)}`;
}

/** Today, Yesterday, Wed Oct 15 (same week day names read badly past a week, so dates) */
export function dayLabel(date: DateInput, timeZone: string, now: DateInput = new Date()) {
	const key = dayKey(date, timeZone);
	if (key === dayKey(now, timeZone)) return 'Today';
	const yesterday = new Date(startOfDay(now, timeZone).getTime() - 12 * 3600_000);
	if (key === dayKey(yesterday, timeZone)) return 'Yesterday';
	return formatDay(date, timeZone, now);
}

/** Audio length: 0:42, 12:05, 1:02:03 */
export function formatDuration(ms: number | null | undefined) {
	if (ms == null || !Number.isFinite(ms) || ms < 0) return '';
	const total = Math.round(ms / 1000);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Processing time: 820 ms, 4.2 s, 3 min 12 s */
export function formatElapsed(ms: number | null | undefined) {
	if (ms == null || !Number.isFinite(ms) || ms < 0) return '';
	if (ms < 1000) return `${Math.round(ms)} ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
	const total = Math.round(ms / 1000);
	return `${Math.floor(total / 60)} min ${total % 60} s`;
}

/** 512 B, 41 KB, 3.2 MB */
export function formatBytes(n: number | null | undefined) {
	if (n == null || !Number.isFinite(n) || n < 0) return '';
	if (n < 1000) return `${n} B`;
	if (n < 1000_000) return `${Math.round(n / 1000)} KB`;
	return `${(n / 1000_000).toFixed(n < 10_000_000 ? 1 : 0)} MB`;
}

export function formatNumber(n: number) {
	return n.toLocaleString('en-US');
}

/** Stored as a comma separated list, most spoken first */
export function parseLanguages(value: string | null | undefined) {
	return (value ?? '')
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
}

let names: Intl.DisplayNames | undefined;
/** sw -> Swahili. Unknown codes come back as given */
export function languageName(code: string) {
	try {
		names ??= new Intl.DisplayNames(['en'], { type: 'language', fallback: 'code' });
		const name = names.of(code);
		return name && name.toLowerCase() !== code.toLowerCase() ? name : code;
	} catch {
		return code;
	}
}

/** ISO 639-1 or 639-3 code, as stored and sent to providers */
export const isLanguageCode = (code: string) => /^[a-z]{2,3}$/.test(code);

const TRIGGERS: Record<string, string> = {
	'single-click-hold': 'Single click',
	'double-click-hold': 'Double click',
	upload: 'Upload',
	'test-event': 'Test event'
};

export function triggerLabel(trigger: string | null | undefined) {
	if (!trigger) return '';
	return TRIGGERS[trigger] ?? trigger;
}

export type RecordingStatus = 'received' | 'transcribing' | 'routing' | 'done' | 'failed';

const STATUSES: Record<RecordingStatus, string> = {
	received: 'Queued',
	transcribing: 'Transcribing',
	routing: 'Delivering',
	done: 'Done',
	failed: 'Failed'
};

export const statusLabel = (status: string) => STATUSES[status as RecordingStatus] ?? status;

/** Statuses the pipeline still works on */
export const PENDING_STATUSES: RecordingStatus[] = ['received', 'transcribing', 'routing'];
export const isPending = (status: string) => PENDING_STATUSES.includes(status as RecordingStatus);

/** First non-empty line, cut at a word boundary near `max` characters */
export function firstLine(text: string | null | undefined, max = 160) {
	const line = (text ?? '')
		.split('\n')
		.map((l) => l.trim())
		.find(Boolean);
	if (!line) return '';
	if (line.length <= max) return line;
	const cut = line.slice(0, max);
	const space = cut.lastIndexOf(' ');
	return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '')}…`;
}

/** Status code class for badges: ok 2xx, warn 4xx, err 5xx and anything else */
export function httpTone(status: number): 'ok' | 'warn' | 'err' {
	if (status >= 200 && status < 300) return 'ok';
	if (status >= 400 && status < 500) return 'warn';
	return 'err';
}
