/**
 * Domain model. Everything downstream of `meta/normalize.ts` — the sync engine,
 * the template renderer, the writer — sees only these types, never the raw API
 * shapes. That boundary is what lets the Stremio/TMDB contracts move without
 * touching note-writing logic.
 */

import type { WatchStatus, WatchThresholds } from '../stremio/watch-status';

export type { WatchStatus };

export type MediaType = 'movie' | 'series';

export interface EpisodeProgress {
	season: number;
	number: number;
	/** Stremio video id, e.g. `tt19854762:2:8`. */
	videoId: string;
	title?: string;
	airDate?: string;
	watched: boolean;
	/** True for the episode Stremio reports as the current one (`state.video_id`). */
	current: boolean;
}

export interface Season {
	number: number;
	title?: string;
	episodes: EpisodeProgress[];
}

export interface NormalizedMedia {
	/** Stremio library id: `tt19854762` or `tmdb:31011`. */
	id: string;
	imdbId?: string;
	tmdbId?: number;
	type: MediaType;
	title: string;
	originalTitle?: string;
	year?: number;
	yearStart?: number;
	yearEnd?: number;
	/** Premiere date, `YYYY-MM-DD`. First air date for a series. */
	releaseDate?: string;
	description?: string;
	cover?: string;
	backdrop?: string;
	durationMinutes?: number;
	genres: string[];
	cast: string[];
	director?: string;
	/**
	 * YYYY-MM-DD of the last time Stremio played this, finished or not. From
	 * `state.lastWatched`.
	 */
	lastWatched?: string;
	/** How much of it was really watched — see `stremio/watch-status.ts`. */
	watchStatus: WatchStatus;
	finished: boolean;
	progressPercent: number;
	/** The item's page on web.stremio.com. Also written as the link property. */
	stremioUrl: string;
	/** The item's page, opened in the app. */
	stremioAppUrl: string;
	/** The episode Stremio has you on, opened in the app. Series only. */
	stremioEpisodeUrl?: string;
	imdbUrl?: string;
	seasons: Season[];
	lastEpisode?: EpisodeProgress;
	/** Raw `_mtime` for incremental sync. */
	mtime?: string;
}

// --- Sync ------------------------------------------------------------------

export type OperationKind =
	| 'create-file'
	| 'adopt-note'
	| 'update-frontmatter'
	| 'update-episodes'
	| 'append-season'
	| 'update-managed-block'
	| 'add-managed-block'
	| 'rewrite-body';

export interface Operation {
	kind: OperationKind;
	/** Stremio id this operation belongs to. */
	mediaId: string;
	/** Title of the item, so the preview can group operations by what they are about. */
	title: string;
	/** Vault path the operation targets. */
	path: string;
	/** Short label for the preview, where the path is already on the group header. */
	summary(): string;
	/** Full line including the path, for the report and for error messages. */
	describe(): string;
}

export interface Conflict {
	mediaId: string;
	title: string;
	reason: string;
	candidates: string[];
}

export interface Skipped {
	mediaId: string;
	title: string;
	reason: string;
}

export interface SyncPlan {
	create: Operation[];
	adopt: Operation[];
	update: Operation[];
	conflicts: Conflict[];
	skipped: Skipped[];
}

export interface SyncResult {
	created: number;
	adopted: number;
	updated: number;
	skipped: number;
	/** Operations the user unchecked in the preview. */
	deselected: number;
	errors: { id: string; message: string }[];
	durationMs: number;
}

export function emptyPlan(): SyncPlan {
	return { create: [], adopt: [], update: [], conflicts: [], skipped: [] };
}

export function planIsEmpty(plan: SyncPlan): boolean {
	return plan.create.length === 0 && plan.adopt.length === 0 && plan.update.length === 0;
}

export function planSize(plan: SyncPlan): number {
	return plan.create.length + plan.adopt.length + plan.update.length;
}

export function allOperations(plan: SyncPlan): Operation[] {
	return [...plan.create, ...plan.adopt, ...plan.update];
}

/** Restricts a plan to the operations the user kept selected in the preview. */
export function selectOperations(plan: SyncPlan, keep: (operation: Operation) => boolean): SyncPlan {
	return {
		...plan,
		create: plan.create.filter(keep),
		adopt: plan.adopt.filter(keep),
		update: plan.update.filter(keep),
	};
}

// --- Persisted plugin data -------------------------------------------------

export type MetadataLanguage = 'pl-PL' | 'en-US';

/** Provider whose read-only library and playback data is imported. Null means no source selected yet. */
export type SyncProvider = 'stremio' | 'nuvio';
export type SelectedSyncProvider = SyncProvider | null;

/** Independent parts of a provider account that can be imported. */
export type ImportScope = 'library' | 'watchHistory' | 'progress';

export const DEFAULT_IMPORT_SCOPES: ImportScope[] = ['library', 'watchHistory', 'progress'];

/** SecretStorage references only; values are never part of persisted plugin data. */
export type ProviderSecretIds = Partial<Record<SyncProvider, string>>;

/** Provider-specific incremental watermarks. Empty means a full import is needed. */
export type ProviderSyncCursors = Partial<Record<SyncProvider, string>>;

/**
 * How much of an existing note's body the plugin may write.
 *
 * `leave` touches nothing below the frontmatter except episode checkboxes and
 * missing seasons. `managed-block` additionally keeps a delimited region in
 * step with the template. `rewrite` re-renders the whole body from the template
 * — which is what a template is for, but it does replace whatever was there,
 * so every rewrite shows up in the preview as its own deselectable operation.
 */
export type ExistingBodyMode = 'leave' | 'managed-block' | 'rewrite';

/**
 * Frontmatter keys the plugin owns. Configurable because no two vaults name
 * these the same way; an empty string switches the property off entirely.
 */
/** Flat template values which can optionally be written to Obsidian properties. */
export type TemplatePropertyKey =
	| 'title' | 'original' | 'source' | 'provider' | 'kind' | 'year' | 'years' | 'released'
	| 'description' | 'duration' | 'genres' | 'cast' | 'director' | 'cover' | 'backdrop'
	| 'link' | 'resume' | 'imdb' | 'status' | 'progress' | 'finished' | 'watched' | 'episodes' | 'current';

export type PropertyNames = Partial<Record<TemplatePropertyKey, string>>;

export const DEFAULT_PROPERTY_NAMES: PropertyNames = {};

export interface WatchSyncSettings {
	/** Read-only source selected for the next import. */
	provider: SelectedSyncProvider;
	/** Data sections selected for import. */
	importScopes: ImportScope[];
	/** SecretStorage id, never the value itself. */
	authKeySecretId: string;
	tmdbKeySecretId: string;
	/** SecretStorage ids for provider sessions; never session values or passwords. */
	sessionSecretIds: ProviderSecretIds;
	/** Configurable Nuvio backend; defaults to the official hosted backend. */
	nuvioBackendUrl: string;
	/** Selected Nuvio profile persisted by stable id and display name. */
	nuvioProfileId: string;
	nuvioProfileName: string;
	movieFolder: string;
	seriesFolder: string;
	movieTemplate: string;
	seriesTemplate: string;
	/** Optional inline Markdown overrides; empty means use the selected file or built-in template. */
	movieTemplateText: string;
	seriesTemplateText: string;
	movieFilenamePattern: string;
	seriesFilenamePattern: string;
	language: MetadataLanguage;
	/** Include library entries that were never played. */
	includeUnwatchedLibrary: boolean;
	/** Skip titles that were only opened briefly and abandoned. */
	skipSampledTitles: boolean;
	/** Below this many minutes of playback a title counts as merely sampled. */
	sampledThresholdMinutes: number;
	/** Share of a video's runtime that counts as watched. Stremio's own mark is 70. */
	watchedThresholdPercent: number;
	/** Mark finished items with this tag; empty string disables. */
	doneTag: string;
	properties: PropertyNames;
	/** Show the selectable preview before every manual sync, not just the first. */
	confirmBeforeWriting: boolean;
	/** What may happen to the body of a note that already exists. */
	existingBodyMode: ExistingBodyMode;
	/** Off by default: the primary mode of operation is a manual sync. */
	autoSyncEnabled: boolean;
	autoSyncIntervalMinutes: number;
}

export interface PluginData {
	/** Persisted-data contract version. Schema 1 is migrated without data loss. */
	schemaVersion: number;
	settings: WatchSyncSettings;
	/** Stremio id → vault path. A cache; `source` in frontmatter stays the source of truth. */
	index: Record<string, string>;
	/** Per-provider incremental cursors. */
	syncCursors: ProviderSyncCursors;
	/** Compatibility mirror retained while older service code migrates to syncCursors.stremio. */
	lastSyncMtime?: string;
	recentEvents: RecentEvent[];
	firstSyncDone: boolean;
}

export interface RecentEvent {
	at: string;
	kind: 'sync' | 'connection';
	status: 'success' | 'warning' | 'error';
	message: string;
}

export const DATA_SCHEMA_VERSION = 3;

export const DEFAULT_NUVIO_BACKEND_URL = 'https://api.nuvio.tv';

export const DEFAULT_SETTINGS: WatchSyncSettings = {
	provider: null,
	importScopes: [],
	authKeySecretId: '',
	tmdbKeySecretId: '',
	sessionSecretIds: {},
	nuvioBackendUrl: DEFAULT_NUVIO_BACKEND_URL,
	nuvioProfileId: '',
	nuvioProfileName: '',
	movieFolder: '',
	seriesFolder: '',
	movieTemplate: '',
	seriesTemplate: '',
	movieTemplateText: '',
	seriesTemplateText: '',
	movieFilenamePattern: '{{title}} ({{year}})',
	seriesFilenamePattern: '{{title}} ({{years}})',
	language: 'pl-PL',
	includeUnwatchedLibrary: true,
	skipSampledTitles: true,
	sampledThresholdMinutes: 5,
	watchedThresholdPercent: 70,
	doneTag: '',
	properties: DEFAULT_PROPERTY_NAMES,
	confirmBeforeWriting: true,
	existingBodyMode: 'leave',
	autoSyncEnabled: false,
	autoSyncIntervalMinutes: 360,
};

/**
 * Turns the "what counts as watched" settings into the shape the selection and
 * normalization layers expect. Pure, so the summary command does not have to
 * build a whole sync service to ask the question.
 */
export function selectionOptionsOf(
	settings: WatchSyncSettings,
): WatchThresholds & { includeUnwatchedLibrary: boolean; skipSampledTitles: boolean } {
	return {
		includeUnwatchedLibrary: settings.includeUnwatchedLibrary,
		skipSampledTitles: settings.skipSampledTitles,
		watchedPercent: settings.watchedThresholdPercent,
		sampledMinutes: settings.sampledThresholdMinutes,
	};
}

export const DEFAULT_DATA: PluginData = {
	schemaVersion: DATA_SCHEMA_VERSION,
	settings: DEFAULT_SETTINGS,
	index: {},
	syncCursors: {},
	recentEvents: [],
	firstSyncDone: false,
};
