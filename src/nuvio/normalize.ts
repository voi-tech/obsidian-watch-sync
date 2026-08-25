import type { ImportScope, NormalizedMedia } from '../model/types';
import type { LibraryItem } from '../model/schema';
import type { NuvioSnapshot } from './api';

export interface NuvioImportResult {
	items: LibraryItem[];
	warnings: string[];
	/** Provider-neutral watch facts for the adapter stage that builds series episode lists. */
	episodeStates: NuvioEpisodeState[];
}

export interface NuvioEpisodeState {
	contentId: string;
	videoId?: string;
	season?: number;
	episode?: number;
	watched: boolean;
	current: boolean;
	position?: number;
	duration?: number;
	lastWatched?: string;
}

/** Applies only explicitly identified episode facts to the canonical episode list. */
export function applyNuvioEpisodeStates(
	media: NormalizedMedia,
	states: readonly NuvioEpisodeState[],
): NormalizedMedia {
	if (media.type !== 'series') return media;
	const matching = states.filter((state) => state.contentId === media.id.replace(/^nuvio:/, ''));
	let lastEpisode = media.lastEpisode;
	for (const season of media.seasons) {
		for (const episode of season.episodes) {
			const state = matching.find((candidate) =>
				candidate.videoId
					? candidate.videoId === episode.videoId
					: candidate.season === episode.season && candidate.episode === episode.number,
			);
			if (!state) continue;
			episode.watched ||= state.watched;
			episode.current ||= state.current;
			if (episode.current) lastEpisode = episode;
		}
	}
	return { ...media, lastEpisode };
}

function mediaType(type: string): 'movie' | 'series' | null {
	const value = type.toLowerCase();
	if (value === 'movie' || value === 'film') return 'movie';
	if (value === 'series' || value === 'tv' || value === 'show') return 'series';
	return null;
}

function isoAt(timestamp: number): string | undefined {
	if (!timestamp) return undefined;
	// Nuvio has returned both Unix seconds and JavaScript milliseconds. A Unix
	// timestamp in milliseconds is already above 10^11; multiplying it again
	// produces dates tens of thousands of years in the future.
	const milliseconds = timestamp >= 100_000_000_000 ? timestamp : timestamp * 1000;
	const date = new Date(milliseconds);
	return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

type EpisodeRecord = {
	content_id: string;
	video_id?: unknown;
	season?: unknown;
	episode?: unknown;
	season_number?: unknown;
	episode_number?: unknown;
	position?: unknown;
	duration?: unknown;
	last_watched?: unknown;
	watched_at?: unknown;
};

function recordOf(value: unknown): EpisodeRecord {
	return value as EpisodeRecord;
}

function text(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function integer(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function decimal(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function episodeCoordinates(record: EpisodeRecord): { season?: number; episode?: number } {
	const season = integer(record.season ?? record.season_number);
	const episode = integer(record.episode ?? record.episode_number);
	return season === undefined || episode === undefined ? {} : { season, episode };
}

/**
 * Nuvio's pull APIs are merged by `content_id` before the existing metadata
 * normalizer is used. This function has no network side effects and never
 * writes back to Nuvio.
 */
export function nuvioLibraryItems(snapshot: NuvioSnapshot, scopes: readonly ImportScope[]): NuvioImportResult {
	const selected = new Set(scopes);
	const library = new Map(snapshot.library.map((entry) => [entry.content_id, entry]));
	const progress = snapshot.progress;
	const watched = snapshot.watched;
	const ids = new Set<string>();
	if (selected.has('library')) for (const entry of snapshot.library) ids.add(entry.content_id);
	if (selected.has('progress')) for (const entry of snapshot.progress) ids.add(entry.content_id);
	if (selected.has('watchHistory')) for (const entry of snapshot.watched) ids.add(entry.content_id);

	const items: LibraryItem[] = [];
	const warnings: string[] = [];
	const episodeStates: NuvioEpisodeState[] = [];
	for (const id of ids) {
		const entry = library.get(id);
		if (!entry || !entry.name.trim()) {
			warnings.push(`${id}: Nuvio returned watch data without library metadata; skipped.`);
			continue;
		}
		const type = mediaType(entry.content_type);
		if (!type) {
			warnings.push(`${id}: Nuvio content type "${entry.content_type}" is not supported; skipped.`);
			continue;
		}
		const playbackEntries = selected.has('progress') ? progress.filter((candidate) => candidate.content_id === id) : [];
		const historyEntries = selected.has('watchHistory') ? watched.filter((candidate) => candidate.content_id === id) : [];
		const playback = [...playbackEntries].sort((a, b) => b.last_watched - a.last_watched)[0];
		const history = [...historyEntries].sort((a, b) => (b.watched_at ?? 0) - (a.watched_at ?? 0))[0];
		if (type === 'series') {
			const states = new Map<string, NuvioEpisodeState>();
			const addEpisode = (raw: unknown, kind: 'progress' | 'watched', index: number): void => {
				const record = recordOf(raw);
				const videoId = text(record.video_id);
				const coordinates = episodeCoordinates(record);
				const identity = videoId ?? (coordinates.season !== undefined && coordinates.episode !== undefined ? `${coordinates.season}:${coordinates.episode}` : undefined);
				const key = identity === undefined ? `${kind}:${index}` : `episode:${identity}`;
				const state = states.get(key) ?? { contentId: id, ...coordinates, ...(videoId ? { videoId } : {}), watched: false, current: false };
				state.watched ||= kind === 'watched';
				state.current ||= kind === 'progress';
				if (kind === 'progress') {
					state.position = decimal(record.position);
					state.duration = decimal(record.duration);
					const lastWatched = decimal(record.last_watched);
					if (lastWatched !== undefined) state.lastWatched = isoAt(lastWatched);
				}
				if (kind === 'watched') {
					const watchedAt = decimal(record.watched_at);
					if (watchedAt !== undefined) state.lastWatched = isoAt(watchedAt);
				}
				states.set(key, state);
				if (identity === undefined) warnings.push(`${id}: Nuvio returned an episode without video_id or season/episode; preserved without guessing its identity.`);
			};
			for (const [index, entry] of playbackEntries.entries()) addEpisode(entry, 'progress', index);
			for (const [index, entry] of historyEntries.entries()) addEpisode(entry, 'watched', index);
			episodeStates.push(...states.values());
		}
		items.push({
			_id: id,
			name: entry.name,
			type,
			poster: entry.poster ?? undefined,
			state: {
				timeOffset: playback?.position,
				duration: playback?.duration,
				lastWatched: isoAt(playback?.last_watched ?? history?.watched_at ?? 0),
				video_id: playback?.video_id || history?.video_id,
				flaggedWatched: history ? 1 : 0,
				timesWatched: history ? 1 : 0,
			},
		});
	}
	return { items, warnings, episodeStates };
}
