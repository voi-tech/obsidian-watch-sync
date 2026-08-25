/**
 * Documentation for everything a template can use. Kept next to the renderer and
 * checked against the real template context by a test that renders every entry
 * for both a movie and a series, so the settings reference cannot drift away
 * from what actually resolves.
 */

import { MANAGED_END, MANAGED_START } from './managed-block';

export interface TemplateField {
	/** What you type, without the braces. */
	name: string;
	/** The value it resolves to. */
	description: string;
	example?: string;
	/** Plain-language data shape shown next to the token. */
	kind?: 'text' | 'number' | 'date' | 'link' | 'boolean' | 'list' | 'checkboxes';
}

export interface FieldGroup {
	title: string;
	fields: TemplateField[];
}

/** The only template keys shown in settings. They are provider-neutral and stable. */
export const TEMPLATE_TOKEN_GROUPS: FieldGroup[] = [
	{ title: 'Media', fields: [
		{ name: 'title', description: 'Display title.', example: 'Severance', kind: 'text' },
		{ name: 'original', description: 'Original-language title.', example: 'Severance', kind: 'text' },
		{ name: 'source', description: 'Item id from the selected service.', example: 'tt11280740', kind: 'text' },
		{ name: 'provider', description: 'Selected service.', example: 'nuvio', kind: 'text' },
		{ name: 'kind', description: 'movie or series.', example: 'series', kind: 'text' },
		{ name: 'year', description: 'Release or first-air year.', example: '2022', kind: 'number' },
		{ name: 'years', description: 'Start–end year range.', example: '2022-2025', kind: 'text' },
		{ name: 'released', description: 'Premiere date.', example: '2022-02-18', kind: 'date' },
		{ name: 'description', description: 'Synopsis.', example: 'A workplace mystery.', kind: 'text' },
		{ name: 'duration', description: 'Runtime in minutes.', example: '927', kind: 'number' },
		{ name: 'genres', description: 'Genre names.', example: 'Drama, Thriller', kind: 'list' },
		{ name: 'cast', description: 'Leading cast.', example: 'Adam Scott, Britt Lower', kind: 'list' },
		{ name: 'director', description: 'Director when known.', example: 'Ben Stiller', kind: 'text' },
		{ name: 'cover', description: 'Poster image URL.', kind: 'link' },
		{ name: 'backdrop', description: 'Wide background image URL.', kind: 'link' },
	] },
	{ title: 'Links and watching', fields: [
		{ name: 'link', description: 'Open this title in its source app.', kind: 'link' },
		{ name: 'resume', description: 'Open the current episode when available.', kind: 'link' },
		{ name: 'imdb', description: 'IMDb page when known.', kind: 'link' },
		{ name: 'status', description: 'watched, in-progress, sampled, or unwatched.', example: 'watched', kind: 'text' },
		{ name: 'progress', description: 'Whole progress percentage.', example: '53', kind: 'number' },
		{ name: 'finished', description: 'Whether the title is finished.', example: 'true', kind: 'boolean' },
		{ name: 'watched', description: 'Latest watch date.', example: '2026-08-25', kind: 'date' },
	] },
	{ title: 'Episodes', fields: [
		{ name: 'episodes', description: 'Known episode count; zero for movies.', example: '15', kind: 'number' },
		{ name: 'current', description: 'Current episode label.', example: 'S02E08', kind: 'text' },
		{ name: 'seasons', description: 'Season checklist sections.', kind: 'checkboxes' },
	] },
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
		syntax: '{{pad episodes}}',
		description: 'Pads any number to two digits: 8 becomes 08. Empty stays empty.',
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
		syntax: `${MANAGED_START} … ${MANAGED_END}`,
		description: 'Managed block. Only its contents are refreshed on later syncs.',
	},
];

/** Every documented field name, for the drift test. */
export function documentedFieldNames(): string[] {
	return TEMPLATE_TOKEN_GROUPS.flatMap((group) => group.fields.map((field) => field.name));
}
