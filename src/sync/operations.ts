import type { Operation, OperationKind, Season } from '../model/types';
import { replaceBody } from '../vault/frontmatter';
import { appendManagedBlock, replaceManagedBlock } from '../vault/managed-block';
import {
	appendSeasonSection,
	applyCheckboxChanges,
	renderSeasonSection,
	type CheckboxChange,
} from '../vault/episodes';
import type { VaultGateway } from '../vault/gateway';

/**
 * Every change to the vault is one of these objects. They carry both a
 * human-readable description and the ability to apply themselves, so the preview
 * modal, the report and the actual write all run off the same definitions —
 * a dry run cannot drift from what a real sync does.
 */
export interface ApplicableOperation extends Operation {
	apply(gateway: VaultGateway): Promise<void>;
}

abstract class BaseOperation implements ApplicableOperation {
	abstract readonly kind: OperationKind;

	constructor(
		readonly mediaId: string,
		readonly title: string,
		readonly path: string,
	) {}

	abstract summary(): string;
	abstract apply(gateway: VaultGateway): Promise<void>;

	/**
	 * Full sentence including the path, for the report and for error messages
	 * where there is no surrounding context to say which note is meant.
	 */
	describe(): string {
		return `${this.summary()} — ${this.path}`;
	}
}

/** Creates a note that does not exist yet, body rendered from the template. */
export class CreateFile extends BaseOperation {
	readonly kind = 'create-file' as const;

	constructor(
		mediaId: string,
		title: string,
		path: string,
		private readonly body: string,
		private readonly frontmatter: Record<string, unknown>,
		private readonly tags: string[],
		private readonly folder: string,
	) {
		super(mediaId, title, path);
	}

	summary(): string {
		return 'Create the note';
	}

	async apply(gateway: VaultGateway): Promise<void> {
		await gateway.ensureFolder(this.folder);
		await gateway.create(this.path, this.body);
		await gateway.mergeFrontmatter(this.path, this.frontmatter, this.tags);
	}
}

/**
 * Claims an existing hand-written note by writing `source`, so later syncs match
 * it by id instead of by name. Body untouched.
 */
export class AdoptNote extends BaseOperation {
	readonly kind = 'adopt-note' as const;

	constructor(
		mediaId: string,
		title: string,
		path: string,
		private readonly frontmatter: Record<string, unknown>,
		private readonly tags: string[],
		private readonly tier: string,
	) {
		super(mediaId, title, path);
	}

	summary(): string {
		const keys = Object.keys(this.frontmatter).join(', ');
		return `Adopt this note, matched by ${this.tier}${keys ? ` · sets ${keys}` : ''}`;
	}

	async apply(gateway: VaultGateway): Promise<void> {
		await gateway.mergeFrontmatter(this.path, this.frontmatter, this.tags);
	}
}

/** Updates only the properties the plugin owns; other keys are left alone. */
export class UpdateFrontmatter extends BaseOperation {
	readonly kind = 'update-frontmatter' as const;

	constructor(
		mediaId: string,
		title: string,
		path: string,
		private readonly patch: Record<string, unknown>,
		private readonly tags: string[],
		private readonly changedKeys: string[],
	) {
		super(mediaId, title, path);
	}

	summary(): string {
		const parts = [...this.changedKeys];
		if (this.tags.length > 0) parts.push(`tags += ${this.tags.join(', ')}`);
		return `Properties: ${parts.join(', ')}`;
	}

	async apply(gateway: VaultGateway): Promise<void> {
		await gateway.mergeFrontmatter(this.path, this.patch, this.tags);
	}
}

/** Flips episode checkboxes. Titles and surrounding prose are never rewritten. */
export class UpdateEpisodes extends BaseOperation {
	readonly kind = 'update-episodes' as const;

	constructor(
		mediaId: string,
		title: string,
		path: string,
		private readonly changes: CheckboxChange[],
	) {
		super(mediaId, title, path);
	}

	summary(): string {
		const ticked = this.changes.filter((change) => change.to).length;
		const unticked = this.changes.length - ticked;
		const counts = [ticked > 0 ? `tick ${ticked}` : '', unticked > 0 ? `untick ${unticked}` : '']
			.filter(Boolean)
			.join(', ');
		const shown = this.changes
			.slice(0, 3)
			.map((change) => `S${change.season}E${change.episode}`)
			.join(', ');
		const more = this.changes.length > 3 ? ` +${this.changes.length - 3}` : '';
		return `Episodes: ${counts} · ${shown}${more}`;
	}

	async apply(gateway: VaultGateway): Promise<void> {
		await gateway.edit(this.path, (content) => applyCheckboxChanges(content, this.changes));
	}
}

/** Appends a season that aired after the note was written. */
export class AppendSeason extends BaseOperation {
	readonly kind = 'append-season' as const;

	constructor(
		mediaId: string,
		title: string,
		path: string,
		private readonly season: Season,
	) {
		super(mediaId, title, path);
	}

	summary(): string {
		return `Add season ${this.season.number} (${this.season.episodes.length} episodes)`;
	}

	async apply(gateway: VaultGateway): Promise<void> {
		await gateway.edit(this.path, (content) => appendSeasonSection(content, this.season));
	}

	preview(): string {
		return renderSeasonSection(this.season);
	}
}

/**
 * Regenerates the inside of a `%% stremio %% … %% /stremio %%` block. The block
 * is opt-in — the rest of updating a note never depends on it, because notes
 * here are hand-written and the user is not obliged to know where a "do not
 * edit" region begins.
 */
export class UpdateManagedBlock extends BaseOperation {
	readonly kind = 'update-managed-block' as const;

	constructor(
		mediaId: string,
		title: string,
		path: string,
		private readonly content: string,
	) {
		super(mediaId, title, path);
	}

	summary(): string {
		return 'Refresh the managed block';
	}

	async apply(gateway: VaultGateway): Promise<void> {
		await gateway.edit(this.path, (content) => replaceManagedBlock(content, this.content) ?? content);
	}
}

/** Adds the managed block to a note that does not have one yet. */
export class AddManagedBlock extends BaseOperation {
	readonly kind = 'add-managed-block' as const;

	constructor(
		mediaId: string,
		title: string,
		path: string,
		private readonly content: string,
	) {
		super(mediaId, title, path);
	}

	summary(): string {
		return 'Add the managed block';
	}

	async apply(gateway: VaultGateway): Promise<void> {
		await gateway.edit(this.path, (content) => appendManagedBlock(content, this.content));
	}
}

/**
 * Re-renders the whole body from the template, replacing what was there.
 *
 * This is the destructive one, and deliberately so: a template exists to define
 * what a note looks like, and importing from Stremio means the imported version
 * wins. Frontmatter is left to the frontmatter editor, and every rewrite is a
 * separate line in the preview that the user can uncheck.
 */
export class RewriteBody extends BaseOperation {
	readonly kind = 'rewrite-body' as const;

	constructor(
		mediaId: string,
		title: string,
		path: string,
		private readonly body: string,
	) {
		super(mediaId, title, path);
	}

	summary(): string {
		return 'Rewrite the body from the template (replaces the current text)';
	}

	async apply(gateway: VaultGateway): Promise<void> {
		await gateway.edit(this.path, (content) => replaceBody(content, this.body));
	}
}
