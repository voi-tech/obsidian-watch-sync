import type {
	Conflict,
	NormalizedMedia,
	Skipped,
	StremioSyncSettings,
	SyncPlan,
} from '../model/types';
import { emptyPlan } from '../model/types';
import { diffCheckboxes, missingSeasons } from '../vault/episodes';
import { toTags } from '../vault/frontmatter';
import type { VaultGateway } from '../vault/gateway';
import {
	buildContext,
	BUILTIN_MOVIE_TEMPLATE,
	BUILTIN_SERIES_TEMPLATE,
	render,
	renderFilename,
} from '../vault/template';
import { matchNote, type NoteRef } from './matcher';
import {
	AddManagedBlock,
	AdoptNote,
	AppendSeason,
	CreateFile,
	UpdateEpisodes,
	RewriteBody,
	UpdateFrontmatter,
	UpdateManagedBlock,
	type ApplicableOperation,
} from './operations';
import { splitFrontmatter } from '../vault/frontmatter';
import {
	defaultManagedBlock,
	hasManagedBlock,
	managedBlockTemplate,
	readManagedBlock,
} from '../vault/managed-block';

export interface EngineOptions {
	settings: StremioSyncSettings;
	index: Record<string, string>;
	/** Template bodies already read from the vault; empty falls back to built-ins. */
	templates: { movie: string; series: string };
}

/**
 * Turns normalized library items into a list of operations. Nothing here writes;
 * the resulting plan is what the preview modal shows and what the writer later
 * executes, so what the user approves is exactly what happens.
 */
export async function buildPlan(
	items: NormalizedMedia[],
	gateway: VaultGateway,
	options: EngineOptions,
): Promise<SyncPlan> {
	const plan = emptyPlan();
	const { settings } = options;

	const notesByFolder = new Map<string, NoteRef[]>();
	const notesFor = (folder: string): NoteRef[] => {
		if (!notesByFolder.has(folder)) {
			notesByFolder.set(folder, gateway.listNotes(folder, settings.properties.source));
		}
		return notesByFolder.get(folder)!;
	};

	const claimedPaths = new Set<string>();
	const claimedNotes = new Map<string, { mediaId: string; title: string }>();
	const blockedNotes = new Set<string>();
	const templates = {
		movie: options.templates.movie || BUILTIN_MOVIE_TEMPLATE,
		series: options.templates.series || BUILTIN_SERIES_TEMPLATE,
	};
	// The block is rendered per title, but its source is extracted from the
	// template once. A template with no block falls back to a built-in summary.
	const blockTemplates = {
		movie: managedBlockTemplate(templates.movie),
		series: managedBlockTemplate(templates.series),
	};

	for (const media of items) {
		const folder = media.type === 'series' ? settings.seriesFolder : settings.movieFolder;
		if (!folder) {
			plan.skipped.push({ mediaId: media.id, title: media.title, reason: 'no target folder configured' });
			continue;
		}

		const outcome = matchNote(media, notesFor(folder), options.index);
		if ('conflict' in outcome) {
			plan.conflicts.push(outcome.conflict);
			continue;
		}

		if (outcome.match === null) {
			const creation = planCreate(media, folder, options, claimedPaths, gateway);
			if ('skipped' in creation) plan.skipped.push(creation.skipped);
			else if ('conflict' in creation) plan.conflicts.push(creation.conflict);
			else {
				plan.create.push(creation.operation);
				claimedPaths.add(creation.operation.path);
			}
			continue;
		}

		const { note, certain } = outcome.match;
		const sameNoteReason = 'more than one Stremio library item matches the same note';
		if (blockedNotes.has(note.path)) {
			plan.conflicts.push({
				mediaId: media.id,
				title: media.title,
				reason: sameNoteReason,
				candidates: [note.path],
			});
			continue;
		}

		const previous = claimedNotes.get(note.path);
		if (previous?.mediaId === media.id) continue;
		if (previous) {
			removeOperationsFor(plan, previous.mediaId);
			plan.conflicts.push(
				{
					mediaId: previous.mediaId,
					title: previous.title,
					reason: sameNoteReason,
					candidates: [note.path],
				},
				{
					mediaId: media.id,
					title: media.title,
					reason: sameNoteReason,
					candidates: [note.path],
				},
			);
			claimedNotes.delete(note.path);
			blockedNotes.add(note.path);
			continue;
		}

		claimedNotes.set(note.path, { mediaId: media.id, title: media.title });
		claimedPaths.add(note.path);

		if (!certain) {
			const patch = frontmatterPatch(media, settings);
			plan.adopt.push(...planAdopt(media, note, patch, settings, outcome.match.tier));
		} else {
			plan.update.push(...planUpdate(media, note, settings));
		}

		plan.update.push(...(await planBody(media, note, gateway, templates, blockTemplates, settings)));
	}

	return plan;
}

function removeOperationsFor(plan: SyncPlan, mediaId: string): void {
	plan.create = plan.create.filter((operation) => operation.mediaId !== mediaId);
	plan.adopt = plan.adopt.filter((operation) => operation.mediaId !== mediaId);
	plan.update = plan.update.filter((operation) => operation.mediaId !== mediaId);
}

type CreateOutcome = { operation: ApplicableOperation } | { skipped: Skipped } | { conflict: Conflict };

function planCreate(
	media: NormalizedMedia,
	folder: string,
	options: EngineOptions,
	claimedPaths: Set<string>,
	gateway: VaultGateway,
): CreateOutcome {
	const context = buildContext(media);
	const pattern =
		media.type === 'series' ? options.settings.seriesFilenamePattern : options.settings.movieFilenamePattern;
	const template =
		media.type === 'series'
			? options.templates.series || BUILTIN_SERIES_TEMPLATE
			: options.templates.movie || BUILTIN_MOVIE_TEMPLATE;

	const basename = renderFilename(pattern, context);
	const path = `${folder}/${basename}.md`;

	// A file already sitting at the target path was not matched by any tier, so
	// writing there would clobber an unrelated note.
	if (claimedPaths.has(path) || gateway.exists(path)) {
		return {
			conflict: {
				mediaId: media.id,
				title: media.title,
				reason: 'a file with this name already exists but was not matched',
				candidates: [path],
			},
		};
	}

	if (media.type === 'series' && media.seasons.length === 0) {
		return {
			skipped: {
				mediaId: media.id,
				title: media.title,
				reason: 'no episode list in the metadata — the series note would be empty',
			},
		};
	}

	const body = render(template, context);
	return {
		operation: new CreateFile(
			media.id,
			media.title,
			path,
			body,
			frontmatterPatch(media, options.settings),
			tagsFor(media, options.settings),
			folder,
		),
	};
}

/**
 * First contact with a hand-written note: fill gaps, never overwrite. The user's
 * own dates and covers are assumed to be deliberate until the note is claimed.
 */
function planAdopt(
	media: NormalizedMedia,
	note: NoteRef,
	patch: Record<string, unknown>,
	settings: StremioSyncSettings,
	tier: string,
): ApplicableOperation[] {
	const gaps: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined || value === null || value === '') continue;
		// The link is what claims the note, so it is always written; everything
		// else only fills a gap.
		if (key === settings.properties.source || !hasFrontmatterValue(note, key)) gaps[key] = value;
	}
	return [new AdoptNote(media.id, media.title, note.path, gaps, tagsFor(media, settings), tier)];
}

/** A claimed note stays in sync; `start` is still only ever filled, not moved. */
function planUpdate(
	media: NormalizedMedia,
	note: NoteRef,
	settings: StremioSyncSettings,
): ApplicableOperation[] {
	const current = note.frontmatter;
	const patch = frontmatterPatch(media, settings);
	const changed: Record<string, unknown> = {};
	const changedKeys: string[] = [];

	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined || value === null || value === '') continue;
		if (scalarText(current[key]) === scalarText(value)) continue;
		changed[key] = value;
		changedKeys.push(key);
	}

	const existingTags = toTags(note.frontmatter.tags);
	const missingTags = tagsFor(media, settings).filter((tag) => !existingTags.includes(tag));
	if (changedKeys.length === 0 && missingTags.length === 0) return [];

	return [new UpdateFrontmatter(media.id, media.title, note.path, changed, missingTags, changedKeys)];
}

function scalarText(value: unknown): string | null {
	if (value === undefined || value === null) return '';
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	return null;
}

/** Episode checkboxes, new seasons and the optional managed block. */
async function planBody(
	media: NormalizedMedia,
	note: NoteRef,
	gateway: VaultGateway,
	templates: { movie: string; series: string },
	blockTemplates: { movie: string | null; series: string | null },
	settings: StremioSyncSettings,
): Promise<ApplicableOperation[]> {
	const content = await gateway.readCached(note.path);
	const isSeries = media.type === 'series';

	// A rewrite regenerates everything below the frontmatter, so the checkbox and
	// season operations that would edit the old body are pointless — the rendered
	// template already carries the current watch state.
	if (settings.existingBodyMode === 'rewrite') {
		const rendered = render(isSeries ? templates.series : templates.movie, buildContext(media));
		const body = splitFrontmatter(rendered).body;
		if (splitFrontmatter(content).body.trim() === body.trim()) return [];
		return [new RewriteBody(media.id, media.title, note.path, body)];
	}

	const operations: ApplicableOperation[] = [];

	if (isSeries && media.seasons.length > 0) {
		const changes = diffCheckboxes(content, media.seasons);
		if (changes.length > 0) operations.push(new UpdateEpisodes(media.id, media.title, note.path, changes));

		for (const season of missingSeasons(content, media.seasons)) {
			operations.push(new AppendSeason(media.id, media.title, note.path, season));
		}
	}

	const present = hasManagedBlock(content);
	if (!present && settings.existingBodyMode !== 'managed-block') return operations;

	const source = isSeries ? blockTemplates.series : blockTemplates.movie;
	const rendered = source ? render(source, buildContext(media)).trim() : defaultManagedBlock(media);

	if (!present) {
		operations.push(new AddManagedBlock(media.id, media.title, note.path, rendered));
	} else if (readManagedBlock(content) !== rendered) {
		operations.push(new UpdateManagedBlock(media.id, media.title, note.path, rendered));
	}

	return operations;
}

/**
 * The properties the plugin owns. Every other key in a note is off limits, and a
 * property whose configured name is blank is not written at all.
 */
export function frontmatterPatch(
	media: NormalizedMedia,
	settings: StremioSyncSettings,
): Record<string, unknown> {
	const names = settings.properties;
	const patch: Record<string, unknown> = {};
	const put = (name: string, value: unknown): void => {
		if (name && value !== undefined && value !== null && value !== '') patch[name] = value;
	};

	put(names.releaseDate, media.releaseDate);
	put(names.lastWatched, media.lastWatched);
	put(names.duration, media.durationMinutes);
	put(names.cover, media.cover);
	put(names.source, media.stremioUrl);
	return patch;
}

export function tagsFor(media: NormalizedMedia, settings: StremioSyncSettings): string[] {
	return media.finished && settings.doneTag ? [settings.doneTag] : [];
}

function hasFrontmatterValue(note: NoteRef, key: string): boolean {
	const value = note.frontmatter[key];
	return value !== undefined && value !== null && value !== '';
}
