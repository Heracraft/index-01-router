// Env values integration fields fall back to (FieldSpec.env), by variable name. Its own module,
// so tests can swap it without mocking the whole of $app/env/private.
import { OBSIDIAN_API_KEY, OBSIDIAN_MCP_URL, OBSIDIAN_VAULT } from '$app/env/private';

export function fieldEnv(name: string): string | undefined {
	const values: Record<string, string | undefined> = { OBSIDIAN_MCP_URL, OBSIDIAN_API_KEY };
	return values[name] || undefined;
}

/** Vault name for obsidian:// links, so they open the right vault when there are several */
export const obsidianVault = (): string | undefined => OBSIDIAN_VAULT || undefined;
