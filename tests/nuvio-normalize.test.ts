import { describe, expect, it } from 'vitest';
import { applyNuvioEpisodeStates, nuvioLibraryItems } from '../src/nuvio/normalize';
import type { NuvioSnapshot } from '../src/nuvio/api';

const snapshot: NuvioSnapshot = {
	library: [{ content_id: 'tt1', content_type: 'movie', name: 'Arrival', poster: null, description: null, release_info: null, genres: [] }],
	progress: [{ content_id: 'tt1', content_type: 'movie', video_id: 'tt1', position: 60, duration: 120, last_watched: 1 }],
	watched: [{ content_id: 'tt1', content_type: 'movie', watched_at: 2 }],
};

describe('Nuvio import normalization', () => {
	it('unites only the selected read-only data sections', () => {
		const result = nuvioLibraryItems(snapshot, ['progress']);
		expect(result.items).toHaveLength(1);
		expect(result.items[0]?._id).toBe('tt1');
		expect(result.items[0]?.state).toMatchObject({ timeOffset: 60, flaggedWatched: 0 });
	});

	it('normalizes Nuvio millisecond timestamps to a calendar date', () => {
		const result = nuvioLibraryItems(
			{
				...snapshot,
				progress: [{ ...snapshot.progress[0], last_watched: 1_725_000_000_000 }],
				watched: [],
			},
			['progress'],
		);
		expect(result.items[0]?.state.lastWatched).toMatch(/^2024-\d{2}-\d{2}T/);
	});

	it('does not invent a note when Nuvio history lacks library metadata', () => {
		const result = nuvioLibraryItems({ ...snapshot, library: [], progress: [], watched: [{ content_id: 'tt2', content_type: 'movie', watched_at: 1 }] }, ['watchHistory']);
		expect(result.items).toEqual([]);
		expect(result.warnings[0]).toContain('tt2');
	});

	it('keeps watched episodes separate from the current progress episode', () => {
		const result = nuvioLibraryItems(
			{
				library: [{ content_id: 'show-1', content_type: 'series', name: 'Show', poster: null, description: null, release_info: null, genres: [] }],
				progress: [
					{ content_id: 'show-1', content_type: 'series', video_id: 'show-1:1:3', position: 120, duration: 600, last_watched: 30 },
				],
				watched: [
					{ content_id: 'show-1', content_type: 'series', video_id: 'show-1:1:1', watched_at: 10 },
					{ content_id: 'show-1', content_type: 'series', season: 1, episode: 2, watched_at: 20 },
				],
			},
			['watchHistory', 'progress'],
		);

		expect(result.episodeStates).toHaveLength(3);
		expect(result.episodeStates.filter((episode) => episode.watched)).toHaveLength(2);
		expect(result.episodeStates.filter((episode) => episode.current)).toHaveLength(1);
		expect(result.episodeStates.find((episode) => episode.videoId === 'show-1:1:3')).toMatchObject({ current: true, watched: false });
		expect(result.episodeStates.find((episode) => episode.videoId === 'show-1:1:1')).toMatchObject({ current: false, watched: true });
		expect(result.episodeStates.find((episode) => episode.season === 1 && episode.episode === 2)).toMatchObject({ current: false, watched: true });
	});

	it('applies watched and current Nuvio episode states without guessing', () => {
		const imported = nuvioLibraryItems({
			...snapshot,
			library: [{ ...snapshot.library[0], content_id: 'tt-series', content_type: 'series', name: 'Series' }],
			progress: [{ content_id: 'tt-series', content_type: 'series', video_id: 'tt-series:1:3', position: 12, duration: 60, last_watched: 3, season: 1, episode: 3 }],
			watched: [
				{ content_id: 'tt-series', content_type: 'series', video_id: 'tt-series:1:1', watched_at: 1 },
				{ content_id: 'tt-series', content_type: 'series', video_id: 'tt-series:1:2', watched_at: 2 },
			],
		}, ['watchHistory', 'progress']);
		const media = applyNuvioEpisodeStates({
			id: 'nuvio:tt-series', type: 'series', title: 'Series', genres: [], cast: [], watchStatus: 'in-progress', finished: false, progressPercent: 0, stremioUrl: '', stremioAppUrl: '', seasons: [{ number: 1, episodes: [
				{ season: 1, number: 1, videoId: 'tt-series:1:1', watched: false, current: false },
				{ season: 1, number: 2, videoId: 'tt-series:1:2', watched: false, current: false },
				{ season: 1, number: 3, videoId: 'tt-series:1:3', watched: false, current: false },
			] }],
		}, imported.episodeStates);
		expect(media.seasons[0]?.episodes.map((episode) => [episode.watched, episode.current])).toEqual([[true, false], [true, false], [false, true]]);
		expect(media.lastEpisode?.number).toBe(3);
	});
});
