import { describe, expect, it } from 'vitest';
import {
	buildContext,
	BUILTIN_SERIES_TEMPLATE,
	formatYearRange,
	render,
	renderFilename,
	resolveObsidianPlaceholders,
	sanitizeFilename,
	TemplateError,
} from '../src/vault/template';
import type { NormalizedMedia } from '../src/model/types';

const base: NormalizedMedia = {
	id: 'tt11280740',
	type: 'series',
	title: 'Severance',
	description: 'Opis serialu',
	cover: 'https://image.tmdb.org/t/p/original//abc.jpg',
	durationMinutes: 927,
	genres: ['Dramat', 'Thriller'],
	cast: ['Adam Scott', 'Britt Lower'],
	year: 2022,
	yearStart: 2022,
	yearEnd: 2025,
	releaseDate: '2022-02-18',
	watchStatus: 'watched',
	finished: true,
	progressPercent: 100,
	stremioUrl: 'https://web.stremio.com/#/detail/series/tt11280740/tt11280740',
	stremioAppUrl: 'stremio:///detail/series/tt11280740',
	seasons: [
		{
			number: 1,
			episodes: [
				{ season: 1, number: 1, videoId: 'tt11280740:1:1', title: 'Dobre strony piekła', watched: true, current: false },
				{ season: 1, number: 2, videoId: 'tt11280740:1:2', title: 'Half Loop', watched: false, current: true },
			],
		},
	],
	lastEpisode: {
		season: 1,
		number: 2,
		videoId: 'tt11280740:1:2',
		title: 'Half Loop',
		watched: false,
		current: true,
	},
};

describe('sanitizeFilename', () => {
	it('turns a colon into the separator the vault uses', () => {
		expect(sanitizeFilename('Alien: Romulus')).toBe('Alien - Romulus');
		expect(sanitizeFilename('Greenland 2: Migration')).toBe('Greenland 2 - Migration');
	});

	it('removes characters that break file names or wikilinks', () => {
		expect(sanitizeFilename('A/B\\C*D?E"F<G>H|I#J^K[L]M')).toBe('A-B-CDEFGHIJKLM');
	});

	it('does not produce a hidden file', () => {
		expect(sanitizeFilename('...ukryty')).toBe('ukryty');
	});
});

describe('formatYearRange', () => {
	it('renders a real range', () => {
		expect(formatYearRange(base)).toBe('2022-2025');
	});

	it('collapses a single-year range', () => {
		expect(formatYearRange({ ...base, yearEnd: 2022 })).toBe('2022');
	});

	it('falls back to the start year when the end is unknown', () => {
		expect(formatYearRange({ ...base, yearEnd: undefined })).toBe('2022');
	});

	it('is empty when nothing is known', () => {
		expect(formatYearRange({ ...base, yearStart: undefined, yearEnd: undefined })).toBe('');
	});
});

describe('render', () => {
	it('renders the built-in series template with the season list', () => {
		const output = render(BUILTIN_SERIES_TEMPLATE, buildContext(base));
		expect(output).toContain('# Severance (2022-2025)');
		expect(output).toContain('> [!tldr]- Description');
		expect(output).toContain('### Season 1');
		expect(output).toContain('1. [x] Dobre strony piekła');
		expect(output).toContain('2. [ ] Half Loop');
	});

	it('does not escape markdown or accented characters', () => {
		const output = render('{{title}} — {{description}}', buildContext({ ...base, description: '„cudzysłów" & <znaki>' }));
		expect(output).toBe('Severance — „cudzysłów" & <znaki>');
	});

	it('exposes derived counters', () => {
		const output = render('{{watchedCount}}/{{episodeCount}} {{lastEpisodeLabel}}', buildContext(base));
		expect(output).toBe('1/2 S01E02');
	});

	it('joins lists through the helper', () => {
		expect(render('{{join genres " · "}}', buildContext(base))).toBe('Dramat · Thriller');
		expect(render('{{castText}}', buildContext(base))).toBe('Adam Scott, Britt Lower');
	});

	it('resolves the Obsidian date placeholder used by the vault templates', () => {
		const resolved = resolveObsidianPlaceholders('start: {{date:YYYY-MM-DD}}', new Date('2026-08-01T10:00:00'));
		expect(resolved).toBe('start: 2026-08-01');
	});

	it('renders a vault template that mixes both syntaxes', () => {
		const template = '---\nstart: "{{date:YYYY-MM-DD}}"\n---\n\n# {{title}}\n';
		const output = render(template, buildContext(base));
		expect(output).toContain('# Severance');
		expect(output).toMatch(/start: "\d{4}-\d{2}-\d{2}"/);
	});

	it('reports a broken template instead of throwing something opaque', () => {
		expect(() => render('{{#if}}', buildContext(base))).toThrow(TemplateError);
	});

	it('embeds the poster without mangling the url', () => {
		// Handlebars runs with noEscape, so a URL keeps its slashes instead of
		// turning into &#x2F; entities.
		expect(render('![poster]({{cover}})', buildContext(base))).toBe(
			'![poster](https://image.tmdb.org/t/p/original//abc.jpg)',
		);
	});

	it('supports the Obsidian width syntax on an embedded poster', () => {
		expect(render('![|300]({{cover}})', buildContext(base))).toBe(
			'![|300](https://image.tmdb.org/t/p/original//abc.jpg)',
		);
	});

	it('can guard the embed so a missing poster leaves no broken image', () => {
		const template = '{{#if cover}}![poster]({{cover}}){{/if}}';
		expect(render(template, buildContext({ ...base, cover: undefined }))).toBe('');
	});
});

describe('renderFilename', () => {
	it('applies the configured pattern', () => {
		expect(renderFilename('{{title}} ({{yearStart}}-{{yearEnd}})', buildContext(base))).toBe(
			'Severance (2022-2025)',
		);
	});

	it('uses yearRange to avoid a redundant "(2025-2025)"', () => {
		expect(renderFilename('{{title}} ({{yearRange}})', buildContext({ ...base, yearEnd: 2022 }))).toBe(
			'Severance (2022)',
		);
	});

	it('falls back to the title when the pattern renders empty', () => {
		expect(renderFilename('{{nieistniejące}}', buildContext(base))).toBe('Severance');
	});
});
