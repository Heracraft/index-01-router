// Keyset cursor for the recordings list: `<recordedAt ISO>_<id>` of the last row shown

const CURSOR =
	/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function formatCursor(at: string, id: string): string {
	return `${at}_${id}`;
}

/** The `before` param split into time and id. Null when missing or malformed */
export function parseCursor(raw: string | null): { at: string; id: string } | null {
	const m = raw ? CURSOR.exec(raw) : null;
	if (!m || Number.isNaN(Date.parse(m[1]!))) return null;
	return { at: m[1]!, id: m[2]!.toLowerCase() };
}
