import { describe, expect, it } from 'vitest';
import type { LibraryItem, LibraryItemState } from '../src/model/schema';
import { selectRelevant, type SelectionOptions } from '../src/stremio/api';
import {
	DEFAULT_THRESHOLDS,
	movieWatchStatus,
	seriesWatchStatus,
	seriesWatchStatusFromState,
	shouldSync,
	titleWatchStatus,
} from '../src/stremio/watch-status';
import type { EpisodeProgress } from '../src/model/types';
import { doctorStrange, hijack, lordOfTheRings } from './fixtures/library';

const MIN = 60_000;

const defaults: SelectionOptions = {
	...DEFAULT_THRESHOLDS,
	includeUnwatchedLibrary: true,
	skipSampledTitles: true,
};

/** A film opened for a few seconds and abandoned — the case this module exists for. */
function sampledMovie(minutes: number, runtimeMinutes = 100): LibraryItem {
	return {
		_id: 'tt-sample',
		name: 'Klikniÿty film',
		type: 'movie',
		removed: false,
		temp: false,
		state: {
			timeWatched: minutes * MIN,
			timeOffset: minutes * MIN,
			overallTimeWatched: minutes * MIN,
			duration: runtimeMinutes * MIN,
			timesWatched: 0,
			flaggedWatched: 0,
		},
	};
}

describe('movieWatchStatus', () => {
	it('trusts Stremio when it has flagged the film watched', () => {
		expect(movieWatchStatus(doctorStrange.state, DEFAULT_THRESHOLDS)).toBe('watched');
	});

	it('reports a library entry that was never played as unwatched', () => {
		expect(movieWatchStatus(lordOfTheRings.state, DEFAULT_THRESHOLDS)).toBe('unwatched');
	});

	it('calls a few seconds of playback sampled, not started', () => {
		expect(movieWatchStatus(sampledMovie(0.6).state, DEFAULT_THRESHOLDS)).toBe('sampled');
		expect(movieWatchStatus(sampledMovie(0.1, 0.5).state, DEFAULT_THRESHOLDS)).toBe('sampled');
	});

	it('calls a real but unfinished viewing in-progress', () => {
		// 11.5 min of an 88 min film — the vault's actual "Król Lew" case.
		expect(movieWatchStatus(sampledMovie(11.5, 88.4).state, DEFAULT_THRESHOLDS)).toBe('in-progress');
	});

	it('holds a film stopped below the threshold at in-progress', () => {
		// "Flow": 67% watched, which Stremio itself does not flag.
		expect(movieWatchStatus(sampledMovie(56.9, 85.5).state, DEFAULT_THRESHOLDS)).toBe('in-progress');
	});

	it('promotes that film once the threshold is lowered', () => {
		expect(movieWatchStatus(sampledMovie(56.9, 85.5).state, { watchedPercent: 60, sampledMinutes: 5 })).toBe(
			'watched',
		);
	});

	it('lets a stricter sampled threshold cover a longer tease', () => {
		expect(movieWatchStatus(sampledMovie(11.5, 88.4).state, { watchedPercent: 70, sampledMinutes: 15 })).toBe(
			'sampled',
		);
	});

	it('does not divide by a missing duration', () => {
		const state: LibraryItemState = { timeWatched: 20 * MIN, duration: 0 };
		expect(movieWatchStatus(state, DEFAULT_THRESHOLDS)).toBe('in-progress');
	});
});

describe('seriesWatchStatus', () => {
	const episode = (season: number, number: number, watched: boolean, airDate?: string): EpisodeProgress => ({
		season,
		number,
		videoId: `tt1:${season}:${number}`,
		watched,
		current: false,
		airDate,
	});

	it('ignores flaggedWatched, which on a series refers only to the current episode', () => {
		// Hijack: the last episode is flagged, but season 1 is untouched.
		expect(seriesWatchStatusFromState(hijack.state, DEFAULT_THRESHOLDS)).toBe('in-progress');
	});

	it('is watched only when every aired episode is', () => {
		expect(
			seriesWatchStatus(hijack.state, [episode(1, 1, true), episode(1, 2, true)], DEFAULT_THRESHOLDS),
		).toBe('watched');
		expect(
			seriesWatchStatus(hijack.state, [episode(1, 1, true), episode(1, 2, false)], DEFAULT_THRESHOLDS),
		).toBe('in-progress');
	});

	it('does not hold a show back for a season that has not aired', () => {
		const today = new Date('2026-08-01');
		expect(
			seriesWatchStatus(
				hijack.state,
				[episode(1, 1, true, '2026-01-01'), episode(2, 1, false, '2027-01-01')],
				DEFAULT_THRESHOLDS,
				today,
			),
		).toBe('watched');
	});

	it('calls a show opened for half a minute sampled', () => {
		const state: LibraryItemState = { overallTimeWatched: 0.5 * MIN, duration: 48 * MIN };
		expect(seriesWatchStatus(state, [episode(1, 1, false)], DEFAULT_THRESHOLDS)).toBe('sampled');
	});
});

describe('shouldSync', () => {
	const base = { includeUnwatchedLibrary: true, skipSampled: true, inLibrary: true };

	it('always syncs watched and in-progress titles', () => {
		expect(shouldSync('watched', base)).toBe(true);
		expect(shouldSync('in-progress', base)).toBe(true);
	});

	it('drops sampled titles by default', () => {
		expect(shouldSync('sampled', base)).toBe(false);
	});

	it('keeps sampled titles when asked, but only if they are really in the library', () => {
		expect(shouldSync('sampled', { ...base, skipSampled: false })).toBe(true);
		expect(shouldSync('sampled', { ...base, skipSampled: false, inLibrary: false })).toBe(false);
	});

	it('keeps a deliberate library addition that was never played', () => {
		expect(shouldSync('unwatched', base)).toBe(true);
		expect(shouldSync('unwatched', { ...base, includeUnwatchedLibrary: false })).toBe(false);
		expect(shouldSync('unwatched', { ...base, inLibrary: false })).toBe(false);
	});
});

describe('selectRelevant', () => {
	it('excludes a title that was only clicked into', () => {
		expect(selectRelevant([sampledMovie(0.6)], defaults)).toHaveLength(0);
	});

	it('includes it once sampling is allowed', () => {
		expect(selectRelevant([sampledMovie(0.6)], { ...defaults, skipSampledTitles: false })).toHaveLength(1);
	});

	it('still keeps a watched film that was never added to the library', () => {
		expect(selectRelevant([doctorStrange], defaults)).toContain(doctorStrange);
	});

	it('keeps a real partial viewing', () => {
		expect(selectRelevant([sampledMovie(11.5, 88.4)], defaults)).toHaveLength(1);
	});

	it('honours the unwatched-library toggle', () => {
		expect(selectRelevant([lordOfTheRings], defaults)).toHaveLength(1);
		expect(selectRelevant([lordOfTheRings], { ...defaults, includeUnwatchedLibrary: false })).toHaveLength(0);
	});

	it('drops types that are neither movie nor series', () => {
		const channel: LibraryItem = { _id: 'yt:1', name: 'Kanał', type: 'channel', state: {} };
		expect(selectRelevant([channel], defaults)).toHaveLength(0);
	});
});

describe('titleWatchStatus', () => {
	it('routes by type', () => {
		expect(titleWatchStatus(doctorStrange, DEFAULT_THRESHOLDS)).toBe('watched');
		expect(titleWatchStatus(hijack, DEFAULT_THRESHOLDS)).toBe('in-progress');
	});
});
