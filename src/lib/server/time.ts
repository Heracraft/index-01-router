// Date formatting in a named time zone with Intl only. Tokens follow moment/Obsidian:
// YYYY MM DD HH mm ss ddd dddd MMM MMMM. Text in [brackets] is copied literally.

const TOKENS = /\[([^\]]*)\]|YYYY|MMMM|MMM|MM|DD|dddd|ddd|HH|mm|ss/g;

interface Parts {
	year: string;
	month: string;
	day: string;
	hour: string;
	minute: string;
	second: string;
	weekdayShort: string;
	weekdayLong: string;
	monthShort: string;
	monthLong: string;
}

const formatters = new Map<string, Intl.DateTimeFormat[]>();

function formattersFor(timeZone: string) {
	let f = formatters.get(timeZone);
	if (!f) {
		f = [
			new Intl.DateTimeFormat('en-US', {
				timeZone,
				year: 'numeric',
				month: '2-digit',
				day: '2-digit',
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit',
				hourCycle: 'h23',
				weekday: 'short'
			}),
			new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', month: 'long' }),
			new Intl.DateTimeFormat('en-US', { timeZone, month: 'short' })
		];
		formatters.set(timeZone, f);
	}
	return f;
}

function partsOf(date: Date, timeZone: string): Parts {
	const [main, long, short] = formattersFor(timeZone);
	const pick = (f: Intl.DateTimeFormat) => {
		const out: Record<string, string> = {};
		for (const p of f.formatToParts(date)) out[p.type] = p.value;
		return out;
	};
	const a = pick(main!);
	const b = pick(long!);
	const c = pick(short!);
	return {
		year: a.year!.padStart(4, '0'),
		month: a.month!,
		day: a.day!,
		hour: a.hour === '24' ? '00' : a.hour!,
		minute: a.minute!,
		second: a.second!,
		weekdayShort: a.weekday!,
		weekdayLong: b.weekday!,
		monthShort: c.month!,
		monthLong: b.month!
	};
}

/** True when Intl knows the zone, e.g. Africa/Nairobi */
export function isValidTimeZone(timeZone: string) {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone });
		return true;
	} catch {
		return false;
	}
}

/** Formats `date` as seen in `timeZone`. Throws RangeError for an unknown zone */
export function formatDate(date: Date, format: string, timeZone: string): string {
	if (Number.isNaN(date.getTime())) throw new RangeError('Invalid date');
	const p = partsOf(date, timeZone);
	return format.replace(TOKENS, (token, literal: string | undefined) => {
		if (literal !== undefined) return literal;
		switch (token) {
			case 'YYYY':
				return p.year;
			case 'MMMM':
				return p.monthLong;
			case 'MMM':
				return p.monthShort;
			case 'MM':
				return p.month;
			case 'DD':
				return p.day;
			case 'dddd':
				return p.weekdayLong;
			case 'ddd':
				return p.weekdayShort;
			case 'HH':
				return p.hour;
			case 'mm':
				return p.minute;
			case 'ss':
				return p.second;
			default:
				return token;
		}
	});
}
