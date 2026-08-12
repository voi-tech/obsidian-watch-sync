/**
 * Frontmatter values arrive from Obsidian's metadata cache as whatever YAML
 * produced — a list, a scalar, or nothing. The two list-ish properties this
 * plugin reads need different treatment, which is the whole reason these are
 * separate functions.
 */

/**
 * `aliases: Some Long Name` is one alias, not three. Only a YAML list holds
 * several; splitting a scalar on whitespace would invent aliases that are not
 * there and match notes that have nothing to do with the title.
 */
export function toAliases(value: unknown): string[] {
	if (Array.isArray(value)) return value.map(String).filter((alias) => alias.trim() !== '');
	if (typeof value === 'string' && value.trim()) return [value.trim()];
	return [];
}

/**
 * Splits a note into its frontmatter block — delimiters and trailing newline
 * included — and the body below it. Either part may be empty.
 */
export function splitFrontmatter(content: string): { frontmatter: string; body: string } {
	const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content);
	if (!match) return { frontmatter: '', body: content };
	return { frontmatter: match[0], body: content.slice(match[0].length) };
}

/**
 * Replaces everything below the frontmatter, keeping the frontmatter itself
 * untouched — properties are the frontmatter editor's business, not the
 * template's.
 */
export function replaceBody(content: string, body: string): string {
	const { frontmatter } = splitFrontmatter(content);
	return `${frontmatter}${body.replace(/^\s+/, '')}`;
}

/** Tags, by contrast, are conventionally space- or comma-separated when scalar. */
export function toTags(value: unknown): string[] {
	if (Array.isArray(value)) return value.map(String).filter(Boolean);
	if (typeof value === 'string') return value.split(/[,\s]+/).filter(Boolean);
	return [];
}
