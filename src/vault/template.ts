import Handlebars from 'handlebars';
import type { NormalizedMedia, Season } from '../model/types';
import { renderSeasons } from './episodes';

/**
 * Templates are Handlebars so users can restructure the note freely. The context
 * is the domain model plus a few precomputed conveniences; nothing here decides
 * what an existing note looks like — templates only ever run when a note is
 * created.
 */

export interface TemplateContext extends NormalizedMedia {
	yearRange: string;
	genresText: string;
	castText: string;
	seasonsMarkdown: string;
	episodeCount: number;
	watchedCount: number;
	lastEpisodeLabel?: string;
}

const engine = Handlebars.create();

engine.registerHelper('join', (value: unknown, separator: unknown) =>
	Array.isArray(value) ? value.join(typeof separator === 'string' ? separator : ', ') : '',
);
// Padding nothing should stay nothing; `00` would look like a real episode.
engine.registerHelper('pad', (value: unknown) =>
	typeof value === 'string' || typeof value === 'number' ? String(value).padStart(2, '0') : '',
);
engine.registerPartial('seasons', '{{{seasonsMarkdown}}}');

export function buildContext(media: NormalizedMedia): TemplateContext {
	const episodes = media.seasons.flatMap((season) => season.episodes);
	return {
		...media,
		seasons: printableSeasons(media.seasons),
		yearRange: formatYearRange(media),
		genresText: media.genres.join(', '),
		castText: media.cast.join(', '),
		seasonsMarkdown: renderSeasons(media.seasons),
		episodeCount: episodes.length,
		watchedCount: episodes.filter((episode) => episode.watched).length,
		lastEpisodeLabel: media.lastEpisode
			? `S${String(media.lastEpisode.season).padStart(2, '0')}E${String(media.lastEpisode.number).padStart(2, '0')}`
			: undefined,
	};
}

/**
 * `{{seasons}}` written on its own used to render `[object Object]`. The array
 * still behaves as an array for `{{#each}}`; it just knows how to print itself,
 * the same way `{{> seasons}}` would.
 */
function printableSeasons(seasons: Season[]): Season[] {
	const copy = [...seasons];
	Object.defineProperty(copy, 'toString', {
		value: () => renderSeasons(copy),
		enumerable: false,
	});
	return copy;
}

/** `2022-2025`, or a single year when start and end coincide or the end is unknown. */
export function formatYearRange(media: NormalizedMedia): string {
	const { yearStart, yearEnd } = media;
	if (!yearStart) return '';
	if (!yearEnd || yearEnd === yearStart) return String(yearStart);
	return `${yearStart}-${yearEnd}`;
}

/**
 * Obsidian's own template syntax uses `{{date:YYYY-MM-DD}}`, which Handlebars
 * cannot parse. The vault's existing templates use it, so it is resolved before
 * compilation rather than being treated as an error.
 */
export function resolveObsidianPlaceholders(template: string, now = new Date()): string {
	return template.replace(/\{\{\s*(date|time)\s*:\s*([^}]+?)\s*\}\}/g, (_match, _kind, format: string) =>
		formatDate(now, format),
	);
}

function formatDate(date: Date, format: string): string {
	const pad = (value: number, length = 2) => String(value).padStart(length, '0');
	return format
		.replace(/YYYY/g, String(date.getFullYear()))
		.replace(/MM/g, pad(date.getMonth() + 1))
		.replace(/DD/g, pad(date.getDate()))
		.replace(/HH/g, pad(date.getHours()))
		.replace(/mm/g, pad(date.getMinutes()))
		.replace(/ss/g, pad(date.getSeconds()));
}

export class TemplateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TemplateError';
	}
}

export function render(template: string, context: TemplateContext): string {
	const prepared = resolveObsidianPlaceholders(template);
	try {
		return engine.compile(prepared, { noEscape: true })(context);
	} catch (error) {
		throw new TemplateError(
			`Could not process the template: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Characters that cannot appear in a file name. `: ` becomes ` - ` because that
 * is what the vault already does — "Alien: Romulus" is stored as
 * "Alien - Romulus (2024)".
 */
export function sanitizeFilename(name: string): string {
	return name
		.replace(/:\s+/g, ' - ')
		.replace(/:/g, '-')
		.replace(/[/\\]/g, '-')
		.replace(/[*?"<>|#^[\]]/g, '')
		.replace(/\s{2,}/g, ' ')
		.replace(/^\.+/, '')
		.trim();
}

export function renderFilename(pattern: string, context: TemplateContext): string {
	const raw = render(pattern, context).trim();
	const sanitized = sanitizeFilename(raw);
	return sanitized || sanitizeFilename(context.title) || context.id;
}

export const BUILTIN_MOVIE_TEMPLATE = `# {{title}} ({{year}})

{{#if description}}> [!tldr]- Description
> {{description}}

{{/if}}{{#if stremioAppUrl}}[Open in Stremio]({{stremioAppUrl}})
{{/if}}`;

export const BUILTIN_SERIES_TEMPLATE = `# {{title}} ({{yearRange}})

{{#if description}}> [!tldr]- Description
> {{description}}

{{/if}}{{#if stremioAppUrl}}[Open in Stremio]({{stremioAppUrl}})

{{/if}}{{> seasons}}
`;
