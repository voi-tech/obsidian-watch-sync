import { describe, expect, it, vi } from 'vitest';
import { cinemetaMetaSchema, type CinemetaMeta } from '../src/model/schema';
import { normalize, type MetadataSources } from '../src/meta/normalize';
import type { TmdbClient } from '../src/meta/tmdb';
import { doctorStrange, hijack, lordOfTheRings, mrNobody } from './fixtures/library';
import hijackCinemetaRaw from './fixtures/cinemeta-hijack.json';

const hijackMeta = cinemetaMetaSchema.parse(hijackCinemetaRaw);

const cinemetaOnly = (meta: CinemetaMeta | null = null): MetadataSources => ({
	tmdb: null,
	fetchCinemeta: vi.fn(async () => meta),
});

function fakeTmdb(overrides: Partial<Record<keyof TmdbClient, unknown>>): TmdbClient {
	return {
		findByImdbId: vi.fn(async () => ({})),
		movie: vi.fn(async () => null),
		series: vi.fn(async () => null),
		season: vi.fn(async () => null),
		movieWithDescription: vi.fn(async () => null),
		seriesWithDescription: vi.fn(async () => null),
		...overrides,
	} as unknown as TmdbClient;
}

describe('normalize — movies', () => {
	it('falls back to Cinemeta when TMDB is not configured', async () => {
		const { media } = await normalize(
			doctorStrange,
			cinemetaOnly(
				cinemetaMetaSchema.parse({
					id: 'tt9419884',
					type: 'movie',
					name: 'Doctor Strange in the Multiverse of Madness',
					description: 'Opis z Cinemety',
					poster: 'https://images.metahub.space/poster/small/tt9419884/img',
					runtime: '126 min',
					year: '2022',
					genre: ['Action'],
				}),
			),
		);
		expect(media.description).toBe('Opis z Cinemety');
		expect(media.durationMinutes).toBe(126);
		expect(media.year).toBe(2022);
		expect(media.genres).toEqual(['Action']);
	});

	it('prefers TMDB and builds the vault-native cover url', async () => {
		const tmdb = fakeTmdb({
			findByImdbId: vi.fn(async () => ({ movieId: 453395 })),
			movieWithDescription: vi.fn(async () => ({
				id: 453395,
				title: 'Doktor Strange w multiwersum obłędu',
				original_title: 'Doctor Strange in the Multiverse of Madness',
				overview: 'Polski opis',
				poster_path: '/9Gtg2DzBhmYamXBS1hKAhiwbBnq.jpg',
				backdrop_path: '/gzvArUieChFTfJHhWrHIYWRoeLp.jpg',
				release_date: '2022-05-04',
				runtime: 126,
				genres: [{ name: 'Akcja' }],
				credits: { cast: [{ name: 'Benedict Cumberbatch' }], crew: [{ name: 'Sam Raimi', job: 'Director' }] },
			})),
		});
		const { media } = await normalize(doctorStrange, { tmdb, fetchCinemeta: vi.fn(async () => null) });

		expect(media.title).toBe('Doktor Strange w multiwersum obłędu');
		// Doubled slash is deliberate: it matches the 207 hand-written notes.
		expect(media.cover).toBe('https://image.tmdb.org/t/p/original//9Gtg2DzBhmYamXBS1hKAhiwbBnq.jpg');
		expect(media.director).toBe('Sam Raimi');
		expect(media.cast).toEqual(['Benedict Cumberbatch']);
		expect(media.durationMinutes).toBe(126);
	});

	it('reads the premiere date from TMDB as YYYY-MM-DD', async () => {
		const tmdb = fakeTmdb({
			findByImdbId: vi.fn(async () => ({ movieId: 453395 })),
			movieWithDescription: vi.fn(async () => ({
				id: 453395,
				title: 'Doctor Strange',
				release_date: '2022-05-04',
			})),
		});
		const { media } = await normalize(doctorStrange, { tmdb, fetchCinemeta: vi.fn(async () => null) });
		expect(media.releaseDate).toBe('2022-05-04');
		expect(media.year).toBe(2022);
	});

	it('falls back to the Cinemeta release timestamp', async () => {
		const { media } = await normalize(
			doctorStrange,
			cinemetaOnly(
				cinemetaMetaSchema.parse({
					id: 'tt9419884',
					type: 'movie',
					name: 'Doctor Strange',
					released: '2022-05-04T00:00:00.000Z',
				}),
			),
		);
		expect(media.releaseDate).toBe('2022-05-04');
	});

	it('leaves the premiere date empty when nothing reports one', async () => {
		const { media } = await normalize(lordOfTheRings, cinemetaOnly());
		expect(media.releaseDate).toBeUndefined();
	});

	it('records when a finished movie was last played', async () => {
		const { media } = await normalize(doctorStrange, cinemetaOnly());
		expect(media.finished).toBe(true);
		expect(media.progressPercent).toBe(100);
		expect(media.lastWatched).toBe('2026-01-15');
	});

	it('records the last play even for a title that is not finished', async () => {
		// The date answers "when did I last watch this", not "when did I finish it".
		const { media } = await normalize(lordOfTheRings, cinemetaOnly());
		expect(media.finished).toBe(false);
		expect(media.lastWatched).toBe('2025-12-16');
	});

	it('recovers the imdb id of a tmdb-keyed item from state.video_id', async () => {
		const fetchCinemeta = vi.fn(async () => null);
		const { media } = await normalize(mrNobody, { tmdb: null, fetchCinemeta });
		expect(media.imdbId).toBe('tt0485947');
		expect(media.tmdbId).toBe(31011);
		expect(fetchCinemeta).toHaveBeenCalledWith('movie', 'tt0485947');
		expect(media.stremioUrl).toContain('tmdb%3A31011');
	});
});

describe('normalize — series', () => {
	const sources = (tmdb: TmdbClient | null = null): MetadataSources => ({
		tmdb,
		fetchCinemeta: vi.fn(async () => hijackMeta),
	});

	it('uses the first air date as the premiere date of a series', async () => {
		const tmdb = fakeTmdb({
			findByImdbId: vi.fn(async () => ({ seriesId: 202250 })),
			seriesWithDescription: vi.fn(async () => ({
				id: 202250,
				name: 'Hijack',
				first_air_date: '2023-06-28',
			})),
			season: vi.fn(async () => null),
		});
		const { media } = await normalize(hijack, sources(tmdb));
		expect(media.releaseDate).toBe('2023-06-28');
	});

	it('builds seasons from the Cinemeta ordering', async () => {
		const { media } = await normalize(hijack, sources());
		expect(media.seasons.map((season) => season.number)).toEqual([1, 2]);
		expect(media.seasons[0].episodes).toHaveLength(7);
		expect(media.seasons[1].episodes).toHaveLength(8);
	});

	it('applies the decoded watched state to the right episodes', async () => {
		const { media } = await normalize(hijack, sources());
		expect(media.seasons[0].episodes.every((episode) => !episode.watched)).toBe(true);
		expect(media.seasons[1].episodes.every((episode) => episode.watched)).toBe(true);
		expect(media.lastEpisode?.videoId).toBe('tt19854762:2:8');
		expect(media.progressPercent).toBe(53);
	});

	it('points the main link at the show, not at an episode', async () => {
		const { media } = await normalize(hijack, sources());
		expect(media.stremioUrl).toBe('https://web.stremio.com/#/detail/series/tt19854762');
		expect(media.stremioAppUrl).toBe('stremio:///detail/series/tt19854762');
	});

	it('exposes the current episode as a separate link', async () => {
		const { media } = await normalize(hijack, sources());
		expect(media.stremioEpisodeUrl).toBe('stremio:///detail/series/tt19854762/tt19854762%3A2%3A8');
	});

	it('estimates total runtime from Cinemeta when TMDB is absent', async () => {
		const { media } = await normalize(hijack, sources());
		expect(media.durationMinutes).toBe(47 * 15);
	});

	it('prefers per-episode runtimes from TMDB', async () => {
		const tmdb = fakeTmdb({
			findByImdbId: vi.fn(async () => ({ seriesId: 202250 })),
			seriesWithDescription: vi.fn(async () => ({
				id: 202250,
				name: 'Hijack',
				overview: 'Polski opis',
				first_air_date: '2023-06-28',
				last_air_date: '2026-05-06',
				poster_path: '/abc.jpg',
				genres: [{ name: 'Dramat' }],
			})),
			season: vi.fn(async (_id: number, number: number) => ({
				season_number: number,
				name: `Sezon ${number}`,
				episodes: Array.from({ length: number === 1 ? 7 : 8 }, (_, index) => ({
					episode_number: index + 1,
					season_number: number,
					name: `Odcinek ${index + 1}`,
					air_date: '2023-06-28',
					runtime: 50,
				})),
			})),
		});
		const { media } = await normalize(hijack, sources(tmdb));
		expect(media.durationMinutes).toBe(50 * 15);
		expect(media.seasons[0].episodes[0].title).toBe('Odcinek 1');
		expect(media.yearStart).toBe(2023);
		expect(media.yearEnd).toBe(2026);
		// "Sezon 1" carries no information beyond the number, so it is dropped.
		expect(media.seasons[0].title).toBeUndefined();
	});

	it('keeps a real season subtitle', async () => {
		const tmdb = fakeTmdb({
			findByImdbId: vi.fn(async () => ({ seriesId: 1 })),
			seriesWithDescription: vi.fn(async () => ({ id: 1, name: 'Hijack' })),
			season: vi.fn(async (_id: number, number: number) => ({
				season_number: number,
				name: number === 2 ? 'The Book of Carol' : `Sezon ${number}`,
				episodes: [],
			})),
		});
		const { media } = await normalize(hijack, sources(tmdb));
		expect(media.seasons[1].title).toBe('The Book of Carol');
	});

	it('warns when Cinemeta is unavailable, because the ordering cannot be trusted', async () => {
		const { media, warnings } = await normalize(hijack, {
			tmdb: null,
			fetchCinemeta: vi.fn(async () => null),
		});
		expect(media.seasons).toHaveLength(0);
		expect(warnings.map((warning) => warning.message).join(' ')).toMatch(/Cinemeta/);
	});
});
