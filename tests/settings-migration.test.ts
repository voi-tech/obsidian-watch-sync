import { describe, expect, it } from 'vitest';
import { buildPlan, type EngineOptions } from '../src/sync/engine';
import { DEFAULT_SETTINGS, type NormalizedMedia } from '../src/model/types';
import { webUrl } from '../src/stremio/links';
import { FakeVault } from './fake-gateway';

const MOVIES = 'Movies';

const media: NormalizedMedia = {
	id: 'tt1',
	type: 'movie',
	title: 'Arrival',
	year: 2016,
	yearStart: 2016,
	yearEnd: 2016,
	durationMinutes: 116,
	genres: [],
	cast: [],
	watchStatus: 'watched',
	finished: true,
	progressPercent: 100,
	stremioUrl: webUrl('movie', 'tt1'),
	stremioAppUrl: 'stremio:///detail/movie/tt1',
	seasons: [],
};

const options = (link: string): EngineOptions => ({
	settings: {
		...DEFAULT_SETTINGS,
		movieFolder: MOVIES,
		seriesFolder: 'Series',
		properties: { ...DEFAULT_SETTINGS.properties, link, duration: 'duration' },
	},
	index: {},
	templates: { movie: '', series: '' },
});

describe('the link property carries its own on/off switch', () => {
	it('writes the link when the property has a name', async () => {
		const vault = new FakeVault();
		const plan = await buildPlan([media], vault, options('source'));
		expect(plan.create[0].describe()).toBeTruthy();

		const create = plan.create[0] as unknown as { apply: (g: FakeVault) => Promise<void> };
		await create.apply(vault);
		expect(vault.frontmatter.get(`${MOVIES}/Arrival (2016).md`)?.source).toBe(webUrl('movie', 'tt1'));
	});

	it('writes no link when the name is cleared — no separate toggle needed', async () => {
		const vault = new FakeVault();
		const plan = await buildPlan([media], vault, options(''));
		const create = plan.create[0] as unknown as { apply: (g: FakeVault) => Promise<void> };
		await create.apply(vault);

		const frontmatter = vault.frontmatter.get(`${MOVIES}/Arrival (2016).md`)!;
		expect(frontmatter.source).toBeUndefined();
		expect(frontmatter.duration).toBe(116);
	});
});
