import type { App } from 'obsidian';
import { fetchCinemetaMeta } from '../meta/cinemeta';
import { MetadataCache, ttlDaysFor } from '../meta/cache';
import { normalize, type MetadataSources, type NormalizeWarning } from '../meta/normalize';
import { TmdbClient } from '../meta/tmdb';
import type { LibraryItem } from '../model/schema';
import type { NormalizedMedia, PluginData, SyncPlan, SyncResult } from '../model/types';
import { selectionOptionsOf } from '../model/types';
import { readSecret, requireSecret } from '../secrets';
import { fetchLibrary, fetchLibraryMeta, selectRelevant } from '../stremio/api';
import { nuvioSourceUrl, parseWebUrl } from '../stremio/links';
import { discoverNuvioBackend, ensureNuvioSession, fetchNuvioProfiles, fetchNuvioSnapshot, NuvioApiError, resolveNuvioProfileIndex, type NuvioSession } from '../nuvio/api';
import { applyNuvioEpisodeStates, nuvioLibraryItems, type NuvioEpisodeState } from '../nuvio/normalize';
import { mapWithLimit } from '../util/limit';
import type { VaultGateway } from '../vault/gateway';
import { buildPlan } from './engine';
import type { ApplicableOperation } from './operations';
import { executePlan } from '../vault/writer';
import { readTemplateSource } from '../vault/template-source';
import { t } from '../i18n';

/** Applies the same watch-status policy to every provider before planning. */
export function filterImportedItems(
	items: LibraryItem[],
	settings: PluginData['settings'],
): LibraryItem[] {
	return selectRelevant(items, selectionOptionsOf(settings));
}

/** Titles normalized at once. Each one is several HTTP round trips. */
const NORMALIZE_CONCURRENCY = 5;

export interface PreparedSync {
	plan: SyncPlan;
	warnings: string[];
}

export interface ApplyOptions {
	onProgress?: (done: number, total: number) => void;
	/**
	 * How many operations the user unchecked in the preview. A partial run must
	 * not advance the incremental watermark, or a background sync would skip the
	 * untouched titles forever.
	 */
	deselected?: number;
}

export class SyncService {
	/** Newest `_mtime` seen during the last `prepare`, recorded after a successful apply. */
	private newestMtime = '';

	constructor(
		private readonly app: App,
		private readonly data: PluginData,
		private readonly gateway: VaultGateway,
		private readonly cache: MetadataCache,
	) {}

	/**
	 * Cheap check for background runs: `datastoreMeta` returns only ids and
	 * modification times, so an idle library costs one small request instead of a
	 * full fetch and a metadata pass.
	 */
	async hasChangesSinceLastSync(): Promise<boolean> {
		if (this.data.settings.provider === 'nuvio') return true;
		const watermark = this.data.lastSyncMtime;
		if (!watermark) return true;
		const authKey = requireSecret(this.app, this.data.settings.authKeySecretId, 'Stremio authKey');
		const meta = await fetchLibraryMeta(authKey);
		return meta.some((entry) => entry.mtime > watermark);
	}

	/**
	 * Library entries for the active source, already narrowed to the selected
	 * import scopes. Shared by the planner and the read-only library summary, so
	 * the summary cannot report on a different set than the one a sync would use.
	 */
	async fetchLibraryItems(): Promise<{ items: LibraryItem[]; episodeStates: NuvioEpisodeState[]; warnings: string[] }> {
		if (this.data.settings.provider === 'nuvio') {
			const result = await this.nuvioItems();
			this.newestMtime = new Date().toISOString();
			return {
				items: filterImportedItems(result.items, this.data.settings),
				episodeStates: result.episodeStates,
				warnings: result.warnings,
			};
		}

		const authKey = requireSecret(this.app, this.data.settings.authKeySecretId, 'Stremio authKey');
		const library = await fetchLibrary(authKey);
		this.newestMtime = library.reduce(
			(newest, item) => (item._mtime && item._mtime > newest ? item._mtime : newest),
			'',
		);
		return { items: filterImportedItems(library, this.data.settings), episodeStates: [], warnings: [] };
	}

	/** Fetches, normalizes and plans. Makes no changes to the vault. */
	async prepare(onProgress?: (done: number, total: number) => void): Promise<PreparedSync> {
		const { items, episodeStates: nuvioEpisodeStates, warnings: providerWarnings } = await this.fetchLibraryItems();
		const sources = this.metadataSources();
		const warnings: NormalizeWarning[] = [];

		const media = await mapWithLimit(
			items,
			NORMALIZE_CONCURRENCY,
			async (item): Promise<NormalizedMedia> => {
				const key = this.cacheKey(item._id);
				const cached = this.cache.get<NormalizedMedia>(key, {
					mtime: item._mtime,
					ttlDays: ttlDaysFor((item.state?.flaggedWatched ?? 0) > 0),
				});
				if (cached) {
					return this.data.settings.provider === 'nuvio'
						? applyNuvioEpisodeStates(cached, nuvioEpisodeStates)
						: cached;
				}

				const result = await normalize(item, sources);
				if (this.data.settings.provider === 'nuvio') {
					result.media.id = `nuvio:${item._id}`;
					result.media.stremioUrl = nuvioSourceUrl(item.type === 'series' ? 'series' : 'movie', item._id);
					result.media.stremioAppUrl = '';
					result.media.stremioEpisodeUrl = undefined;
					return applyNuvioEpisodeStates(result.media, nuvioEpisodeStates);
				}
				warnings.push(...result.warnings);
				this.cache.set(key, result.media, item._mtime);
				return result.media;
			},
			onProgress,
		);

		if (sources.tmdb?.keyRejected) {
			warnings.push({
				mediaId: 'TMDB',
				message: t('warning.tmdbKey'),
			});
		}

		const plan = await buildPlan(media, this.gateway, {
			settings: this.data.settings,
			index: this.data.index,
			templates: {
				movie: await this.readTemplate(this.data.settings.movieTemplateText, this.data.settings.movieTemplate),
				series: await this.readTemplate(this.data.settings.seriesTemplateText, this.data.settings.seriesTemplate),
			},
		});

		return { plan, warnings: [...providerWarnings, ...warnings.map((warning) => `${warning.mediaId}: ${warning.message}`)] };
	}

	async apply(plan: SyncPlan, options: ApplyOptions = {}): Promise<SyncResult> {
		const deselected = options.deselected ?? 0;
		const result = await executePlan(
			{
				create: plan.create as ApplicableOperation[],
				adopt: plan.adopt as ApplicableOperation[],
				update: plan.update as ApplicableOperation[],
				skipped: plan.skipped.length,
				deselected,
			},
			this.gateway,
			options.onProgress,
		);

		this.rebuildIndex(plan);
		this.data.firstSyncDone = true;
		// Only advance the watermark when the whole plan went through, so a failed
		// or partial run is retried rather than silently skipped next time.
		if (deselected === 0 && result.errors.length === 0 && this.newestMtime) {
			if (this.data.settings.provider === 'nuvio') this.data.syncCursors.nuvio = this.newestMtime;
			else this.data.lastSyncMtime = this.newestMtime;
		}
		// Cache entries are derived during prepare. Persist them only after the
		// complete plan succeeded; a preview, partial run, or failed write must be
		// retried from the durable source on the next run.
		if (deselected === 0 && result.errors.length === 0) await this.cache.save();
		return result;
	}

	/**
	 * Rebuilds the id → path cache from scratch: from the `source` properties
	 * actually present in the vault, plus what this run just wrote. Rebuilding
	 * rather than merging is what drops entries for notes that were deleted or
	 * moved out of the synced folders.
	 */
	private rebuildIndex(plan: SyncPlan): void {
		const index: Record<string, string> = {};
		const folders = new Set(
			[this.data.settings.movieFolder, this.data.settings.seriesFolder].filter(Boolean),
		);

		const identityProperty = this.data.settings.properties.link ?? this.data.settings.properties.source ?? '';
		for (const folder of folders) {
			for (const note of this.gateway.listNotes(folder, identityProperty)) {
				const parsed = note.source ? parseWebUrl(note.source) : null;
				if (parsed) index[parsed.id] = note.path;
				else if (note.source) index[this.data.settings.provider === 'nuvio' ? `nuvio:${note.source}` : note.source] = note.path;
			}
		}
		// Notes written moments ago may not be in the metadata cache yet.
		for (const operation of [...plan.create, ...plan.adopt, ...plan.update]) {
			index[operation.mediaId] = operation.path;
		}

		this.data.index = index;
	}

	private metadataSources(): MetadataSources {
		const tmdbKey = readSecret(this.app, this.data.settings.tmdbKeySecretId);
		return {
			tmdb: tmdbKey ? new TmdbClient(tmdbKey, this.data.settings.language) : null,
			fetchCinemeta: fetchCinemetaMeta,
			thresholds: selectionOptionsOf(this.data.settings),
		};
	}

	/**
	 * The cached object holds derived watch state, so anything that changes how a
	 * title is judged has to be part of the key — otherwise moving the watched
	 * threshold would have no effect until the cache expired.
	 */
	private cacheKey(id: string): string {
		const { language, watchedThresholdPercent, sampledThresholdMinutes } = this.data.settings;
		return `norm:${this.data.settings.provider ?? 'none'}:${id}:${language}:${watchedThresholdPercent}:${sampledThresholdMinutes}`;
	}

	private async nuvioItems(): Promise<{ items: LibraryItem[]; warnings: string[]; episodeStates: NuvioEpisodeState[] }> {
		const secretId = this.data.settings.sessionSecretIds.nuvio ?? '';
		const raw = requireSecret(this.app, secretId, 'Nuvio session');
		let stored: NuvioSession;
		try {
			stored = JSON.parse(raw) as NuvioSession;
			if (!stored.accessToken || !stored.refreshToken || !Number.isFinite(stored.expiresAt)) throw new Error('invalid');
		} catch {
			throw new NuvioApiError(t('nuvio.session.invalid'));
		}
		const backend = await discoverNuvioBackend(this.data.settings.nuvioBackendUrl);
		const session = await ensureNuvioSession(backend, stored);
		if (session.accessToken !== stored.accessToken || session.refreshToken !== stored.refreshToken) {
			this.app.secretStorage.setSecret(secretId, JSON.stringify(session));
		}
		const profiles = await fetchNuvioProfiles(backend, session.accessToken);
		const profileIndex = resolveNuvioProfileIndex(profiles, this.data.settings.nuvioProfileId);
		return nuvioLibraryItems(
			await fetchNuvioSnapshot(backend, session.accessToken, profileIndex),
			this.data.settings.importScopes,
		);
	}

	private async readTemplate(inlineText: string, path: string): Promise<string> {
		// The visible file picker is the user's current choice. Inline text is a
		// compatibility fallback for settings created before that editor was removed.
		if (path) return readTemplateSource(this.app.vault, path);
		return inlineText.trim() ? inlineText : readTemplateSource(this.app.vault, '');
	}
}
