import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildPlan, type EngineOptions } from '../src/sync/engine';
import { executePlan } from '../src/vault/writer';
import type { ApplicableOperation } from '../src/sync/operations';
import { DEFAULT_SETTINGS, planIsEmpty, type NormalizedMedia, type SyncPlan } from '../src/model/types';
import { webUrl } from '../src/stremio/links';
import { FakeVault } from './fake-gateway';

const MOVIES = 'Movies';
const SERIES = 'Series';

const options = (overrides: Partial<EngineOptions> = {}): EngineOptions => ({
	settings: { ...DEFAULT_SETTINGS, movieFolder: MOVIES, seriesFolder: SERIES },
	index: {},
	templates: { movie: '', series: '' },
	...overrides,
});

function movie(overrides: Partial<NormalizedMedia> = {}): NormalizedMedia {
	return {
		id: 'tt0167260',
		imdbId: 'tt0167260',
		type: 'movie',
		title: 'Arrival',
		year: 2016,
		yearStart: 2016,
		yearEnd: 2016,
		description: 'Opis',
		cover: 'https://image.tmdb.org/t/p/original//pEzNVQfdzYDzVK0XqxERIw2x2se.jpg',
		durationMinutes: 116,
		genres: [],
		cast: [],
		lastWatched: '2024-06-21',
		releaseDate: '2016-11-11',
		watchStatus: 'watched',
		finished: true,
		progressPercent: 100,
		stremioUrl: webUrl('movie', 'tt0167260'),
		stremioAppUrl: 'stremio:///detail/movie/tt0167260',
		seasons: [],
		...overrides,
	};
}

function series(overrides: Partial<NormalizedMedia> = {}): NormalizedMedia {
	return {
		...movie(),
		id: 'tt11280740',
		imdbId: 'tt11280740',
		type: 'series',
		title: 'Severance',
		yearStart: 2022,
		yearEnd: 2025,
		year: 2022,
		stremioUrl: webUrl('series', 'tt11280740'),
		stremioAppUrl: 'stremio:///detail/series/tt11280740',
		seasons: [
			{
				number: 1,
				episodes: Array.from({ length: 9 }, (_, index) => ({
					season: 1,
					number: index + 1,
					videoId: `tt11280740:1:${index + 1}`,
					title: `Odcinek ${index + 1}`,
					watched: true,
					current: false,
				})),
			},
		],
		...overrides,
	};
}

const severanceNote = readFileSync(
	fileURLToPath(new URL('./fixtures/note-severance.md', import.meta.url)),
	'utf8',
);

async function run(plan: SyncPlan, vault: FakeVault) {
	return executePlan(
		{
			create: plan.create as ApplicableOperation[],
			adopt: plan.adopt as ApplicableOperation[],
			update: plan.update as ApplicableOperation[],
			skipped: plan.skipped.length,
			deselected: 0,
		},
		vault,
	);
}

describe('buildPlan — new notes', () => {
	it('creates a movie note at the configured folder', async () => {
		const vault = new FakeVault();
		const plan = await buildPlan([movie()], vault, options());
		expect(plan.create).toHaveLength(1);
		expect(plan.create[0].path).toBe(`${MOVIES}/Arrival (2016).md`);
		expect(plan.create[0].describe()).toContain('Create');
	});

	it('sanitizes a colon in the title the way the vault does', async () => {
		const vault = new FakeVault();
		const plan = await buildPlan([movie({ title: 'Alien: Romulus', year: 2024, yearStart: 2024 })], vault, options());
		expect(plan.create[0].path).toBe(`${MOVIES}/Alien - Romulus (2024).md`);
	});

	it('writes the managed properties and the done tag', async () => {
		const vault = new FakeVault();
		const plan = await buildPlan([movie()], vault, options());
		await run(plan, vault);
		expect(vault.frontmatter.get(`${MOVIES}/Arrival (2016).md`)).toEqual({
			released: '2016-11-11',
			end: '2024-06-21',
			duration: 116,
			cover: 'https://image.tmdb.org/t/p/original//pEzNVQfdzYDzVK0XqxERIw2x2se.jpg',
			source: webUrl('movie', 'tt0167260'),
			tags: ['done'],
		});

		expect(vault.frontmatter.get(`${MOVIES}/Arrival (2016).md`)?.released).toBe('2016-11-11');
	});

	it('honours renamed and disabled property keys', async () => {
		const vault = new FakeVault();
		const renamed = options();
		renamed.settings = {
			...renamed.settings,
			properties: {
				releaseDate: 'premiere',
				lastWatched: '',
				duration: 'runtime',
				cover: 'poster',
				source: 'stremio',
			},
		};
		await run(await buildPlan([movie()], vault, renamed), vault);

		const frontmatter = vault.frontmatter.get(`${MOVIES}/Arrival (2016).md`)!;
		expect(frontmatter).toMatchObject({
			premiere: '2016-11-11',
			runtime: 116,
			poster: 'https://image.tmdb.org/t/p/original//pEzNVQfdzYDzVK0XqxERIw2x2se.jpg',
			stremio: webUrl('movie', 'tt0167260'),
		});
		// A blank name switches the property off entirely.
		expect(frontmatter.end).toBeUndefined();
	});

	it('still records the last play for an unfinished title, without the done tag', async () => {
		const vault = new FakeVault();
		const plan = await buildPlan(
			[movie({ finished: false, watchStatus: 'in-progress' })],
			vault,
			options(),
		);
		await run(plan, vault);
		const frontmatter = vault.frontmatter.get(`${MOVIES}/Arrival (2016).md`)!;
		expect(frontmatter.end).toBe('2024-06-21');
		expect(frontmatter.tags).toBeUndefined();
	});

	it('renders the season list into a new series note', async () => {
		const vault = new FakeVault();
		const plan = await buildPlan([series()], vault, options());
		await run(plan, vault);
		const content = vault.files.get(`${SERIES}/Severance (2022-2025).md`)!;
		expect(content).toContain('# Severance (2022-2025)');
		expect(content).toContain('### Season 1');
		expect(content).toContain('1. [x] Odcinek 1');
	});

	it('refuses to create a series note with no episode data', async () => {
		const vault = new FakeVault();
		const plan = await buildPlan([series({ seasons: [] })], vault, options());
		expect(plan.create).toHaveLength(0);
		expect(plan.skipped[0].reason).toMatch(/no episode list/);
	});

	it('reports a conflict instead of overwriting an unmatched file at the target path', async () => {
		const vault = new FakeVault();
		vault.addNote(`${MOVIES}/Arrival (2016).md`, '# Coś zupełnie innego', {
			source: webUrl('movie', 'tt-inny-film'),
		});
		const plan = await buildPlan([movie()], vault, options());
		expect(plan.create).toHaveLength(0);
		expect(plan.conflicts[0].reason).toMatch(/already exists/);
	});

	it('skips a title when the target folder is not configured', async () => {
		const vault = new FakeVault();
		const plan = await buildPlan(
			[movie()],
			vault,
			options({ settings: { ...DEFAULT_SETTINGS, movieFolder: '', seriesFolder: SERIES } }),
		);
		expect(plan.skipped[0].reason).toMatch(/no target folder/);
	});
});

describe('buildPlan — adoption of hand-written notes', () => {
	it('matches an existing note by filename and only fills gaps', async () => {
		const vault = new FakeVault();
		vault.addNote(`${MOVIES}/Arrival (2016).md`, '# Arrival (2016)\n', {
			end: '2020-01-01',
			duration: 999,
		});
		const plan = await buildPlan([movie()], vault, options());
		expect(plan.create).toHaveLength(0);
		expect(plan.adopt).toHaveLength(1);

		await run(plan, vault);
		const frontmatter = vault.frontmatter.get(`${MOVIES}/Arrival (2016).md`)!;
		// Hand-set values survive; only the missing ones are filled.
		expect(frontmatter.end).toBe('2020-01-01');
		expect(frontmatter.duration).toBe(999);
		expect(frontmatter.released).toBe('2016-11-11');
		expect(frontmatter.source).toBe(webUrl('movie', 'tt0167260'));
	});

	it('never touches the note body while adopting', async () => {
		const vault = new FakeVault();
		const body = '# Arrival (2016)\n\nMoje własne przemyślenia o filmie.\n';
		vault.addNote(`${MOVIES}/Arrival (2016).md`, body, {});
		await run(await buildPlan([movie()], vault, options()), vault);
		expect(vault.files.get(`${MOVIES}/Arrival (2016).md`)).toBe(body);
	});

	it('matches a note whose name carries a collection prefix', async () => {
		const vault = new FakeVault();
		vault.addNote(`${MOVIES}/Alien - Aliens (1986).md`, '# Aliens\n', {});
		const plan = await buildPlan(
			[movie({ title: 'Aliens', year: 1986, yearStart: 1986, yearEnd: 1986 })],
			vault,
			options(),
		);
		expect(plan.create).toHaveLength(0);
		expect(plan.adopt[0].path).toBe(`${MOVIES}/Alien - Aliens (1986).md`);
		expect(plan.adopt[0].describe()).toContain('filename-suffix');
	});

	it('matches by alias', async () => {
		const vault = new FakeVault();
		vault.addNote(`${MOVIES}/Nowy początek (2016).md`, '# Nowy początek\n', { aliases: ['Arrival'] });
		const plan = await buildPlan([movie()], vault, options());
		expect(plan.adopt[0].path).toBe(`${MOVIES}/Nowy początek (2016).md`);
	});

	it('refuses to guess when two notes match equally well', async () => {
		const vault = new FakeVault();
		vault.addNote(`${MOVIES}/Arrival (2016).md`, '# A\n', { aliases: ['Arrival'] });
		vault.addNote(`${MOVIES}/Przybycie (2016).md`, '# B\n', { aliases: ['Arrival'] });
		const plan = await buildPlan([movie()], vault, options());
		expect(plan.adopt).toHaveLength(0);
		expect(plan.create).toHaveLength(0);
		expect(plan.conflicts[0].candidates).toHaveLength(2);
	});

	it('blocks both library items when they claim the same existing note', async () => {
		const vault = new FakeVault();
		vault.addNote(`${MOVIES}/Shared note.md`, '# Shared\n', { aliases: ['Arrival', 'The Arrival'] });
		const other = movie({
			id: 'tt9999999',
			imdbId: 'tt9999999',
			title: 'The Arrival',
			stremioUrl: webUrl('movie', 'tt9999999'),
			stremioAppUrl: 'stremio:///detail/movie/tt9999999',
		});

		const plan = await buildPlan([movie(), other], vault, options());

		expect(plan.create).toHaveLength(0);
		expect(plan.adopt).toHaveLength(0);
		expect(plan.update).toHaveLength(0);
		expect(plan.conflicts).toEqual([
			expect.objectContaining({ mediaId: 'tt0167260', candidates: [`${MOVIES}/Shared note.md`] }),
			expect.objectContaining({ mediaId: 'tt9999999', candidates: [`${MOVIES}/Shared note.md`] }),
		]);
	});

	it('matches by a renamed link property', async () => {
		const vault = new FakeVault();
		vault.addNote(`${MOVIES}/Whatever.md`, '# X\n', { stremio: webUrl('movie', 'tt0167260') });
		const renamed = options();
		renamed.settings = {
			...renamed.settings,
			properties: { ...renamed.settings.properties, source: 'stremio' },
		};
		const plan = await buildPlan([movie()], vault, renamed);
		expect(plan.create).toHaveLength(0);
		expect(plan.update.some((operation) => operation.path === `${MOVIES}/Whatever.md`)).toBe(true);
	});

	it('matches by source once the note has been claimed', async () => {
		const vault = new FakeVault();
		vault.addNote(`${MOVIES}/Zupełnie inna nazwa.md`, '# X\n', {
			source: webUrl('movie', 'tt0167260'),
		});
		const plan = await buildPlan([movie()], vault, options());
		expect(plan.adopt).toHaveLength(0);
		expect(plan.update.some((operation) => operation.path === `${MOVIES}/Zupełnie inna nazwa.md`)).toBe(true);
	});
});

describe('buildPlan — episode updates', () => {
	const claimed = { source: webUrl('series', 'tt11280740') };

	it('ticks the boxes a claimed note is missing', async () => {
		const vault = new FakeVault();
		vault.addNote(`${SERIES}/Severance (2022-2025).md`, severanceNote, claimed);
		const plan = await buildPlan([series()], vault, options());
		const episodeOps = plan.update.filter((operation) => operation.kind === 'update-episodes');
		expect(episodeOps).toHaveLength(1);

		await run(plan, vault);
		const content = vault.files.get(`${SERIES}/Severance (2022-2025).md`)!;
		expect(content).toContain('1. [x] Dobre strony piekła');
		expect(content).toContain('Premiera drugiego sezonu odbyła się 17 stycznia 2025 roku.');
		expect(content).toContain('1. [ ] Witamy, pani Cobel');
	});

	it('appends a season the note does not have yet', async () => {
		const vault = new FakeVault();
		vault.addNote(`${SERIES}/Severance (2022-2025).md`, severanceNote, claimed);
		const withSeason3 = series({
			seasons: [
				...series().seasons,
				{
					number: 3,
					episodes: [
						{ season: 3, number: 1, videoId: 'tt11280740:3:1', title: 'Nowy', watched: false, current: false },
					],
				},
			],
		});
		const plan = await buildPlan([withSeason3], vault, options());
		expect(plan.update.some((operation) => operation.kind === 'append-season')).toBe(true);

		await run(plan, vault);
		expect(vault.files.get(`${SERIES}/Severance (2022-2025).md`)).toContain('### Sezon 3\n\n1. [ ] Nowy');
	});

	it('leaves an already-correct note completely alone', async () => {
		const vault = new FakeVault();
		const allTicked = severanceNote.replace(/^(\d+)\. \[ \]/gm, '$1. [x]');
		vault.addNote(`${SERIES}/Severance (2022-2025).md`, allTicked, {
			...claimed,
			lastWatched: '2024-06-21',
			duration: 116,
			cover: 'https://image.tmdb.org/t/p/original//pEzNVQfdzYDzVK0XqxERIw2x2se.jpg',
			tags: ['done'],
		});
		const plan = await buildPlan([series()], vault, options());
		expect(planIsEmpty(plan)).toBe(true);
	});
});

describe('idempotence', () => {
	it('produces an empty plan on the second run', async () => {
		const vault = new FakeVault();
		const items = [movie(), series()];

		const first = await buildPlan(items, vault, options());
		await run(first, vault);

		const second = await buildPlan(items, vault, options());
		expect(planIsEmpty(second)).toBe(true);
	});

	it('does not write anything on the second run', async () => {
		const vault = new FakeVault();
		await run(await buildPlan([movie()], vault, options()), vault);
		const before = vault.writes.length;
		await run(await buildPlan([movie()], vault, options()), vault);
		expect(vault.writes.length).toBe(before);
	});
});

describe('executePlan', () => {
	it('records a failure and carries on with the rest', async () => {
		const vault = new FakeVault();
		const plan = await buildPlan([movie(), movie({ id: 'tt2', title: 'Drugi', stremioUrl: webUrl('movie', 'tt2') })], vault, options());
		const broken = plan.create[0] as ApplicableOperation;
		broken.apply = async () => {
			throw new Error('dysk pełny');
		};

		const result = await run(plan, vault);
		expect(result.created).toBe(1);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0].message).toContain('dysk pełny');
	});
});
