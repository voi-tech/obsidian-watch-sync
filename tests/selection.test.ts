import { describe, expect, it } from 'vitest';
import { buildPlan, type EngineOptions } from '../src/sync/engine';
import { groupByTitle } from '../src/ui/preview-modal';
import { executePlan } from '../src/vault/writer';
import type { ApplicableOperation } from '../src/sync/operations';
import {
	DEFAULT_SETTINGS,
	planSize,
	selectOperations,
	type NormalizedMedia,
	type SyncPlan,
} from '../src/model/types';
import { webUrl } from '../src/stremio/links';
import { FakeVault } from './fake-gateway';

const MOVIES = 'Movies';
const SERIES = 'Series';

const options = (): EngineOptions => ({
	settings: { ...DEFAULT_SETTINGS, movieFolder: MOVIES, seriesFolder: SERIES, properties: { link: 'source' } },
	index: {},
	templates: { movie: '', series: '' },
});

function media(id: string, title: string, overrides: Partial<NormalizedMedia> = {}): NormalizedMedia {
	return {
		id,
		type: 'movie',
		title,
		year: 2016,
		yearStart: 2016,
		yearEnd: 2016,
		cover: 'https://image.tmdb.org/t/p/original//x.jpg',
		durationMinutes: 100,
		genres: [],
		cast: [],
		lastWatched: '2024-06-21',
		releaseDate: '2016-11-11',
		watchStatus: 'watched',
		finished: true,
		progressPercent: 100,
		stremioUrl: webUrl('movie', id),
		stremioAppUrl: `stremio:///detail/movie/${id}`,
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

describe('groupByTitle', () => {
	it('gives one group per title, sorted', async () => {
		const vault = new FakeVault();
		const plan = await buildPlan(
			[media('tt1', 'Zodiac'), media('tt2', 'Arrival')],
			vault,
			options(),
		);
		expect(groupByTitle(plan).map((group) => group.title)).toEqual(['Arrival', 'Zodiac']);
	});

	it('collects every operation for a title into one group, across categories', async () => {
		const vault = new FakeVault();
		vault.addNote(
			`${SERIES}/Serial (2016).md`,
			'# Serial\n\n### Sezon 1\n\n1. [ ] Pierwszy\n',
			{},
		);
		const show = media('tt3', 'Serial', {
			type: 'series',
			stremioUrl: webUrl('series', 'tt3'),
			seasons: [
				{
					number: 1,
					episodes: [
						{ season: 1, number: 1, videoId: 'tt3:1:1', title: 'Pierwszy', watched: true, current: false },
					],
				},
			],
		});
		const plan = await buildPlan([show], vault, options());

		// One adoption plus one checkbox update, both about the same title.
		const [group] = groupByTitle(plan);
		expect(group.title).toBe('Serial');
		expect(group.operations.map((operation) => operation.kind).sort()).toEqual([
			'adopt-note',
			'update-episodes',
		]);
	});

	it('carries the title on every operation kind', async () => {
		const vault = new FakeVault();
		const plan = await buildPlan([media('tt1', 'Arrival')], vault, options());
		expect(plan.create[0].title).toBe('Arrival');
	});
});

describe('selectOperations', () => {
	it('keeps only what the predicate accepts', async () => {
		const vault = new FakeVault();
		const plan = await buildPlan(
			[media('tt1', 'Arrival'), media('tt2', 'Zodiac')],
			vault,
			options(),
		);
		const selection = selectOperations(plan, (operation) => operation.mediaId === 'tt1');
		expect(planSize(selection)).toBe(1);
		expect(selection.create[0].title).toBe('Arrival');
	});

	it('leaves conflicts and skips untouched, so they are still reported', async () => {
		const vault = new FakeVault();
		const plan = await buildPlan(
			[media('tt1', 'Arrival'), media('tt2', 'Serial', { type: 'series', seasons: [] })],
			vault,
			options(),
		);
		const selection = selectOperations(plan, () => false);
		expect(planSize(selection)).toBe(0);
		expect(selection.skipped).toEqual(plan.skipped);
	});

	it('writes only the selected title and leaves the other one absent', async () => {
		const vault = new FakeVault();
		const plan = await buildPlan(
			[media('tt1', 'Arrival'), media('tt2', 'Zodiac')],
			vault,
			options(),
		);
		const result = await run(
			selectOperations(plan, (operation) => operation.mediaId === 'tt1'),
			vault,
		);

		expect(result.created).toBe(1);
		expect(vault.exists(`${MOVIES}/Arrival (2016).md`)).toBe(true);
		expect(vault.exists(`${MOVIES}/Zodiac (2016).md`)).toBe(false);
	});

	it('re-plans the deselected title on the next run', async () => {
		const vault = new FakeVault();
		const first = await buildPlan(
			[media('tt1', 'Arrival'), media('tt2', 'Zodiac')],
			vault,
			options(),
		);
		await run(
			selectOperations(first, (operation) => operation.mediaId === 'tt1'),
			vault,
		);

		const second = await buildPlan(
			[media('tt1', 'Arrival'), media('tt2', 'Zodiac')],
			vault,
			options(),
		);
		expect(planSize(second)).toBe(1);
		expect(second.create[0].title).toBe('Zodiac');
	});

	it('can deselect one operation of a title while keeping another', async () => {
		const vault = new FakeVault();
		vault.addNote(`${SERIES}/Serial (2016).md`, '# Serial\n\n### Sezon 1\n\n1. [ ] Pierwszy\n', {});
		const show = media('tt3', 'Serial', {
			type: 'series',
			stremioUrl: webUrl('series', 'tt3'),
			seasons: [
				{
					number: 1,
					episodes: [
						{ season: 1, number: 1, videoId: 'tt3:1:1', title: 'Pierwszy', watched: true, current: false },
					],
				},
			],
		});
		const plan = await buildPlan([show], vault, options());

		// Take the frontmatter adoption, drop the checkbox flip.
		await run(
			selectOperations(plan, (operation) => operation.kind === 'adopt-note'),
			vault,
		);

		expect(vault.frontmatter.get(`${SERIES}/Serial (2016).md`)?.source).toBe(webUrl('series', 'tt3'));
		expect(vault.files.get(`${SERIES}/Serial (2016).md`)).toContain('1. [ ] Pierwszy');
	});
});
