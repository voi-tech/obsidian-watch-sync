import { describe, expect, it } from 'vitest';
import {
	buildContext,
	BUILTIN_MOVIE_TEMPLATE,
	BUILTIN_SERIES_TEMPLATE,
	render,
} from '../src/vault/template';
import {
	documentedFieldNames,
	TEMPLATE_FIELD_GROUPS,
	TEMPLATE_SNIPPETS,
} from '../src/vault/template-reference';
import type { NormalizedMedia } from '../src/model/types';

const movie: NormalizedMedia = {
	id: 'tt0167260',
	imdbId: 'tt0167260',
	tmdbId: 329865,
	type: 'movie',
	title: 'Arrival',
	originalTitle: 'Arrival',
	description: 'Opis',
	cover: 'https://image.tmdb.org/t/p/original//abc.jpg',
	backdrop: 'https://image.tmdb.org/t/p/original//def.jpg',
	durationMinutes: 116,
	genres: ['Drama', 'Sci-Fi'],
	cast: ['Amy Adams', 'Jeremy Renner'],
	director: 'Denis Villeneuve',
	year: 2016,
	yearStart: 2016,
	yearEnd: 2016,
	releaseDate: '2016-11-11',
	lastWatched: '2024-06-21',
	watchStatus: 'watched',
	finished: true,
	progressPercent: 100,
	stremioUrl: 'https://web.stremio.com/#/detail/movie/tt0167260',
	stremioAppUrl: 'stremio:///detail/movie/tt0167260',
	imdbUrl: 'https://www.imdb.com/title/tt0167260/',
	seasons: [],
};

const series: NormalizedMedia = {
	...movie,
	id: 'tt11280740',
	imdbId: 'tt11280740',
	tmdbId: 95396,
	type: 'series',
	title: 'Severance',
	originalTitle: 'Severance',
	yearEnd: 2025,
	stremioUrl: 'https://web.stremio.com/#/detail/series/tt11280740',
	stremioAppUrl: 'stremio:///detail/series/tt11280740',
	stremioEpisodeUrl: 'stremio:///detail/series/tt11280740/tt11280740%3A1%3A2',
	imdbUrl: 'https://www.imdb.com/title/tt11280740/',
	seasons: [
		{
			number: 1,
			episodes: [
				{
					season: 1,
					number: 1,
					videoId: 'tt11280740:1:1',
					title: 'Good News About Hell',
					airDate: '2022-02-18',
					watched: true,
					current: false,
				},
				{
					season: 1,
					number: 2,
					videoId: 'tt11280740:1:2',
					title: 'Half Loop',
					airDate: '2022-02-25',
					watched: false,
					current: true,
				},
			],
		},
	],
	lastEpisode: {
		season: 1,
		number: 2,
		videoId: 'tt11280740:1:2',
		title: 'Half Loop',
		airDate: '2022-02-25',
		watched: false,
		current: true,
	},
};

const movieContext = buildContext(movie);
const seriesContext = buildContext(series);

/** Fields whose value only exists for a series; empty on a movie is correct. */
const SERIES_ONLY = ['lastEpisode.title', 'lastEpisodeLabel', 'seasons', 'stremioEpisodeUrl'];

describe('reference stays in step with the renderer', () => {
	it('documents no field that does not exist', () => {
		const missing = documentedFieldNames().filter((name) => !(name.split('.')[0] in seriesContext));
		expect(missing).toEqual([]);
	});

	it('documents every field the context exposes', () => {
		// `seasonsMarkdown` is what the seasons partial prints and `mtime` is
		// internal bookkeeping; everything else must be listed.
		const internal = new Set(['seasonsMarkdown', 'mtime']);
		const documented = new Set(documentedFieldNames().map((name) => name.split('.')[0]));
		const undocumented = Object.keys(seriesContext).filter(
			(key) => !documented.has(key) && !internal.has(key),
		);
		expect(undocumented).toEqual([]);
	});

	it('has a description for every field and snippet', () => {
		const fields = TEMPLATE_FIELD_GROUPS.flatMap((group) => group.fields);
		expect(fields.filter((field) => !field.description.trim())).toEqual([]);
		expect(TEMPLATE_SNIPPETS.filter((snippet) => !snippet.description.trim())).toEqual([]);
	});

	it('lists no field twice', () => {
		const names = documentedFieldNames();
		expect(new Set(names).size).toBe(names.length);
	});
});

describe('every documented field renders something usable', () => {
	it('resolves for a series', () => {
		const empty = documentedFieldNames().filter((name) => render(`{{${name}}}`, seriesContext) === '');
		expect(empty).toEqual([]);
	});

	it('resolves for a movie, except the series-only ones', () => {
		const empty = documentedFieldNames().filter((name) => render(`{{${name}}}`, movieContext) === '');
		expect(empty.sort()).toEqual(SERIES_ONLY);
	});

	it('never renders an object placeholder', () => {
		for (const context of [movieContext, seriesContext]) {
			for (const name of documentedFieldNames()) {
				expect(render(`{{${name}}}`, context)).not.toContain('[object');
			}
		}
	});
});

describe('field values are what the reference claims', () => {
	const value = (name: string, context = seriesContext) => render(`{{${name}}}`, context);

	it('identifies the title', () => {
		expect(value('title')).toBe('Severance');
		expect(value('type')).toBe('series');
		expect(value('type', movieContext)).toBe('movie');
		expect(value('id')).toBe('tt11280740');
	});

	it('gives a movie the same start and end year as its year', () => {
		// These used to be documented as series-only, which was simply wrong.
		expect(value('yearStart', movieContext)).toBe('2016');
		expect(value('yearEnd', movieContext)).toBe('2016');
		expect(value('yearRange', movieContext)).toBe('2016');
		expect(value('yearRange')).toBe('2016-2025');
	});

	it('formats the premiere date as YYYY-MM-DD', () => {
		expect(value('releaseDate')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('separates the comma-joined lists from the raw ones', () => {
		expect(value('genresText')).toBe('Drama, Sci-Fi');
		expect(value('castText')).toBe('Amy Adams, Jeremy Renner');
		expect(value('genres')).toBe('Drama,Sci-Fi');
	});

	it('reports watch state', () => {
		expect(value('watchStatus')).toBe('watched');
		expect(value('finished')).toBe('true');
		expect(value('progressPercent')).toBe('100');
	});

	it('counts episodes, and reports zero rather than nothing for a movie', () => {
		expect(value('episodeCount')).toBe('2');
		expect(value('watchedCount')).toBe('1');
		expect(value('episodeCount', movieContext)).toBe('0');
	});

	it('labels the current episode', () => {
		expect(value('lastEpisodeLabel')).toBe('S01E02');
		expect(value('lastEpisode.title')).toBe('Half Loop');
	});

	it('prints the season list rather than an object', () => {
		expect(value('seasons')).toContain('### Season 1');
		expect(value('seasons')).toContain('1. [x] Good News About Hell');
		expect(value('seasons')).toBe(render('{{> seasons}}', seriesContext));
	});
});

describe('every documented snippet does what it says', () => {
	it('renders without throwing, for both types', () => {
		for (const context of [movieContext, seriesContext]) {
			for (const snippet of TEMPLATE_SNIPPETS) {
				if (snippet.syntax.startsWith('%%')) continue;
				expect(() => render(snippet.syntax, context)).not.toThrow();
			}
		}
	});

	it('renders the seasons partial as a checklist', () => {
		const output = render('{{> seasons}}', seriesContext);
		expect(output).toContain('### Season 1');
		expect(output).toContain('1. [x] Good News About Hell');
		expect(output).toContain('2. [ ] Half Loop');
	});

	it('joins a list with the given separator', () => {
		expect(render('{{join genres " · "}}', seriesContext)).toBe('Drama · Sci-Fi');
	});

	it('pads a number, and leaves nothing as nothing', () => {
		expect(render('{{pad lastEpisode.number}}', seriesContext)).toBe('02');
		// A movie has no current episode; `00` would read as a real one.
		expect(render('{{pad lastEpisode.number}}', movieContext)).toBe('');
	});

	it('guards a block on a value being present', () => {
		expect(render('{{#if description}}yes{{/if}}', seriesContext)).toBe('yes');
		expect(render('{{#if stremioEpisodeUrl}}yes{{/if}}', movieContext)).toBe('');
	});

	it('walks seasons and episodes by hand', () => {
		const output = render(
			'{{#each seasons}}{{#each episodes}}{{number}}:{{title}} {{/each}}{{/each}}',
			seriesContext,
		);
		expect(output.trim()).toBe('1:Good News About Hell 2:Half Loop');
	});

	it('embeds the poster', () => {
		expect(render('![poster]({{cover}})', seriesContext)).toBe(
			'![poster](https://image.tmdb.org/t/p/original//abc.jpg)',
		);
	});

	it("resolves Obsidian's date placeholder", () => {
		expect(render('{{date:YYYY-MM-DD}}', seriesContext)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});

describe('built-in templates', () => {
	it('render for both types', () => {
		expect(render(BUILTIN_MOVIE_TEMPLATE, movieContext)).toContain('# Arrival (2016)');
		expect(render(BUILTIN_SERIES_TEMPLATE, seriesContext)).toContain('### Season 1');
	});

	it('only use documented fields and helpers', () => {
		const known = new Set([
			...documentedFieldNames().map((name) => name.split('.')[0]),
			'if',
			'each',
			'join',
			'pad',
		]);
		const unknown = [
			...`${BUILTIN_MOVIE_TEMPLATE}${BUILTIN_SERIES_TEMPLATE}`.matchAll(/\{\{[>#/]?\s*([\w.]+)/g),
		]
			.map((match) => match[1].split('.')[0])
			.filter((name) => !known.has(name));
		expect(unknown).toEqual([]);
	});
});
