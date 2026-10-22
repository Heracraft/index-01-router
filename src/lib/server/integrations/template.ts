// Placeholders for note paths and entries:
//   {{date:FMT}} {{time:FMT}}  recordedAt in the general time zone, tokens from time.ts
//   {{date}} {{time}}          YYYY-MM-DD and HH:mm
//   {{transcript}} {{languages}} {{trigger}} {{duration}}
//   {{heading}}                the integration's heading, for new-note templates
import { formatDate } from '../time.ts';

export interface TemplateVars {
	recordedAt: Date;
	timeZone: string;
	transcript?: string;
	languages?: string[];
	trigger?: string;
	durationMs?: number | null;
	heading?: string;
}

const PLACEHOLDER = /\{\{\s*(\w+)\s*(?::([^}]*))?\}\}/g;

/** 83000 -> 1:23, 3723000 -> 1:02:03 */
export function formatDuration(ms: number | null | undefined) {
	if (ms == null || !Number.isFinite(ms) || ms < 0) return '';
	const total = Math.round(ms / 1000);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = String(total % 60).padStart(2, '0');
	return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Escapes a leading # so a transcript line never becomes a heading */
const noHeading = (line: string) => line.replace(/^(\s*)#/, '$1\\#');

/**
 * Transcript text fit for the spot it lands in. Inside a list item ("- " entries) every line is
 * indented two spaces and blank lines are dropped, so the whole transcript stays one item.
 */
export function transcriptFor(text: string, inListItem: boolean) {
	const lines = text
		.replace(/\r\n?/g, '\n')
		.trim()
		.split('\n')
		.map((l) => noHeading(l.trimEnd()));
	if (!inListItem) return lines.join('\n');
	return lines
		.map((l) => l.trim())
		.filter(Boolean)
		.join('\n  ');
}

export function renderTemplate(template: string, vars: TemplateVars, inListItem = false) {
	return template.replace(PLACEHOLDER, (whole, name: string, arg: string | undefined) => {
		const fmt = arg?.trim();
		switch (name) {
			case 'date':
				return formatDate(vars.recordedAt, fmt || 'YYYY-MM-DD', vars.timeZone);
			case 'time':
				return formatDate(vars.recordedAt, fmt || 'HH:mm', vars.timeZone);
			case 'transcript':
				return transcriptFor(vars.transcript ?? '', inListItem);
			case 'languages':
				return (vars.languages ?? []).join(', ');
			case 'trigger':
				return vars.trigger ?? '';
			case 'duration':
				return formatDuration(vars.durationMs);
			case 'heading':
				return vars.heading ?? '';
			default:
				return whole;
		}
	});
}

/** An entry appended to a note. Entries starting with "- " or "* " keep the transcript in one item */
export function renderEntry(template: string, vars: TemplateVars) {
	const inList = /^\s*([-*+]|\d+\.)\s/.test(template);
	return renderTemplate(template, vars, inList).trimEnd();
}

/** Vault relative note path: no leading slash, no empty or dot segments, .md added when missing */
export function renderNotePath(template: string, vars: TemplateVars) {
	const raw = renderTemplate(template, vars).trim().replace(/\\/g, '/');
	const segments = raw.split('/').filter((s) => s && s !== '.');
	if (segments.some((s) => s === '..')) throw new Error('Note path cannot contain ..');
	if (!segments.length) throw new Error('Note path is empty');
	const path = segments.join('/');
	return /\.md$/i.test(path) ? path : `${path}.md`;
}
