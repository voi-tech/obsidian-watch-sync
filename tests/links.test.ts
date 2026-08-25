import { describe, expect, it } from 'vitest';
import {
	appEpisodeUrl,
	appUrl,
	imdbUrl,
	parseVideoId,
	parseWebUrl,
	nuvioSourceUrl,
	webEpisodeUrl,
	webUrl,
} from '../src/stremio/links';

describe('links', () => {
	// Stremio routes `/detail/:type/:id/:videoId?`. A third segment is read as a
	// video id, so repeating the item id there opens an episode-shaped page
	// instead of the show.
	it('links a title with two segments, not three', () => {
		expect(webUrl('series', 'tt19854762')).toBe('https://web.stremio.com/#/detail/series/tt19854762');
		expect(appUrl('series', 'tt19854762')).toBe('stremio:///detail/series/tt19854762');
	});

	it('adds a third segment only for an actual episode', () => {
		expect(webEpisodeUrl('series', 'tt19854762', 'tt19854762:2:8')).toBe(
			'https://web.stremio.com/#/detail/series/tt19854762/tt19854762%3A2%3A8',
		);
		expect(appEpisodeUrl('series', 'tt19854762', 'tt19854762:2:8')).toBe(
			'stremio:///detail/series/tt19854762/tt19854762%3A2%3A8',
		);
	});

	it('escapes the colon in tmdb ids', () => {
		expect(webUrl('movie', 'tmdb:31011')).toBe('https://web.stremio.com/#/detail/movie/tmdb%3A31011');
	});

	it('round-trips through parseWebUrl', () => {
		for (const id of ['tt19854762', 'tmdb:31011']) {
			expect(parseWebUrl(webUrl('movie', id))).toEqual({ type: 'movie', id });
		}
	});

	it('still parses the doubled links written before the fix', () => {
		// Notes synced by an earlier version carry `…/tt19854762/tt19854762`; they
		// must keep matching, or every one of them would be treated as unclaimed.
		expect(parseWebUrl('https://web.stremio.com/#/detail/series/tt19854762/tt19854762')).toEqual({
			type: 'series',
			id: 'tt19854762',
		});
		expect(parseWebUrl('https://web.stremio.com/#/detail/movie/tmdb%3A31011/tmdb%3A31011')).toEqual({
			type: 'movie',
			id: 'tmdb:31011',
		});
	});

	it('parses an episode link back to the title', () => {
		expect(parseWebUrl(webEpisodeUrl('series', 'tt19854762', 'tt19854762:2:8'))).toEqual({
			type: 'series',
			id: 'tt19854762',
		});
	});

	it('ignores unrelated source values', () => {
		expect(parseWebUrl('https://www.imdb.com/title/tt0167260/')).toBeNull();
	});

	it('builds Nuvio deep links for movies and series', () => {
		expect(nuvioSourceUrl('movie', 'tt0167260')).toBe('nuvio://meta?type=movie&id=tt0167260');
		expect(nuvioSourceUrl('series', 'provider:show/1')).toBe('nuvio://meta?type=series&id=provider%3Ashow%2F1');
	});

	it('parses Nuvio deep links and preserves legacy Nuvio sources', () => {
		expect(parseWebUrl('nuvio://meta?type=series&id=provider%3Ashow%2F1')).toEqual({
			type: 'series',
			id: 'nuvio:provider:show/1',
		});
		expect(parseWebUrl('nuvio://content/legacy%3A1')).toEqual({ type: 'movie', id: 'nuvio:legacy:1' });
	});

	it('round-trips a Nuvio source link back to the media id it was written from', () => {
		// Without the namespace the source tier missed every Nuvio note, and a sync
		// on a vault with no local index created a duplicate instead of matching.
		expect(parseWebUrl(nuvioSourceUrl('movie', 'tt0167260'))?.id).toBe('nuvio:tt0167260');
	});

	it('parses season and episode out of a video id', () => {
		expect(parseVideoId('tt19854762:2:8')).toEqual({ season: 2, episode: 8 });
	});

	it('returns null for a movie video id', () => {
		expect(parseVideoId('tt9419884')).toBeNull();
	});

	it('builds an imdb url only when the id is known', () => {
		expect(imdbUrl('tt0167260')).toBe('https://www.imdb.com/title/tt0167260/');
		expect(imdbUrl(undefined)).toBeUndefined();
	});
});
