import { describe, expect, it } from 'vitest';
import { formatDuration, renderEntry, renderNotePath, renderTemplate } from './template.ts';

const vars = {
	recordedAt: new Date('2026-10-22T21:30:00Z'),
	timeZone: 'Africa/Nairobi',
	transcript: 'Nunua maziwa, then call Amina',
	languages: ['sw', 'en'],
	trigger: 'single-click-hold',
	durationMs: 83_400
};

describe('renderTemplate', () => {
	it('fills every placeholder in the given zone', () => {
		expect(
			renderTemplate(
				'{{date:YYYY-MM-DD}} {{time:HH:mm}} {{date}} {{time}} [{{languages}}] {{trigger}} {{duration}}: {{transcript}}',
				vars
			)
		).toBe(
			'2026-10-23 00:30 2026-10-23 00:30 [sw, en] single-click-hold 1:23: Nunua maziwa, then call Amina'
		);
	});

	it('leaves unknown placeholders and tolerates spaces', () => {
		expect(renderTemplate('{{ nope }} {{ time : HH }}', vars)).toBe('{{ nope }} 00');
	});

	it('renders missing values as empty', () => {
		const r = renderTemplate('{{languages}}|{{duration}}|{{trigger}}', {
			recordedAt: vars.recordedAt,
			timeZone: 'UTC'
		});
		expect(r).toBe('||');
	});
});

describe('renderEntry', () => {
	it('keeps a multi-line transcript inside one list item', () => {
		const entry = renderEntry('- {{time:HH:mm}} {{transcript}}', {
			...vars,
			transcript: 'First line\r\n\n  Second line  \n# not a heading\n'
		});
		expect(entry).toBe('- 00:30 First line\n  Second line\n  \\# not a heading');
	});

	it('keeps line breaks outside lists', () => {
		const entry = renderEntry('{{time}}\n{{transcript}}\n', {
			...vars,
			transcript: 'One\n\nTwo\n## Three'
		});
		expect(entry).toBe('00:30\nOne\n\nTwo\n\\## Three');
	});

	it('treats numbered and starred entries as list items', () => {
		expect(renderEntry('1. {{transcript}}', { ...vars, transcript: 'a\nb' })).toBe('1. a\n  b');
		expect(renderEntry('* {{transcript}}', { ...vars, transcript: 'a\nb' })).toBe('* a\n  b');
	});
});

describe('renderNotePath', () => {
	it('uses the local date and adds .md', () => {
		expect(renderNotePath('Daily/{{date:YYYY-MM-DD}}', vars)).toBe('Daily/2026-10-23.md');
		expect(renderNotePath('/Journal//{{date:YYYY}}/{{date:MM}}/{{date}}.md', vars)).toBe(
			'Journal/2026/10/2026-10-23.md'
		);
	});

	it('rejects escapes and empty paths', () => {
		expect(() => renderNotePath('../{{date}}', vars)).toThrow();
		expect(() => renderNotePath(' / ', vars)).toThrow();
	});
});

describe('formatDuration', () => {
	it('formats minutes and hours', () => {
		expect(formatDuration(83_400)).toBe('1:23');
		expect(formatDuration(3_723_000)).toBe('1:02:03');
		expect(formatDuration(null)).toBe('');
	});
});
