import type { NoteRef } from '../sync/matcher';

/**
 * Everything the sync layer is allowed to do to the vault. Keeping it behind an
 * interface is what makes the operation layer testable without an Obsidian
 * instance — and makes the full list of possible side effects visible in one
 * place. Note that there is deliberately no `delete` and no `rename`.
 */
export interface VaultGateway {
	/**
	 * Notes under a folder, recursively, with the frontmatter the matcher needs.
	 * The name of the property holding the Stremio link is configurable, so it
	 * has to be passed in.
	 */
	listNotes(folder: string, sourceProperty: string): NoteRef[];
	/** Read-only access, for planning. */
	readCached(path: string): Promise<string>;
	create(path: string, content: string): Promise<void>;
	/** Atomic read-modify-write of a note body. */
	edit(path: string, transform: (content: string) => string): Promise<void>;
	/** Merges the given keys into frontmatter, leaving every other key untouched. */
	mergeFrontmatter(path: string, patch: Record<string, unknown>, addTags: string[]): Promise<void>;
	exists(path: string): boolean;
	ensureFolder(path: string): Promise<void>;
}
