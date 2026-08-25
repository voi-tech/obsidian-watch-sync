import { describe, expect, it, vi } from 'vitest';
import { buildPlan, type EngineOptions } from '../src/sync/engine';
import { executePlan } from '../src/vault/writer';
import { toAliases, toTags } from '../src/vault/frontmatter';
import { createLimiter, mapWithLimit } from '../src/util/limit';
import type { ApplicableOperation } from '../src/sync/operations';
import { DEFAULT_SETTINGS, planIsEmpty, type NormalizedMedia, type SyncPlan } from '../src/model/types';
import { nuvioSourceUrl, webUrl } from '../src/stremio/links';
import { matchNote } from '../src/sync/matcher';
import { FakeVault } from './fake-gateway';

const MOVIES = 'Movies';

const options = (): EngineOptions => ({
	settings: { ...DEFAULT_SETTINGS, movieFolder: MOVIES, seriesFolder: 'Series', properties: { link: 'source' } },
	index: {},
	templates: { movie: '', series: '' },
});

function movie(overrides: Partial<NormalizedMedia> = {}): NormalizedMedia {
	return {
		id: 'tt0167260',
		type: 'movie',
		title: 'Arrival',
		year: 2016,
		yearStart: 2016,
		yearEnd: 2016,
		releaseDate: '2016-11-11',
		durationMinutes: 116,
		genres: [],
		cast: [],
		lastWatched: '2024-06-21',
		watchStatus: 'watched',
		finished: true,
		progressPercent: 100,
		stremioUrl: webUrl('movie', 'tt0167260'),
		stremioAppUrl: 'stremio:///detail/movie/tt0167260',
		seasons: [],
		...overrides,
	};
}

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

describe('frontmatter parsing', () => {
	it('treats a scalar alias as one alias, not several words', () => {
		// `aliases: Disclosure Day` used to become ['Disclosure', 'Day'] and match
		// unrelated notes.
		expect(toAliases('Disclosure Day')).toEqual(['Disclosure Day']);
		expect(toAliases('Greenland 2: Migration')).toEqual(['Greenland 2: Migration']);
	});

	it('keeps a list of aliases as written', () => {
		expect(toAliases(['A B', 'C'])).toEqual(['A B', 'C']);
	});

	it('ignores empty aliases', () => {
		expect(toAliases('   ')).toEqual([]);
		expect(toAliases(undefined)).toEqual([]);
		expect(toAliases(['', 'X'])).toEqual(['X']);
	});

	it('does split a scalar tag list, which is the convention for tags', () => {
		expect(toTags('done inbox')).toEqual(['done', 'inbox']);
		expect(toTags(['done'])).toEqual(['done']);
		expect(toTags(undefined)).toEqual([]);
	});
});

describe('notes in subfolders', () => {
	it('adopts a note filed in a subfolder instead of creating a duplicate', async () => {
		const vault = new FakeVault();
		vault.addNote(`${MOVIES}/2016/Arrival (2016).md`, '# Arrival\n', {});
		const plan = await buildPlan([movie()], vault, options());

		expect(plan.create).toHaveLength(0);
		expect(plan.adopt[0].path).toBe(`${MOVIES}/2016/Arrival (2016).md`);
	});
});

describe('renamed link property', () => {
	it('writes the link under its configured name when adopting', async () => {
		const vault = new FakeVault();
		vault.addNote(`${MOVIES}/Arrival (2016).md`, '# Arrival\n', {});
		const renamed = options();
		renamed.settings = {
			...renamed.settings,
			properties: { ...renamed.settings.properties, link: 'stremio' },
		};

		await run(await buildPlan([movie()], vault, renamed), vault);
		expect(vault.frontmatter.get(`${MOVIES}/Arrival (2016).md`)?.stremio).toBe(
			webUrl('movie', 'tt0167260'),
		);
	});

	it('refuses to steal a note already claimed by a different title', async () => {
		const vault = new FakeVault();
		vault.addNote(`${MOVIES}/Arrival (2016).md`, '# Arrival\n', {
			stremio: webUrl('movie', 'tt-something-else'),
			duration: 999,
		});
		const renamed = options();
		renamed.settings = {
			...renamed.settings,
			properties: { ...renamed.settings.properties, link: 'stremio' },
		};

		const plan = await buildPlan([movie()], vault, renamed);
		expect(plan.adopt).toHaveLength(0);
		expect(plan.create).toHaveLength(0);
		expect(plan.conflicts).toHaveLength(1);

		await run(plan, vault);
		// The other title's note is left exactly as it was.
		expect(vault.frontmatter.get(`${MOVIES}/Arrival (2016).md`)).toEqual({
			stremio: webUrl('movie', 'tt-something-else'),
			duration: 999,
		});
	});

	it('leaves other properties alone while claiming an unclaimed note', async () => {
		const vault = new FakeVault();
		vault.addNote(`${MOVIES}/Arrival (2016).md`, '# Arrival\n', { duration: 999 });
		const renamed = options();
		renamed.settings = {
			...renamed.settings,
			properties: { ...renamed.settings.properties, link: 'stremio' },
		};

		await run(await buildPlan([movie()], vault, renamed), vault);
		const frontmatter = vault.frontmatter.get(`${MOVIES}/Arrival (2016).md`)!;
		expect(frontmatter.stremio).toBe(webUrl('movie', 'tt0167260'));
		expect(frontmatter.duration).toBe(999);
	});
});

describe('atomic body edits', () => {
	it('applies the transform to whatever the file holds at write time', async () => {
		const vault = new FakeVault();
		const note = 'Series/Show (2020).md';
		vault.addNote(note, '# Show\n\n### Sezon 1\n\n1. [ ] A\n2. [ ] B\n', {
			source: webUrl('series', 'tt1'),
		});

		const show = movie({
			id: 'tt1',
			type: 'series',
			title: 'Show',
			stremioUrl: webUrl('series', 'tt1'),
			seasons: [
				{
					number: 1,
					episodes: [
						{ season: 1, number: 1, videoId: 'tt1:1:1', title: 'A', watched: true, current: false },
						{ season: 1, number: 2, videoId: 'tt1:1:2', title: 'B', watched: false, current: false },
					],
				},
			],
		});

		const plan = await buildPlan([show], vault, options());
		await run(plan, vault);
		expect(vault.files.get(note)).toContain('1. [x] A');
		expect(vault.files.get(note)).toContain('2. [ ] B');
	});

	it('does not record a write when the transform changes nothing', async () => {
		const vault = new FakeVault();
		vault.addNote(`${MOVIES}/Arrival (2016).md`, '# Arrival\n', {});
		await run(await buildPlan([movie()], vault, options()), vault);

		const before = vault.writes.length;
		await run(await buildPlan([movie()], vault, options()), vault);
		expect(vault.writes.length).toBe(before);
	});
});

describe('idempotence with the new defaults', () => {
	it('settles after one run', async () => {
		const vault = new FakeVault();
		await run(await buildPlan([movie()], vault, options()), vault);
		expect(planIsEmpty(await buildPlan([movie()], vault, options()))).toBe(true);
	});
});

describe('concurrency limiter', () => {
	it('never exceeds the limit', async () => {
		let active = 0;
		let peak = 0;
		const limiter = createLimiter(3);

		await Promise.all(
			Array.from({ length: 20 }, () =>
				limiter.run(async () => {
					active += 1;
					peak = Math.max(peak, active);
					await new Promise((resolve) => setTimeout(resolve, 1));
					active -= 1;
				}),
			),
		);

		expect(peak).toBeLessThanOrEqual(3);
	});

	it('preserves input order in the results', async () => {
		const out = await mapWithLimit([5, 1, 4, 2, 3], 2, async (n) => {
			await new Promise((resolve) => setTimeout(resolve, n));
			return n;
		});
		expect(out).toEqual([5, 1, 4, 2, 3]);
	});

	it('reports progress once per item', async () => {
		const onSettled = vi.fn();
		await mapWithLimit([1, 2, 3], 2, async (n) => n, onSettled);
		expect(onSettled).toHaveBeenCalledTimes(3);
		expect(onSettled).toHaveBeenLastCalledWith(3, 3);
	});

	it('releases its slot when a task throws', async () => {
		const limiter = createLimiter(1);
		await expect(limiter.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
		await expect(limiter.run(async () => 'fine')).resolves.toBe('fine');
	});
});

describe('a Nuvio note the plugin wrote is found again', () => {
	it('matches on the source link with no local index', () => {
		const media = movie({ id: 'nuvio:tt0167260', stremioUrl: nuvioSourceUrl('movie', 'tt0167260') });
		const note = {
			path: `${MOVIES}/Arrival (2016).md`,
			basename: 'Arrival (2016)',
			source: nuvioSourceUrl('movie', 'tt0167260'),
			aliases: ['Arrival'],
			frontmatter: {},
		};

		// The index is empty here on purpose: a reinstall or a second device starts
		// without one, and the source link has to carry the match on its own.
		expect(matchNote(media, [note], {})).toMatchObject({ match: { tier: 'source', certain: true } });
	});
});
