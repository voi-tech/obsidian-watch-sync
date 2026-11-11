import { z } from 'zod';

/**
 * Stremio's account API is not a published contract. Every response is validated
 * here so a silent shape change surfaces as a readable error instead of quietly
 * corrupting notes.
 */

export const libraryItemStateSchema = z.object({
	lastWatched: z.string().nullable().optional(),
	timeWatched: z.number().optional(),
	timeOffset: z.number().optional(),
	overallTimeWatched: z.number().optional(),
	timesWatched: z.number().optional(),
	flaggedWatched: z.number().optional(),
	duration: z.number().optional(),
	video_id: z.string().nullable().optional(),
	watched: z.string().nullable().optional(),
	noNotif: z.boolean().optional(),
});

export const libraryItemSchema = z.object({
	_id: z.string(),
	name: z.string(),
	type: z.string(),
	poster: z.string().nullable().optional(),
	posterShape: z.string().nullable().optional(),
	removed: z.boolean().optional(),
	temp: z.boolean().optional(),
	_ctime: z.string().optional(),
	_mtime: z.string().optional(),
	state: libraryItemStateSchema.default({}),
});

export const datastoreGetSchema = z.object({
	result: z.array(libraryItemSchema).nullable(),
});

export const datastoreMetaSchema = z.object({
	// [id, mtime] tuples
	result: z.array(z.tuple([z.string(), z.string()])).nullable(),
});

/** Stremio returns HTTP 200 with an `error` body on auth failures. */
export const apiErrorSchema = z.object({
	error: z.object({
		message: z.string().optional(),
		code: z.number().optional(),
	}),
});

export type LibraryItem = z.infer<typeof libraryItemSchema>;
export type LibraryItemState = z.infer<typeof libraryItemStateSchema>;

// --- Cinemeta -------------------------------------------------------------

export const cinemetaVideoSchema = z.object({
	id: z.string(),
	season: z.number().optional(),
	episode: z.number().optional(),
	number: z.number().optional(),
	name: z.string().optional(),
	title: z.string().optional(),
	released: z.string().optional(),
	firstAired: z.string().optional(),
	overview: z.string().optional(),
	description: z.string().optional(),
});

export const cinemetaMetaSchema = z.object({
	id: z.string(),
	imdb_id: z.string().optional(),
	type: z.string(),
	name: z.string(),
	description: z.string().optional(),
	poster: z.string().optional(),
	background: z.string().optional(),
	genre: z.array(z.string()).optional(),
	genres: z.array(z.string()).optional(),
	cast: z.array(z.string()).optional(),
	director: z.array(z.string()).optional(),
	runtime: z.string().optional(),
	year: z.string().optional(),
	releaseInfo: z.string().optional(),
	released: z.string().optional(),
	imdbRating: z.string().optional(),
	videos: z.array(cinemetaVideoSchema).optional(),
});

export const cinemetaResponseSchema = z.object({ meta: cinemetaMetaSchema });

export type CinemetaMeta = z.infer<typeof cinemetaMetaSchema>;
export type CinemetaVideo = z.infer<typeof cinemetaVideoSchema>;

// --- TMDB -----------------------------------------------------------------

const tmdbCreditsSchema = z
	.object({
		cast: z.array(z.object({ name: z.string() })).optional(),
		crew: z.array(z.object({ name: z.string(), job: z.string().optional() })).optional(),
	})
	.optional();

export const tmdbMovieSchema = z.object({
	id: z.number(),
	imdb_id: z.string().nullable().optional(),
	title: z.string(),
	original_title: z.string().optional(),
	overview: z.string().nullable().optional(),
	poster_path: z.string().nullable().optional(),
	backdrop_path: z.string().nullable().optional(),
	release_date: z.string().optional(),
	runtime: z.number().nullable().optional(),
	genres: z.array(z.object({ name: z.string() })).optional(),
	credits: tmdbCreditsSchema,
});

export const tmdbSeriesSchema = z.object({
	id: z.number(),
	name: z.string(),
	original_name: z.string().optional(),
	overview: z.string().nullable().optional(),
	poster_path: z.string().nullable().optional(),
	backdrop_path: z.string().nullable().optional(),
	first_air_date: z.string().optional(),
	last_air_date: z.string().optional(),
	episode_run_time: z.array(z.number()).optional(),
	number_of_episodes: z.number().optional(),
	genres: z.array(z.object({ name: z.string() })).optional(),
	credits: tmdbCreditsSchema,
	external_ids: z.object({ imdb_id: z.string().nullable().optional() }).optional(),
	seasons: z
		.array(
			z.object({
				season_number: z.number(),
				name: z.string().optional(),
				episode_count: z.number().optional(),
			}),
		)
		.optional(),
});

export const tmdbSeasonSchema = z.object({
	season_number: z.number(),
	name: z.string().optional(),
	episodes: z
		.array(
			z.object({
				episode_number: z.number(),
				season_number: z.number(),
				name: z.string().optional(),
				overview: z.string().nullable().optional(),
				air_date: z.string().nullable().optional(),
				runtime: z.number().nullable().optional(),
			}),
		)
		.default([]),
});

export const tmdbFindSchema = z.object({
	movie_results: z.array(tmdbMovieSchema.partial({ title: true }).loose()).default([]),
	tv_results: z.array(tmdbSeriesSchema.partial({ name: true }).loose()).default([]),
});

export type TmdbMovie = z.infer<typeof tmdbMovieSchema>;
export type TmdbSeries = z.infer<typeof tmdbSeriesSchema>;
export type TmdbSeason = z.infer<typeof tmdbSeasonSchema>;
