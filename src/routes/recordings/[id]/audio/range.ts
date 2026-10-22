/**
 * Parses a single-range `Range: bytes=...` header. Null means serve the whole file (no header,
 * or a form we do not handle such as multiple ranges); 'unsatisfiable' means answer 416.
 */
export function parseRange(
	header: string | null,
	size: number
): { start: number; end: number } | null | 'unsatisfiable' {
	if (!header) return null;
	const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!m) return null;
	const [, a, b] = m;
	if (a === '' && b === '') return null;
	let start: number;
	let end: number;
	if (a === '') {
		// Suffix: the last N bytes
		const n = Number(b);
		if (n === 0) return 'unsatisfiable';
		start = Math.max(0, size - n);
		end = size - 1;
	} else {
		start = Number(a);
		end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
	}
	if (start >= size || start > end) return 'unsatisfiable';
	return { start, end };
}
