import type { Season } from '../model/types';

/**
 * Parser and surgical mutator for the season/episode blocks used across the
 * vault's 46 series notes:
 *
 *     ### Sezon 1
 *     1. [ ] Dobre strony piekła
 *     2. [x] Half Loop
 *
 * Variants that actually occur: `### Sezon 5 (2025)`, `### Sezon 4: Wybór`, and
 * a handful of `- [ ]` bullets. Nothing here rewrites episode titles or the
 * prose paragraphs that sit between sections — a mutation replaces exactly one
 * character inside the brackets.
 */

const SEASON_HEADING = /^(#{1,6})\s+(sezon|season)\s+(\d+)\b\s*(.*)$/i;
const HEADING = /^(#{1,6})\s+/;
const LIST_ITEM = /^(\s*)(?:(\d+)\.|[-*+])\s+\[([ xX])\]\s?(.*)$/;

export interface ParsedEpisodeItem {
	line: number;
	/** The number in `12. [ ] …`; undefined for bullet lists. */
	ordinal?: number;
	checked: boolean;
	/** Character offset of the box content within the line. */
	checkboxColumn: number;
	text: string;
}

export interface ParsedSeasonSection {
	seasonNumber: number;
	headingLine: number;
	headingLevel: number;
	/** The word the note itself uses — `Sezon` or `Season`. */
	headingWord: string;
	/** Trailing text after the number: `(2025)`, `: Wybór`. */
	headingSuffix: string;
	/** Line index just past the section, for appends. */
	endLine: number;
	items: ParsedEpisodeItem[];
}

export function parseSeasonSections(content: string): ParsedSeasonSection[] {
	const lines = content.split('\n');
	const sections: ParsedSeasonSection[] = [];

	for (let index = 0; index < lines.length; index += 1) {
		const match = SEASON_HEADING.exec(lines[index]);
		if (!match) continue;

		const headingLevel = match[1].length;
		const section: ParsedSeasonSection = {
			seasonNumber: Number(match[3]),
			headingLine: index,
			headingLevel,
			headingWord: match[2],
			headingSuffix: match[4].trim(),
			endLine: lines.length,
			items: [],
		};

		for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
			const line = lines[cursor];
			const heading = HEADING.exec(line);
			if (heading && heading[1].length <= headingLevel) {
				section.endLine = cursor;
				break;
			}
			const item = LIST_ITEM.exec(line);
			if (!item) continue;
			section.items.push({
				line: cursor,
				ordinal: item[2] ? Number(item[2]) : undefined,
				checked: item[3].toLowerCase() === 'x',
				checkboxColumn: line.indexOf('[', item[1].length) + 1,
				text: item[4],
			});
		}

		sections.push(section);
	}

	return sections;
}

/**
 * Matches an episode number to a list item. Ordered lists are matched on their
 * written number so a hand-renumbered list still lines up; bullet lists fall
 * back to position.
 */
export function findEpisodeItem(
	section: ParsedSeasonSection,
	episodeNumber: number,
): ParsedEpisodeItem | undefined {
	const byOrdinal = section.items.find((item) => item.ordinal === episodeNumber);
	if (byOrdinal) return byOrdinal;
	if (section.items.some((item) => item.ordinal !== undefined)) return undefined;
	return section.items[episodeNumber - 1];
}

export interface CheckboxChange {
	line: number;
	/** Character offset of the box content, captured while parsing. */
	column: number;
	from: boolean;
	to: boolean;
	text: string;
	season: number;
	episode: number;
}

/** Checkbox flips the note needs to match Stremio. Empty when already in sync. */
export function diffCheckboxes(content: string, seasons: Season[]): CheckboxChange[] {
	const sections = parseSeasonSections(content);
	const changes: CheckboxChange[] = [];

	for (const season of seasons) {
		const section = sections.find((candidate) => candidate.seasonNumber === season.number);
		if (!section) continue;
		for (const episode of season.episodes) {
			const item = findEpisodeItem(section, episode.number);
			if (!item || item.checked === episode.watched) continue;
			changes.push({
				line: item.line,
				column: item.checkboxColumn,
				from: item.checked,
				to: episode.watched,
				text: item.text,
				season: season.number,
				episode: episode.number,
			});
		}
	}

	return changes;
}

export function applyCheckboxChanges(content: string, changes: CheckboxChange[]): string {
	if (changes.length === 0) return content;
	const lines = content.split('\n');
	for (const change of changes) {
		const line = lines[change.line];
		// Re-verify the exact offset before writing: if the line moved or changed
		// shape since parsing, skip it rather than corrupt the text.
		if (line === undefined || line[change.column - 1] !== '[' || line[change.column + 1] !== ']') continue;
		lines[change.line] =
			line.slice(0, change.column) + (change.to ? 'x' : ' ') + line.slice(change.column + 1);
	}
	return lines.join('\n');
}

/** Seasons present in Stremio but absent from the note. */
export function missingSeasons(content: string, seasons: Season[]): Season[] {
	const present = new Set(parseSeasonSections(content).map((section) => section.seasonNumber));
	return seasons.filter((season) => !present.has(season.number) && season.episodes.length > 0);
}

/**
 * How a note writes its season headings. Captured from the note being edited so
 * an append matches what is already there instead of imposing a house style.
 */
export interface SeasonStyle {
	level: number;
	word: string;
}

export const DEFAULT_SEASON_STYLE: SeasonStyle = { level: 3, word: 'Season' };

/** Polish notes label a nameless episode "Odcinek"; English ones "Episode". */
function episodeFallbackWord(seasonWord: string): string {
	return /^sezon$/i.test(seasonWord) ? 'Odcinek' : 'Episode';
}

export function renderSeasonSection(season: Season, style: SeasonStyle = DEFAULT_SEASON_STYLE): string {
	const hashes = '#'.repeat(style.level);
	const heading = `${hashes} ${style.word} ${season.number}`;
	const title = season.title ? `${heading}: ${season.title}` : heading;
	const fallback = episodeFallbackWord(style.word);
	const lines = season.episodes.map(
		(episode) =>
			`${episode.number}. [${episode.watched ? 'x' : ' '}] ${episode.title ?? `${fallback} ${episode.number}`}`,
	);
	return [title, '', ...lines].join('\n');
}

export function renderSeasons(seasons: Season[], style: SeasonStyle = DEFAULT_SEASON_STYLE): string {
	return seasons.map((season) => renderSeasonSection(season, style)).join('\n\n');
}

/**
 * The heading style a note already uses, so an append blends in: a note written
 * with `## Sezon 1` gets `## Sezon 2`, not `### Season 2`.
 */
export function seasonStyleOf(content: string): SeasonStyle {
	const sections = parseSeasonSections(content);
	const last = sections[sections.length - 1];
	return last ? { level: last.headingLevel, word: last.headingWord } : DEFAULT_SEASON_STYLE;
}

export function appendSeasonSection(content: string, season: Season): string {
	const trimmed = content.replace(/\s+$/, '');
	return `${trimmed}\n\n${renderSeasonSection(season, seasonStyleOf(content))}\n`;
}
