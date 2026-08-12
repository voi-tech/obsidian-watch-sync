/**
 * Documentation for everything a template can use. Kept next to the renderer and
 * checked against the real template context by a test that renders every entry
 * for both a movie and a series, so the settings reference cannot drift away
 * from what actually resolves.
 */

export interface TemplateField {
	/** What you type, without the braces. */
	name: string;
	/** The value it resolves to. */
	description: string;
	example?: string;
}

export interface FieldGroup {
	title: string;
	fields: TemplateField[];
}

export const TEMPLATE_FIELD_GROUPS: FieldGroup[] = [
	{
		title: 'Identity',
		fields: [
			{ name: 'title', description: 'Display title, from TMDB when available.', example: 'Severance' },
			{
				name: 'originalTitle',
				description: 'Title in the original language. TMDB only, often the same as the title.',
				example: 'Severance',
			},
			{ name: 'type', description: 'Either movie or series.', example: 'series' },
			{ name: 'id', description: 'Stremio library id.', example: 'tt11280740' },
			{ name: 'imdbId', description: 'IMDb id, when one is known.', example: 'tt11280740' },
			{ name: 'tmdbId', description: 'Numeric TMDB id, when one is known.', example: '95396' },
		],
	},
	{
		title: 'Dates',
		fields: [
			{
				name: 'year',
				description: 'Release year for a movie, first air year for a series.',
				example: '2022',
			},
			{ name: 'yearStart', description: 'First year. Same as the year for a movie.', example: '2022' },
			{ name: 'yearEnd', description: 'Last year so far. Same as the year for a movie.', example: '2025' },
			{
				name: 'yearRange',
				description: 'yearStart-yearEnd, collapsed to one year when they match.',
				example: '2022-2025',
			},
			{
				name: 'releaseDate',
				description: 'Premiere date. First air date for a series.',
				example: '2022-02-18',
			},
		],
	},
	{
		title: 'Text and images',
		fields: [
			{ name: 'description', description: 'Synopsis, in the configured language.' },
			{
				name: 'cover',
				description: 'Poster URL, 2:3. Also written to the poster property.',
				example: 'https://image.tmdb.org/t/p/original//abc.jpg',
			},
			{ name: 'backdrop', description: 'Wide still, 16:9. Not written to any property.' },
		],
	},
	{
		title: 'Facts',
		fields: [
			{
				name: 'durationMinutes',
				description: 'Runtime in minutes; for a series the total across all episodes.',
				example: '927',
			},
			{ name: 'genresText', description: 'Genres, comma separated.', example: 'Drama, Thriller' },
			{ name: 'castText', description: 'Leading cast, comma separated.', example: 'Adam Scott, Britt Lower' },
			{
				name: 'genres',
				description: 'The same genres as a list, for {{#each}} or the join helper.',
				example: 'Drama,Thriller',
			},
			{ name: 'cast', description: 'Up to five leading actors, as a list.' },
			{ name: 'director', description: 'Director, when TMDB or Cinemeta reports one.' },
		],
	},
	{
		title: 'Links',
		fields: [
			{
				name: 'stremioUrl',
				description: 'The title on web.stremio.com. Also written to the link property.',
			},
			{ name: 'stremioAppUrl', description: 'The title, opened in the Stremio app.' },
			{
				name: 'stremioEpisodeUrl',
				description: 'The episode you are on, opened in the app. Series only; empty for a movie.',
			},
			{ name: 'imdbUrl', description: 'IMDb page, when the IMDb id is known.' },
		],
	},
	{
		title: 'Watching',
		fields: [
			{
				name: 'lastWatched',
				description: 'Date Stremio last played it, whether or not it was finished.',
				example: '2025-03-21',
			},
			{
				name: 'watchStatus',
				description: 'One of watched, in-progress, sampled, unwatched.',
				example: 'watched',
			},
			{ name: 'finished', description: 'true or false. Meant for {{#if finished}}.', example: 'true' },
			{ name: 'progressPercent', description: 'Whole percent, 0–100.', example: '53' },
		],
	},
	{
		title: 'Episodes',
		fields: [
			{
				name: 'episodeCount',
				description: 'Known episodes. Zero for a movie.',
				example: '15',
			},
			{ name: 'watchedCount', description: 'How many of them are watched.', example: '8' },
			{
				name: 'lastEpisodeLabel',
				description: 'The episode Stremio has you on. Empty for a movie.',
				example: 'S02E08',
			},
			{
				name: 'lastEpisode.title',
				description: 'Its title. Also .season, .number, .videoId and .airDate.',
			},
			{
				name: 'seasons',
				description:
					'Printed on its own it renders the full season sections, exactly like the seasons partial. Use it with {{#each}} to lay the episodes out yourself.',
			},
		],
	},
];

export interface TemplateSnippet {
	syntax: string;
	description: string;
}

export const TEMPLATE_SNIPPETS: TemplateSnippet[] = [
	{
		syntax: '{{> seasons}}',
		description: 'Season sections with their episode checklists.',
	},
	{
		syntax: '{{join genres " · "}}',
		description: 'Joins any list with a separator of your choice.',
	},
	{
		syntax: '{{pad lastEpisode.number}}',
		description: 'Pads a number to two digits: 8 becomes 08. Empty stays empty.',
	},
	{
		syntax: '{{#if description}}…{{/if}}',
		description: 'Renders the block only when the value is present.',
	},
	{
		syntax: '{{#each seasons}}{{#each episodes}}…{{/each}}{{/each}}',
		description: 'Full manual control over the episode list.',
	},
	{
		syntax: '![poster]({{cover}})',
		description: 'Embeds the poster. Use backdrop for the wide still.',
	},
	{
		syntax: '{{date:YYYY-MM-DD}}',
		description: "Obsidian's own placeholder, resolved to today's date.",
	},
	{
		syntax: '%% stremio %% … %% /stremio %%',
		description: 'Managed block. Only its contents are refreshed on later syncs.',
	},
];

/** Every documented field name, for the drift test. */
export function documentedFieldNames(): string[] {
	return TEMPLATE_FIELD_GROUPS.flatMap((group) => group.fields.map((field) => field.name));
}
