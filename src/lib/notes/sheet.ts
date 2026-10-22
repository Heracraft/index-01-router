// A Markdown note read into the blocks the day sheet shows: headings, list items (tasks too)
// and paragraphs. Browser safe. Enough Markdown for daily notes, not a full parser.

export type Block =
	| { type: 'heading'; level: number; text: string }
	| {
			type: 'item' | 'para';
			/** Text without list marker, checkbox or leading time */
			text: string;
			/** HH:mm the entry starts with, if any */
			time: string | null;
			/** Task state for "- [ ]" items, null otherwise */
			task: boolean | null;
			/** The block as written, whitespace collapsed, for matching against a rendered entry */
			raw: string;
	  };

const ITEM = /^\s{0,3}([-*+]|\d+[.)])\s+/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const TASK = /^\[([ xX])\]\s+/;
const TIME = /^(\d{1,2}:\d{2})(?::\d{2})?\s+/;

export const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

function textBlock(type: 'item' | 'para', lines: string[]): Block {
	const raw = squash(lines.join(' '));
	let text = type === 'item' ? raw.replace(ITEM, '') : raw;
	let task: boolean | null = null;
	const t = TASK.exec(text);
	if (type === 'item' && t) {
		task = t[1] !== ' ';
		text = text.slice(t[0].length);
	}
	let time: string | null = null;
	const m = TIME.exec(text);
	if (m) {
		time = m[1]!.padStart(5, '0');
		text = text.slice(m[0].length);
	}
	return { type, text, time, task, raw };
}

export function parseNote(md: string): Block[] {
	const lines = md.replace(/\r\n?/g, '\n').split('\n');
	let i = 0;
	// Front matter
	if (lines[0]?.trim() === '---') {
		const end = lines.findIndex((l, n) => n > 0 && l.trim() === '---');
		if (end > 0) i = end + 1;
	}
	const out: Block[] = [];
	let cur: { type: 'item' | 'para'; lines: string[] } | null = null;
	const flush = () => {
		if (cur) out.push(textBlock(cur.type, cur.lines));
		cur = null;
	};
	for (; i < lines.length; i++) {
		const line = lines[i]!;
		if (!line.trim()) {
			flush();
			continue;
		}
		const h = HEADING.exec(line);
		if (h) {
			flush();
			out.push({ type: 'heading', level: h[1]!.length, text: h[2]! });
			continue;
		}
		if (ITEM.test(line)) {
			flush();
			cur = { type: 'item', lines: [line] };
			continue;
		}
		// A line right under an item or a paragraph continues it, as Markdown reads it
		if (cur) {
			cur.lines.push(line);
			continue;
		}
		flush();
		cur = { type: 'para', lines: [line] };
	}
	flush();
	return out;
}

/** Blocks under the first heading named `heading` (any level), up to the next heading at its level or above */
export function sectionOf(blocks: Block[], heading: string): Block[] | null {
	const want = heading.trim().toLowerCase();
	const at = blocks.findIndex((b) => b.type === 'heading' && b.text.trim().toLowerCase() === want);
	if (at < 0) return null;
	const level = (blocks[at] as { level: number }).level;
	const end = blocks.findIndex((b, n) => n > at && b.type === 'heading' && b.level <= level);
	return blocks.slice(at + 1, end < 0 ? undefined : end);
}

/** A rendered entry in the form parseNote gives its block, for matching */
export function entryRaw(entry: string) {
	return squash(entry);
}
