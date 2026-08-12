import type { NoteRef } from '../src/sync/matcher';
import type { VaultGateway } from '../src/vault/gateway';

/**
 * In-memory vault. Frontmatter is stored alongside the body rather than parsed
 * out of it, matching how Obsidian's metadata cache behaves.
 */
export class FakeVault implements VaultGateway {
	readonly files = new Map<string, string>();
	readonly frontmatter = new Map<string, Record<string, unknown>>();
	readonly folders = new Set<string>();
	readonly writes: string[] = [];

	addNote(path: string, content: string, frontmatter: Record<string, unknown> = {}): void {
		this.files.set(path, content);
		this.frontmatter.set(path, frontmatter);
		const folder = path.slice(0, path.lastIndexOf('/'));
		if (folder) this.folders.add(folder);
	}

	listNotes(folder: string, sourceProperty = 'source'): NoteRef[] {
		const notes: NoteRef[] = [];
		for (const path of this.files.keys()) {
			if (!path.startsWith(`${folder}/`)) continue;
			const frontmatter = this.frontmatter.get(path) ?? {};
			const aliases = frontmatter.aliases;
			notes.push({
				path,
				basename: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
				source:
					typeof frontmatter[sourceProperty] === 'string'
						? (frontmatter[sourceProperty])
						: undefined,
				aliases: stringValues(aliases),
				frontmatter,
			});
		}
		return notes;
	}

	async readCached(path: string): Promise<string> {
		const content = this.files.get(path);
		if (content === undefined) throw new Error(`File not found: ${path}`);
		return content;
	}

	async edit(path: string, transform: (content: string) => string): Promise<void> {
		const content = this.files.get(path);
		if (content === undefined) throw new Error(`File not found: ${path}`);
		const updated = transform(content);
		if (updated === content) return;
		this.files.set(path, updated);
		this.writes.push(`edit ${path}`);
	}

	async create(path: string, content: string): Promise<void> {
		if (this.files.has(path)) throw new Error(`File already exists: ${path}`);
		this.files.set(path, content);
		this.frontmatter.set(path, {});
		this.writes.push(`create ${path}`);
	}

	async mergeFrontmatter(
		path: string,
		patch: Record<string, unknown>,
		addTags: string[],
	): Promise<void> {
		const current = this.frontmatter.get(path) ?? {};
		for (const [key, value] of Object.entries(patch)) current[key] = value;
		if (addTags.length > 0) {
			const raw = current.tags;
			const tags = stringValues(raw);
			for (const tag of addTags) if (!tags.includes(tag)) tags.push(tag);
			current.tags = tags;
		}
		this.frontmatter.set(path, current);
		this.writes.push(`frontmatter ${path}`);
	}

	exists(path: string): boolean {
		return this.files.has(path);
	}

	async ensureFolder(path: string): Promise<void> {
		this.folders.add(path);
	}
}

function stringValues(value: unknown): string[] {
	if (typeof value === 'string') return [value];
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is string => typeof entry === 'string');
}
