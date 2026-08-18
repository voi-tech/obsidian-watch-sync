import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cinemetaMetaSchema } from '../src/model/schema';
import { orderedVideos, parseReleaseInfo, parseRuntimeMinutes, episodeNumber } from '../src/meta/cinemeta';
import {
	decodeSeriesProgress,
	movieProgressPercent,
	seriesProgressPercent,
	type EpisodeInput,
} from '../src/stremio/progress';
import { doctorStrange, hijack, lordOfTheRings } from './fixtures/library';
import hijackCinemetaRaw from './fixtures/cinemeta-hijack.json';

const hijackMeta = cinemetaMetaSchema.parse(hijackCinemetaRaw);

function hijackEpisodes(): EpisodeInput[] {
	return orderedVideos(hijackMeta).map((video) => ({
		season: video.season ?? 0,
		number: episodeNumber(video) ?? 0,
		videoId: video.id,
		title: video.name,
		airDate: (video.released ?? video.firstAired ?? '').slice(0, 10) || undefined,
	}));
}

describe('cinemeta ordering', () => {
	it('produces the 15 episodes the bitfield was indexed against', () => {
		const episodes = hijackEpisodes();
		expect(episodes).toHaveLength(15);
		expect(episodes[0].videoId).toBe('tt19854762:1:1');
		expect(episodes[6].videoId).toBe('tt19854762:1:7');
		expect(episodes[7].videoId).toBe('tt19854762:2:1');
		expect(episodes[14].videoId).toBe('tt19854762:2:8');
	});

	it('drops specials, which are not part of the bitfield index', () => {
		const withSpecial = cinemetaMetaSchema.parse({
			...hijackCinemetaRaw,
			videos: [{ id: 'tt19854762:0:1', season: 0, number: 1, name: 'Special' }, ...hijackMeta.videos!],
		});
		expect(orderedVideos(withSpecial)).toHaveLength(15);
	});

	it('parses runtime and release info', () => {
		expect(parseRuntimeMinutes(hijackMeta.runtime)).toBe(47);
		expect(parseReleaseInfo('2023–')).toEqual({ start: 2023, end: undefined });
		expect(parseReleaseInfo('2022-2025')).toEqual({ start: 2022, end: 2025 });
		expect(parseReleaseInfo(undefined)).toEqual({});
	});
});

describe('decodeSeriesProgress', () => {
	it('decodes a real Stremio field without the Node-only bitfield package', () => {
		const { episodes, consistent } = decodeSeriesProgress(hijack.state, hijackEpisodes());
		expect(consistent).toBe(true);
		expect(episodes.filter((episode) => episode.watched).map((episode) => episode.videoId)).toEqual([
			'tt19854762:2:1',
			'tt19854762:2:2',
			'tt19854762:2:3',
			'tt19854762:2:4',
			'tt19854762:2:5',
			'tt19854762:2:6',
			'tt19854762:2:7',
			'tt19854762:2:8',
		]);

		const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
			dependencies?: Record<string, string>;
		};
		expect(packageJson.dependencies?.['stremio-watched-bitfield']).toBeUndefined();
	});

	it('decodes the real Hijack bitfield: season 2 watched, season 1 not', () => {
		const { episodes, consistent } = decodeSeriesProgress(hijack.state, hijackEpisodes());
		expect(consistent).toBe(true);
		expect(episodes.filter((episode) => episode.season === 1).every((episode) => !episode.watched)).toBe(true);
		expect(episodes.filter((episode) => episode.season === 2).every((episode) => episode.watched)).toBe(true);
	});

	it('marks the episode Stremio reports as current', () => {
		const { episodes } = decodeSeriesProgress(hijack.state, hijackEpisodes());
		expect(episodes.filter((episode) => episode.current).map((episode) => episode.videoId)).toEqual([
			'tt19854762:2:8',
		]);
	});

	it('returns everything unwatched when the field is absent', () => {
		const { episodes, consistent } = decodeSeriesProgress({}, hijackEpisodes());
		expect(consistent).toBe(true);
		expect(episodes.every((episode) => !episode.watched)).toBe(true);
	});

	it('self-corrects when the episode list starts later than at serialization', () => {
		// `constructAndResize` shifts the field, so dropping season 1 still lands
		// season 2 on the right episodes — this must not be reported as a mismatch.
		const shifted = hijackEpisodes().filter((episode) => episode.season === 2);
		const { consistent, episodes } = decodeSeriesProgress(hijack.state, shifted);
		expect(consistent).toBe(true);
		expect(episodes.every((episode) => episode.watched)).toBe(true);
	});

	it('flags a current episode missing from the metadata', () => {
		const truncated = hijackEpisodes().slice(0, 10);
		const { consistent, reason } = decodeSeriesProgress(hijack.state, truncated);
		expect(consistent).toBe(false);
		expect(reason).toContain('tt19854762:2:8');
	});

	it('flags an empty field that contradicts a non-zero timesWatched', () => {
		const episodes = hijackEpisodes();
		const emptyField = { ...hijack.state, watched: 'tt19854762:2:8:15:eJxjYAAAAAIAAQ==' };
		const { consistent, reason } = decodeSeriesProgress(emptyField, episodes);
		expect(consistent).toBe(false);
		expect(reason).toMatch(/bitfield is empty/);
	});

	it('does not flag a partially played episode with no watched history', () => {
		const episodes = hijackEpisodes();
		const state = { timeOffset: 500_000, duration: 2_800_000, video_id: 'tt19854762:1:3', timesWatched: 0 };
		const { consistent } = decodeSeriesProgress(state, episodes);
		expect(consistent).toBe(true);
	});

	it('survives a malformed watched field', () => {
		const { consistent, episodes } = decodeSeriesProgress(
			{ ...hijack.state, watched: 'nonsense' },
			hijackEpisodes(),
		);
		expect(consistent).toBe(false);
		expect(episodes.every((episode) => !episode.watched)).toBe(true);
	});
});

describe('progress percentages', () => {
	it('reports a flagged movie as fully watched', () => {
		expect(movieProgressPercent(doctorStrange.state)).toBe(100);
	});

	it('reports an untouched movie as zero', () => {
		expect(movieProgressPercent(lordOfTheRings.state)).toBe(0);
	});

	it('derives a partial percentage from timeOffset', () => {
		expect(movieProgressPercent({ timeOffset: 3_000_000, duration: 6_000_000 })).toBe(50);
	});

	it('guards against a zero duration', () => {
		expect(movieProgressPercent({ timeOffset: 1000, duration: 0 })).toBe(0);
	});

	it('counts watched episodes for a series', () => {
		const { episodes } = decodeSeriesProgress(hijack.state, hijackEpisodes());
		expect(seriesProgressPercent(episodes)).toBe(53); // 8 z 15
	});
});
