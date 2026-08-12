import { normalizePath, TFile, TFolder, type App } from 'obsidian';
import type { SyncResult } from '../model/types';
import type { ApplicableOperation } from '../sync/operations';
import type { NoteRef } from '../sync/matcher';
import { toAliases, toTags } from './frontmatter';
import type { VaultGateway } from './gateway';

export class ObsidianVaultGateway implements VaultGateway {
	constructor(private readonly app: App) {}

	/**
	 * Every note under the folder, subfolders included. Matching has to see them:
	 * a note filed away in `Movies/2024/` would otherwise be invisible and the
	 * plugin would happily create a duplicate next to it.
	 */
	listNotes(folder: string, sourceProperty: string): NoteRef[] {
		const root = this.app.vault.getFolderByPath(normalizePath(folder));
		if (!root) return [];

		const notes: NoteRef[] = [];
		const walk = (current: TFolder): void => {
			for (const child of current.children) {
				if (child instanceof TFolder) {
					walk(child);
					continue;
				}
				if (!(child instanceof TFile) || child.extension !== 'md') continue;
				const frontmatter = (this.app.metadataCache.getFileCache(child)?.frontmatter ??
					{}) as Record<string, unknown>;
				const source = sourceProperty ? frontmatter[sourceProperty] : undefined;
				notes.push({
					path: child.path,
					basename: child.basename,
					source: typeof source === 'string' ? source : undefined,
					aliases: toAliases(frontmatter.aliases),
					frontmatter,
				});
			}
		};
		walk(root);
		return notes;
	}

	/** Read for analysis. Cheaper than `read` and safe because nothing follows it. */
	async readCached(path: string): Promise<string> {
		return this.app.vault.cachedRead(this.requireFile(path));
	}

	async create(path: string, content: string): Promise<void> {
		await this.app.vault.create(normalizePath(path), content);
	}

	/**
	 * Atomic read-modify-write. `Vault.process` holds the file for the duration,
	 * which `read` followed by `modify` does not — and a sync that runs while the
	 * user is typing in the note would otherwise drop their keystrokes.
	 */
	async edit(path: string, transform: (content: string) => string): Promise<void> {
		await this.app.vault.process(this.requireFile(path), transform);
	}

	/**
	 * Merges through Obsidian's own frontmatter editor, which rewrites only the
	 * keys touched here and leaves formatting, comments and unknown properties
	 * alone. Tags are added, never removed — a status the user set by hand stays.
	 */
	async mergeFrontmatter(
		path: string,
		patch: Record<string, unknown>,
		addTags: string[],
	): Promise<void> {
		if (Object.keys(patch).length === 0 && addTags.length === 0) return;

		await this.app.fileManager.processFrontMatter(
			this.requireFile(path),
			(frontmatter: Record<string, unknown>) => {
				Object.assign(frontmatter, patch);
				if (addTags.length === 0) return;
				const tags = toTags(frontmatter.tags);
				for (const tag of addTags) {
					if (!tags.includes(tag)) tags.push(tag);
				}
				frontmatter.tags = tags;
			},
		);
	}

	exists(path: string): boolean {
		return this.app.vault.getFileByPath(normalizePath(path)) !== null;
	}

	async ensureFolder(path: string): Promise<void> {
		const normalized = normalizePath(path);
		if (this.app.vault.getFolderByPath(normalized)) return;
		await this.app.vault.createFolder(normalized);
	}

	private requireFile(path: string): TFile {
		const file = this.app.vault.getFileByPath(normalizePath(path));
		if (!file) throw new Error(`File not found: ${path}`);
		return file;
	}
}

export interface ExecutionInput {
	create: ApplicableOperation[];
	adopt: ApplicableOperation[];
	update: ApplicableOperation[];
	skipped: number;
	deselected: number;
}

/**
 * Runs a plan. A failing operation is recorded and the rest continue: one bad
 * title must not abort a two-hundred-item sync.
 */
export async function executePlan(
	input: ExecutionInput,
	gateway: VaultGateway,
	onProgress?: (done: number, total: number) => void,
): Promise<SyncResult> {
	const startedAt = Date.now();
	const counts = { created: 0, adopted: 0, updated: 0 };
	const errors: SyncResult['errors'] = [];

	const buckets = [
		['created', input.create],
		['adopted', input.adopt],
		['updated', input.update],
	] as const;
	const total = input.create.length + input.adopt.length + input.update.length;
	let done = 0;

	for (const [counter, operations] of buckets) {
		for (const operation of operations) {
			try {
				await operation.apply(gateway);
				counts[counter] += 1;
			} catch (error) {
				errors.push({
					id: operation.mediaId,
					message: `${operation.describe()}: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
			done += 1;
			onProgress?.(done, total);
		}
	}

	return {
		...counts,
		skipped: input.skipped,
		deselected: input.deselected,
		errors,
		durationMs: Date.now() - startedAt,
	};
}
