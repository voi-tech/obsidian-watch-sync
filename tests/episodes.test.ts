import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	appendSeasonSection,
	applyCheckboxChanges,
	diffCheckboxes,
	findEpisodeItem,
	missingSeasons,
	parseSeasonSections,
	renderSeasonSection,
	seasonStyleOf,
} from '../src/vault/episodes';
import type { EpisodeProgress, Season } from '../src/model/types';

function fixture(name: string): string {
	return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
}

const severance = fixture('note-severance.md');
const westworld = fixture('note-westworld.md');

function season(number: number, watched: boolean[], titles?: string[]): Season {
	const episodes: EpisodeProgress[] = watched.map((isWatched, index) => ({
		season: number,
		number: index + 1,
		videoId: `tt1:${number}:${index + 1}`,
		title: titles?.[index],
		watched: isWatched,
		current: false,
	}));
	return { number, episodes };
}

describe('parseSeasonSections', () => {
	it('parses the plain "### Sezon N" form used by most notes', () => {
		const sections = parseSeasonSections(severance);
		expect(sections.map((s) => s.seasonNumber)).toEqual([1, 2]);
		expect(sections[0].items).toHaveLength(9);
		expect(sections[1].items).toHaveLength(10);
		expect(sections[0].items[0].text).toBe('Dobre strony piekła');
	});

	it('parses a season heading with a subtitle', () => {
		const sections = parseSeasonSections(westworld);
		expect(sections[0].seasonNumber).toBe(1);
		expect(sections[0].headingSuffix).toBe(': Labirynt');
		expect(sections[0].items).toHaveLength(10);
	});

	it('parses a season heading with a year', () => {
		const sections = parseSeasonSections('### Sezon 5 (2025)\n\n1. [ ] Coś\n');
		expect(sections[0].seasonNumber).toBe(5);
		expect(sections[0].headingSuffix).toBe('(2025)');
	});

	it('parses bullet lists as well as ordered lists', () => {
		const sections = parseSeasonSections('### Sezon 1\n\n- [x] Pierwszy\n- [ ] Drugi\n');
		expect(sections[0].items.map((item) => item.checked)).toEqual([true, false]);
		expect(sections[0].items[0].ordinal).toBeUndefined();
	});

	it('stops a section at the next same-level heading', () => {
		const sections = parseSeasonSections(severance);
		const prose = severance.split('\n').slice(sections[1].headingLine, sections[1].endLine);
		expect(prose.join('\n')).toContain('Premiera drugiego sezonu');
	});

	it('ignores checkboxes that sit outside any season section', () => {
		expect(parseSeasonSections('# Tytuł\n\n- [ ] kupić popcorn\n')).toHaveLength(0);
	});
});

describe('findEpisodeItem', () => {
	it('matches on the written ordinal, not on position', () => {
		const [section] = parseSeasonSections('### Sezon 1\n\n3. [ ] Trzeci\n4. [ ] Czwarty\n');
		expect(findEpisodeItem(section, 3)?.text).toBe('Trzeci');
		expect(findEpisodeItem(section, 1)).toBeUndefined();
	});

	it('falls back to position for bullet lists', () => {
		const [section] = parseSeasonSections('### Sezon 1\n\n- [ ] A\n- [ ] B\n');
		expect(findEpisodeItem(section, 2)?.text).toBe('B');
	});
});

describe('diffCheckboxes / applyCheckboxChanges', () => {
	it('is empty when the note already matches Stremio', () => {
		const seasons = [season(1, Array<boolean>(9).fill(false)), season(2, Array<boolean>(10).fill(false))];
		expect(diffCheckboxes(severance, seasons)).toHaveLength(0);
	});

	it('reports only the boxes that actually change', () => {
		const seasons = [season(1, [true, true, false, false, false, false, false, false, false])];
		const changes = diffCheckboxes(severance, seasons);
		expect(changes.map((change) => change.episode)).toEqual([1, 2]);
		expect(changes[0]).toMatchObject({ from: false, to: true, text: 'Dobre strony piekła' });
	});

	it('ticks boxes without touching anything else on the line', () => {
		const seasons = [season(1, [true, false, false, false, false, false, false, false, false])];
		const updated = applyCheckboxChanges(severance, diffCheckboxes(severance, seasons));
		expect(updated).toContain('1. [x] Dobre strony piekła');
		expect(updated).toContain('2. [ ] Half Loop');
	});

	it('unticks a box when Stremio says the episode is not watched', () => {
		const ticked = severance.replace('1. [ ] Dobre strony piekła', '1. [x] Dobre strony piekła');
		const seasons = [season(1, Array<boolean>(9).fill(false))];
		const updated = applyCheckboxChanges(ticked, diffCheckboxes(ticked, seasons));
		expect(updated).toContain('1. [ ] Dobre strony piekła');
	});

	it('preserves hand-written prose inside a season section', () => {
		const seasons = [season(2, Array<boolean>(10).fill(true))];
		const updated = applyCheckboxChanges(severance, diffCheckboxes(severance, seasons));
		expect(updated).toContain('Premiera drugiego sezonu odbyła się 17 stycznia 2025 roku.');
	});

	it('preserves frontmatter and the H1 byte for byte', () => {
		const seasons = [season(1, Array<boolean>(9).fill(true))];
		const updated = applyCheckboxChanges(severance, diffCheckboxes(severance, seasons));
		const head = (text: string) => text.split('### Sezon 1')[0];
		expect(head(updated)).toBe(head(severance));
	});

	it('keeps episode titles from the note rather than from Stremio', () => {
		const seasons = [season(1, [true], ['Different Title From TMDB'])];
		const updated = applyCheckboxChanges(westworld, diffCheckboxes(westworld, seasons));
		expect(updated).toContain('1. [x] Pierwowzór (The Original)');
		expect(updated).not.toContain('Different Title From TMDB');
	});

	it('ignores a season the note does not have', () => {
		expect(diffCheckboxes(severance, [season(7, [true])])).toHaveLength(0);
	});

	it('ignores an episode the note does not list', () => {
		expect(diffCheckboxes(severance, [season(1, Array<boolean>(20).fill(true))]).map((c) => c.episode)).toEqual(
			[1, 2, 3, 4, 5, 6, 7, 8, 9],
		);
	});

	it('is idempotent', () => {
		const seasons = [season(1, Array<boolean>(9).fill(true))];
		const once = applyCheckboxChanges(severance, diffCheckboxes(severance, seasons));
		expect(diffCheckboxes(once, seasons)).toHaveLength(0);
		expect(applyCheckboxChanges(once, diffCheckboxes(once, seasons))).toBe(once);
	});
});

describe('missingSeasons / appendSeasonSection', () => {
	it('detects a season the note does not cover yet', () => {
		const seasons = [season(1, [false]), season(2, [false]), season(3, [true, true])];
		expect(missingSeasons(severance, seasons).map((s) => s.number)).toEqual([3]);
	});

	it('does not report an empty season', () => {
		expect(missingSeasons(severance, [{ number: 3, episodes: [] }])).toHaveLength(0);
	});

	it('appends a season using the heading level the note already uses', () => {
		const updated = appendSeasonSection(severance, season(3, [true, false], ['Pierwszy', 'Drugi']));
		expect(updated).toContain('### Sezon 3\n\n1. [x] Pierwszy\n2. [ ] Drugi');
		expect(updated.startsWith(severance.slice(0, 200))).toBe(true);
	});

	it('respects a note written with ## headings', () => {
		const note = '# Serial\n\n## Sezon 1\n\n1. [ ] A\n';
		expect(appendSeasonSection(note, season(2, [false]))).toContain('## Sezon 2');
	});

	it('renders a subtitle when the season has a real name', () => {
		expect(renderSeasonSection({ ...season(2, [false]), title: 'The Book of Carol' })).toContain(
			'### Season 2: The Book of Carol',
		);
	});

	it('falls back to a generic episode label when no title is known', () => {
		expect(renderSeasonSection(season(1, [false]))).toContain('1. [ ] Episode 1');
	});

	it('keeps a Polish note Polish when appending', () => {
		// Existing series notes may use "### Sezon N"; an
		// appended season must not switch language mid-note.
		expect(seasonStyleOf(severance)).toEqual({ level: 3, word: 'Sezon' });
		const updated = appendSeasonSection(severance, season(3, [false]));
		expect(updated).toContain('### Sezon 3');
		expect(updated).toContain('1. [ ] Odcinek 1');
		expect(updated).not.toContain('Season 3');
	});

	it('keeps an English note English when appending', () => {
		const note = '# Show\n\n## Season 1\n\n1. [x] Pilot\n';
		expect(seasonStyleOf(note)).toEqual({ level: 2, word: 'Season' });
		expect(appendSeasonSection(note, season(2, [false]))).toContain('## Season 2');
	});

	it('parses an English season heading', () => {
		const [parsed] = parseSeasonSections('### Season 4: The Choice\n\n1. [x] A\n');
		expect(parsed.seasonNumber).toBe(4);
		expect(parsed.headingWord).toBe('Season');
		expect(parsed.items[0].checked).toBe(true);
	});
});
