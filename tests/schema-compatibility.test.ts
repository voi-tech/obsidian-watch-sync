import { describe, expect, it } from 'vitest';
import {
	apiErrorSchema,
	cinemetaResponseSchema,
	datastoreGetSchema,
	datastoreMetaSchema,
	libraryItemSchema,
	tmdbFindSchema,
	tmdbMovieSchema,
	tmdbSeasonSchema,
	tmdbSeriesSchema,
} from '../src/model/schema';

/** Contracts that must survive the Zod major-version migration. */
describe('schema compatibility', () => {
	it('preserves optional and nullable library fields while stripping unknown keys', () => {
		expect(libraryItemSchema.parse({
			_id: 'tt1', name: 'X', type: 'movie', poster: null, extra: 'ignored',
			state: { lastWatched: null, video_id: null, watched: null, extra: 'ignored' },
		})).toEqual({
			_id: 'tt1', name: 'X', type: 'movie', poster: null,
			state: { lastWatched: null, video_id: null, watched: null },
		});
	});

	it('keeps omitted state distinct from explicit null', () => {
		const item = { _id: 'tt1', name: 'X', type: 'movie' };
		expect(libraryItemSchema.parse(item).state).toEqual({});
		expect(libraryItemSchema.safeParse({ ...item, state: null }).success).toBe(false);
	});

	it('validates every array entry and preserves metadata tuples', () => {
		expect(datastoreGetSchema.parse({ result: [] })).toEqual({ result: [] });
		expect(datastoreGetSchema.safeParse({ result: [{ _id: 'tt1' }] }).success).toBe(false);
		expect(datastoreMetaSchema.parse({ result: [['tt1', '2026-01-01']] }).result).toEqual([['tt1', '2026-01-01']]);
		expect(datastoreMetaSchema.safeParse({ result: [['tt1', 123]] }).success).toBe(false);
		expect(datastoreMetaSchema.parse({ result: null }).result).toBeNull();
	});

	it('does not coerce malformed auth errors or metadata', () => {
		expect(apiErrorSchema.parse({ error: {} })).toEqual({ error: {} });
		expect(apiErrorSchema.safeParse({ error: { code: '1' } }).success).toBe(false);
		const meta = { id: 'tt1', type: 'series', name: 'X', videos: [{ id: 'tt1:1:1', season: 1, episode: 1 }] };
		expect(cinemetaResponseSchema.parse({ meta })).toEqual({ meta });
		expect(cinemetaResponseSchema.safeParse({ meta: { ...meta, videos: [null] } }).success).toBe(false);
	});

	it('preserves TMDB defaults, optional fields and passthrough find results', () => {
		expect(tmdbMovieSchema.parse({ id: 1, title: 'X', runtime: null })).toEqual({ id: 1, title: 'X', runtime: null });
		expect(tmdbSeriesSchema.parse({ id: 2, name: 'Y', external_ids: { imdb_id: null } })).toEqual({ id: 2, name: 'Y', external_ids: { imdb_id: null } });
		expect(tmdbSeasonSchema.parse({ season_number: 1 })).toEqual({ season_number: 1, episodes: [] });
		expect(tmdbSeasonSchema.safeParse({ season_number: 1, episodes: null }).success).toBe(false);
		expect(tmdbFindSchema.parse({})).toEqual({ movie_results: [], tv_results: [] });
		expect(tmdbFindSchema.parse({ movie_results: [{ id: 1, media_type: 'movie' }], tv_results: [{ id: 2, media_type: 'tv' }] })).toEqual({
			movie_results: [{ id: 1, media_type: 'movie' }], tv_results: [{ id: 2, media_type: 'tv' }],
		});
	});
});
