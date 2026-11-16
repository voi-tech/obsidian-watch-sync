import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
	cinemetaResponseSchema,
	datastoreGetSchema,
	libraryItemSchema,
	tmdbFindSchema,
	tmdbSeasonSchema,
} from '../src/model/schema';

describe('schema compatibility after the Zod upgrade', () => {
	it('preserves missing state defaults and strips unknown library fields', () => {
		expect(libraryItemSchema.parse({ _id: 'tt1', name: 'Example', type: 'movie', extra: true }))
			.toEqual({ _id: 'tt1', name: 'Example', type: 'movie', state: {} });
	});

	it('preserves nullable values without inventing optional fields', () => {
		expect(datastoreGetSchema.parse({ result: null })).toEqual({ result: null });
		expect(libraryItemSchema.parse({
			_id: 'tt1', name: 'Example', type: 'movie', poster: null,
			state: { lastWatched: null, video_id: null, watched: null },
		})).toEqual({
			_id: 'tt1', name: 'Example', type: 'movie', poster: null,
			state: { lastWatched: null, video_id: null, watched: null },
		});
	});

	it('preserves empty TMDB defaults and passthrough find results', () => {
		expect(tmdbSeasonSchema.parse({ season_number: 1 })).toEqual({ season_number: 1, episodes: [] });
		expect(tmdbFindSchema.parse({})).toEqual({ movie_results: [], tv_results: [] });
		expect(tmdbFindSchema.parse({ movie_results: [{ id: 1, source_field: 'kept' }] }))
			.toEqual({ movie_results: [{ id: 1, source_field: 'kept' }], tv_results: [] });
	});

	it('still rejects malformed nested metadata and library entries', () => {
		expect(cinemetaResponseSchema.safeParse({ meta: {
			id: 'tt1', name: 'Example', type: 'series', videos: [{ id: 1 }],
		} }).success).toBe(false);
		expect(datastoreGetSchema.safeParse({ result: [{ _id: 'tt1' }] }).success).toBe(false);
	});
});

describe('Zod collection security regression', () => {
	it('rejects an oversized constrained array before collecting per-element issues', () => {
		const result = z.array(z.string()).max(2).safeParse(Array.from({ length: 10_000 }, () => null));
		expect(result.success).toBe(false);
		if (result.success) throw new Error('Expected oversized input to fail validation');
		expect(result.error.issues).toHaveLength(1);
		expect(result.error.issues[0]?.code).toBe('too_big');
	});
});
