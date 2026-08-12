import WatchedBitField from 'stremio-watched-bitfield';
import type { LibraryItemState } from '../model/schema';
import type { EpisodeProgress } from '../model/types';

export interface EpisodeInput {
	season: number;
	number: number;
	videoId: string;
	title?: string;
	airDate?: string;
}

export interface SeriesProgress {
	episodes: EpisodeProgress[];
	/**
	 * False when the decoded bitfield disagrees with `state.video_id` — the one
	 * cross-check available for the episode ordering. The caller must not write
	 * checkboxes from an inconsistent field.
	 */
	consistent: boolean;
	reason?: string;
}

/**
 * Decodes `state.watched` against the canonical episode ordering.
 *
 * The serialized field is `{lastVideoId}:{length}:{base64(deflate(bits))}` and is
 * indexed purely by position, so `videoIds` must be exactly the list Stremio used
 * — Cinemeta's `videos`, seasons and episodes ascending, specials excluded.
 */
export function decodeSeriesProgress(state: LibraryItemState, episodes: EpisodeInput[]): SeriesProgress {
	const currentVideoId = state.video_id ?? undefined;
	const toProgress = (watched: (videoId: string) => boolean): EpisodeProgress[] =>
		episodes.map((episode) => ({
			season: episode.season,
			number: episode.number,
			videoId: episode.videoId,
			title: episode.title,
			airDate: episode.airDate,
			watched: watched(episode.videoId),
			current: episode.videoId === currentVideoId,
		}));

	if (!state.watched) {
		return { episodes: toProgress(() => false), consistent: true };
	}
	if (episodes.length === 0) {
		return { episodes: [], consistent: true };
	}

	const videoIds = episodes.map((episode) => episode.videoId);
	let field: WatchedBitField;
	try {
		field = WatchedBitField.constructAndResize(state.watched, videoIds);
	} catch (error) {
		return {
			episodes: toProgress(() => false),
			consistent: false,
			reason: `could not decode the watched field (${error instanceof Error ? error.message : String(error)})`,
		};
	}

	const decoded = toProgress((videoId) => field.getVideo(videoId));

	// `constructAndResize` already compensates when episodes were appended or the
	// list start shifted, so a single unwatched episode proves nothing. Only two
	// signals are strong enough to withhold a write:

	// 1. Stremio points at an episode the metadata does not contain at all — the
	//    episode list is incomplete and every index after the gap is suspect.
	const current = decoded.find((episode) => episode.current);
	if (currentVideoId && !current && looksLikeEpisodeId(currentVideoId)) {
		return {
			episodes: decoded,
			consistent: false,
			reason: `the current episode ${currentVideoId} is missing from the episode list in the metadata`,
		};
	}

	// 2. Stremio recorded finished playbacks, yet the decoded field is empty.
	//    A correct field can never look like that.
	const watchedCount = decoded.filter((episode) => episode.watched).length;
	if (watchedCount === 0 && (state.timesWatched ?? 0) > 0) {
		return {
			episodes: decoded,
			consistent: false,
			reason: `Stremio reports ${state.timesWatched} completed playbacks but the decoded bitfield is empty — the episode ordering does not line up`,
		};
	}

	return { episodes: decoded, consistent: true };
}

function looksLikeEpisodeId(videoId: string): boolean {
	return videoId.split(':').length >= 3;
}

/** Percentage of the current video, 0–100. */
export function currentVideoPercent(state: LibraryItemState): number {
	const duration = state.duration ?? 0;
	const offset = state.timeOffset ?? 0;
	if (duration <= 0) return 0;
	return Math.min(100, Math.max(0, Math.round((offset / duration) * 100)));
}

export function movieProgressPercent(state: LibraryItemState): number {
	if ((state.flaggedWatched ?? 0) > 0) return 100;
	return currentVideoPercent(state);
}

export function seriesProgressPercent(episodes: EpisodeProgress[]): number {
	if (episodes.length === 0) return 0;
	const watched = episodes.filter((episode) => episode.watched).length;
	return Math.round((watched / episodes.length) * 100);
}
