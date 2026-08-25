import Handlebars from 'handlebars';
import type { NormalizedMedia, Season } from '../model/types';
import { renderSeasons } from './episodes';
import { t } from '../i18n';

/**
 * Templates are Handlebars so users can restructure the note freely. The context
 * is the domain model plus a few precomputed conveniences; nothing here decides
 * what an existing note looks like — templates only ever run when a note is
 * created.
 */

export interface TemplateContext {
	/** The complete, flat public template surface shown in Settings → Template keys. */
	title: string;
	source: string;
	original?: string;
	year?: number;
	years: string;
	released?: string;
	description?: string;
	duration?: number;
	genres: string[];
	cast: string[];
	director?: string;
	provider: 'stremio' | 'nuvio';
	kind: NormalizedMedia['type'];
	link?: string;
	resume?: string;
	imdb?: string;
	status: NormalizedMedia['watchStatus'];
	progress: number;
	finished: boolean;
	watched?: string;
	episodes: number;
	current?: string;
	seasons: Season[];
	cover?: string;
	backdrop?: string;
	seasonsMarkdown: string;
	/** Legacy aliases retained so existing vault templates and file-name patterns do not break. */
	yearStart?: number;
	yearEnd?: number;
	yearRange: string;
	genresText: string;
	castText: string;
	watchStatus: NormalizedMedia['watchStatus'];
	progressPercent: number;
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
	const seasons = printableSeasons(media.seasons);
	const yearRange = formatYearRange(media);
	const currentLabel = media.lastEpisode
		? `S${String(media.lastEpisode.season).padStart(2, '0')}E${String(media.lastEpisode.number).padStart(2, '0')}`
		: undefined;
	return {
		title: media.title,
		source: media.id.replace(/^nuvio:/, ''),
		original: media.originalTitle,
		year: media.year,
		years: yearRange,
		released: media.releaseDate,
		description: media.description,
		duration: media.durationMinutes,
		genres: media.genres,
		cast: media.cast,
		director: media.director,
		provider: media.id.startsWith('nuvio:') ? 'nuvio' : 'stremio',
		kind: media.type,
		link: media.stremioUrl || media.stremioAppUrl || undefined,
		resume: media.stremioEpisodeUrl,
		imdb: media.imdbUrl,
		status: media.watchStatus,
		progress: media.progressPercent,
		finished: media.finished,
		watched: media.lastWatched,
		episodes: episodes.length,
		current: currentLabel,
		seasons,
		cover: media.cover,
		backdrop: media.backdrop,
		seasonsMarkdown: renderSeasons(media.seasons),
		yearStart: media.yearStart,
		yearEnd: media.yearEnd,
		yearRange,
		genresText: media.genres.join(', '),
		castText: media.cast.join(', '),
		watchStatus: media.watchStatus,
		progressPercent: media.progressPercent,
		episodeCount: episodes.length,
		watchedCount: episodes.filter((episode) => episode.watched).length,
		lastEpisodeLabel: currentLabel,
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
				t('template.process', { error: error instanceof Error ? error.message : String(error) }),
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
	return sanitized || sanitizeFilename(context.title) || context.source;
}

export const BUILTIN_MOVIE_TEMPLATE = `# {{title}} ({{year}})

{{#if description}}> [!tldr]- Description
> {{description}}

{{/if}}{{#if link}}[Open item]({{link}})
{{/if}}`;

export const BUILTIN_SERIES_TEMPLATE = `# {{title}} ({{years}})

{{#if description}}> [!tldr]- Description
> {{description}}

{{/if}}{{#if link}}[Open item]({{link}})

{{/if}}{{> seasons}}
`;
