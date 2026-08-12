import type { LibraryItem, LibraryItemState } from '../model/schema';
import type { EpisodeProgress } from '../model/types';

/**
 * How much of a title was actually watched.
 *
 * Stremio stores no explicit "I really watched this" flag at the title level, so
 * opening something to see what it is leaves the same kind of trace as watching
 * it. These four states separate the two.
 */
export type WatchStatus = 'unwatched' | 'sampled' | 'in-progress' | 'watched';

export interface WatchThresholds {
	/**
	 * Share of a video's duration that counts as watched. Stremio's own constant
	 * is 0.7 (`WATCHED_THRESHOLD_COEF` in stremio-core), which is what sets
	 * `state.flaggedWatched`.
	 */
	watchedPercent: number;
	/** Below this many minutes a title counts as merely sampled. */
	sampledMinutes: number;
}

export const DEFAULT_THRESHOLDS: WatchThresholds = { watchedPercent: 70, sampledMinutes: 5 };

/** Milliseconds spent in the current video, whichever measure is larger. */
function currentVideoMs(state: LibraryItemState): number {
	return Math.max(state.timeWatched ?? 0, state.timeOffset ?? 0);
}

/** Milliseconds spent on the title as a whole. */
function totalMs(state: LibraryItemState): number {
	return Math.max(currentVideoMs(state), state.overallTimeWatched ?? 0);
}

function reachedThreshold(state: LibraryItemState, thresholds: WatchThresholds): boolean {
	const duration = state.duration ?? 0;
	if (duration <= 0) return false;
	return currentVideoMs(state) / duration >= thresholds.watchedPercent / 100;
}

/**
 * Status of a movie from its state alone.
 *
 * Two independent ways to count as watched: Stremio's own verdict
 * (`flaggedWatched`, set at its 70% mark) is always trusted, and the configured
 * threshold can additionally promote a title Stremio has not flagged — a film
 * stopped at 67%, before the credits, being the usual case.
 */
export function movieWatchStatus(state: LibraryItemState, thresholds: WatchThresholds): WatchStatus {
	if ((state.flaggedWatched ?? 0) > 0 || (state.timesWatched ?? 0) > 0) return 'watched';
	if (reachedThreshold(state, thresholds)) return 'watched';

	const total = totalMs(state);
	if (total === 0) return 'unwatched';
	if (total < thresholds.sampledMinutes * 60_000) return 'sampled';
	return 'in-progress';
}

/**
 * Status of a series before its episode list is known.
 *
 * `flaggedWatched` is deliberately ignored here: on a series it refers to the
 * current episode, not to the show, so a single finished episode would otherwise
 * mark a twelve-season run as watched.
 */
export function seriesWatchStatusFromState(
	state: LibraryItemState,
	thresholds: WatchThresholds,
): WatchStatus {
	const total = totalMs(state);
	if (total === 0) return 'unwatched';
	if (total < thresholds.sampledMinutes * 60_000) return 'sampled';
	return 'in-progress';
}

/** Status of a library entry from state alone, whichever type it is. */
export function titleWatchStatus(item: LibraryItem, thresholds: WatchThresholds): WatchStatus {
	const state = item.state ?? {};
	return item.type === 'series'
		? seriesWatchStatusFromState(state, thresholds)
		: movieWatchStatus(state, thresholds);
}

/**
 * Final status of a series, once the episode list is available.
 *
 * Episode watched flags come from Stremio's bitfield, which the app sets at its
 * own 70% mark — there is no per-episode position to re-check, so an episode
 * Stremio counted is taken at face value. Episodes that have not aired yet are
 * ignored so an ongoing show can still read as watched.
 */
export function seriesWatchStatus(
	state: LibraryItemState,
	episodes: EpisodeProgress[],
	thresholds: WatchThresholds,
	today = new Date(),
): WatchStatus {
	const fromState = seriesWatchStatusFromState(state, thresholds);
	if (episodes.length === 0) return fromState;

	const aired = episodes.filter((episode) => !episode.airDate || new Date(episode.airDate) <= today);
	const watched = aired.filter((episode) => episode.watched).length;

	if (watched === 0) return fromState === 'watched' ? 'in-progress' : fromState;
	if (aired.length > 0 && watched === aired.length) return 'watched';
	return 'in-progress';
}

/** Whether a title is worth a note at all. */
export function shouldSync(
	status: WatchStatus,
	options: { includeUnwatchedLibrary: boolean; skipSampled: boolean; inLibrary: boolean },
): boolean {
	switch (status) {
		case 'watched':
		case 'in-progress':
			return true;
		case 'sampled':
			// Something opened and abandoned. Keep it only if the user asked for it,
			// and only when it is genuinely in the library rather than a leftover of
			// pressing play.
			return !options.skipSampled && options.inLibrary;
		case 'unwatched':
			return options.includeUnwatchedLibrary && options.inLibrary;
	}
}
