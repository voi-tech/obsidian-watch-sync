import { describe, expect, it } from 'vitest';
import { buildPlan, type EngineOptions } from '../src/sync/engine';
import { executePlan } from '../src/vault/writer';
import {
	appendManagedBlock,
	hasManagedBlock,
	managedBlockTemplate,
	readManagedBlock,
	replaceManagedBlock,
} from '../src/vault/managed-block';
import type { ApplicableOperation } from '../src/sync/operations';
import { DEFAULT_SETTINGS, planIsEmpty, type NormalizedMedia, type SyncPlan } from '../src/model/types';
import { webUrl } from '../src/stremio/links';
import { FakeVault } from './fake-gateway';

const MOVIES = 'Movies';
const NOTE = `${MOVIES}/Arrival (2016).md`;

const TEMPLATE = `# {{title}} ({{year}})

%% stremio %%
![poster]({{cover}})
Progress: {{progressPercent}}%
%% /stremio %%
`;

const options = (overrides: Partial<EngineOptions> = {}): EngineOptions => ({
	settings: { ...DEFAULT_SETTINGS, movieFolder: MOVIES, seriesFolder: 'Series', properties: { link: 'source' } },
	index: {},
	templates: { movie: TEMPLATE, series: '' },
	...overrides,
});

function movie(overrides: Partial<NormalizedMedia> = {}): NormalizedMedia {
	return {
		id: 'tt0167260',
		type: 'movie',
		title: 'Arrival',
		year: 2016,
		yearStart: 2016,
		yearEnd: 2016,
		cover: 'https://image.tmdb.org/t/p/original//abc.jpg',
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

describe('managed block helpers', () => {
	const note = 'Text before\n\n%% stremio %%\nold\n%% /stremio %%\n\nText after\n';

	it('finds and reads the block', () => {
		expect(hasManagedBlock(note)).toBe(true);
		expect(readManagedBlock(note)).toBe('old');
	});

	it('replaces only what is between the markers', () => {
		const updated = replaceManagedBlock(note, 'new')!;
		expect(updated).toContain('Text before');
		expect(updated).toContain('Text after');
		expect(readManagedBlock(updated)).toBe('new');
		expect(updated).not.toContain('old');
	});

	it('returns null for a note with no block', () => {
		expect(replaceManagedBlock('# Title\n', 'x')).toBeNull();
		expect(readManagedBlock('# Title\n')).toBeNull();
	});

	it('ignores an unterminated block rather than eating the rest of the note', () => {
		expect(hasManagedBlock('%% stremio %%\nno end marker\n')).toBe(false);
	});

	it('appends a block at the end, leaving the body intact', () => {
		const appended = appendManagedBlock('# Title\n\nMy own notes.\n', 'generated');
		expect(appended).toContain('My own notes.');
		expect(readManagedBlock(appended)).toBe('generated');
	});

	it('extracts the raw block out of a template source', () => {
		expect(managedBlockTemplate(TEMPLATE)).toBe('![poster]({{cover}})\nProgress: {{progressPercent}}%');
		expect(managedBlockTemplate('# {{title}}\n')).toBeNull();
	});
});

describe('templates and existing notes', () => {
	const claimed = { source: webUrl('movie', 'tt0167260') };

	it('never renders the template over a note the user wrote', async () => {
		const vault = new FakeVault();
		const body = '# Arrival (2016)\n\nMy own paragraph.\n';
		vault.addNote(NOTE, body, claimed);

		await run(await buildPlan([movie()], vault, options()), vault);
		expect(vault.files.get(NOTE)).toBe(body);
	});

	it('adds the block only when the setting asks for it', async () => {
		const vault = new FakeVault();
		vault.addNote(NOTE, '# Arrival (2016)\n\nMy own paragraph.\n', claimed);

		const opted = options();
		opted.settings = { ...opted.settings, existingBodyMode: 'managed-block' };
		await run(await buildPlan([movie()], vault, opted), vault);

		const content = vault.files.get(NOTE)!;
		expect(content).toContain('My own paragraph.');
		expect(readManagedBlock(content)).toBe(
			'![poster](https://image.tmdb.org/t/p/original//abc.jpg)\nProgress: 100%',
		);
	});

	it('fills the block from the template, not from a built-in text', async () => {
		const vault = new FakeVault();
		vault.addNote(NOTE, '# Arrival\n\n%% stremio %%\nstale\n%% /stremio %%\n', claimed);

		await run(await buildPlan([movie()], vault, options()), vault);
		expect(readManagedBlock(vault.files.get(NOTE)!)).toContain('![poster](');
	});

	it('falls back to a progress summary when the template declares no block', async () => {
		const vault = new FakeVault();
		vault.addNote(NOTE, '# Arrival\n\n%% stremio %%\n\n%% /stremio %%\n', claimed);

		const plain = options({ templates: { movie: '# {{title}}\n', series: '' } });
		await run(await buildPlan([movie()], vault, plain), vault);
		expect(readManagedBlock(vault.files.get(NOTE)!)).toContain('Progress: **100%** (finished)');
	});

	it('refreshes a stale block on later syncs', async () => {
		const vault = new FakeVault();
		vault.addNote(NOTE, '# Arrival\n\n%% stremio %%\nProgress: 10%\n%% /stremio %%\n', claimed);

		await run(await buildPlan([movie()], vault, options()), vault);
		expect(vault.files.get(NOTE)).toContain('Progress: 100%');
		expect(vault.files.get(NOTE)).not.toContain('Progress: 10%');
	});

	it('is idempotent once the block matches', async () => {
		const vault = new FakeVault();
		vault.addNote(NOTE, '# Arrival\n\n%% stremio %%\nstale\n%% /stremio %%\n', claimed);

		const opted = options();
		opted.settings = { ...opted.settings, existingBodyMode: 'managed-block' };
		await run(await buildPlan([movie()], vault, opted), vault);
		expect(planIsEmpty(await buildPlan([movie()], vault, opted))).toBe(true);
	});
});

describe('rewriting the body from the template', () => {
	const claimed = { source: webUrl('movie', 'tt0167260') };
	const rewriting = (): EngineOptions => {
		const opts = options();
		opts.settings = { ...opts.settings, existingBodyMode: 'rewrite' };
		return opts;
	};

	it('replaces the body with the rendered template', async () => {
		const vault = new FakeVault();
		vault.addNote(NOTE, '# Old heading\n\nOld paragraph.\n', claimed);

		const plan = await buildPlan([movie()], vault, rewriting());
		expect(plan.update.map((operation) => operation.kind)).toContain('rewrite-body');

		await run(plan, vault);
		const content = vault.files.get(NOTE)!;
		expect(content).toContain('# Arrival (2016)');
		expect(content).toContain('![poster](https://image.tmdb.org/t/p/original//abc.jpg)');
		expect(content).not.toContain('Old paragraph.');
	});

	it('says plainly in the preview that it replaces the text', async () => {
		const vault = new FakeVault();
		vault.addNote(NOTE, '# Old\n', claimed);
		const plan = await buildPlan([movie()], vault, rewriting());
		const rewrite = plan.update.find((operation) => operation.kind === 'rewrite-body')!;
		expect(rewrite.describe()).toContain('replaces the current text');
	});

	it('leaves the frontmatter to the frontmatter editor', async () => {
		const vault = new FakeVault();
		vault.files.set(NOTE, '---\nstart: 2020-01-01\nmine: keep me\n---\n\nOld body.\n');
		vault.frontmatter.set(NOTE, { ...claimed, start: '2020-01-01', mine: 'keep me' });

		await run(await buildPlan([movie()], vault, rewriting()), vault);
		const content = vault.files.get(NOTE)!;
		expect(content.startsWith('---\nstart: 2020-01-01\nmine: keep me\n---\n')).toBe(true);
		expect(content).toContain('# Arrival (2016)');
		expect(content).not.toContain('Old body.');
	});

	it('proposes nothing once the body already matches', async () => {
		const vault = new FakeVault();
		vault.addNote(NOTE, '# Old\n', claimed);
		await run(await buildPlan([movie()], vault, rewriting()), vault);
		expect(planIsEmpty(await buildPlan([movie()], vault, rewriting()))).toBe(true);
	});

	it('carries the current watch state into the rewritten episode list', async () => {
		const vault = new FakeVault();
		const path = 'Series/Show (2020).md';
		vault.addNote(path, '# Show\n\n### Sezon 1\n\n1. [ ] Stary tytuł\n', {
			source: webUrl('series', 'tt1'),
		});

		const opts = rewriting();
		opts.templates = { movie: TEMPLATE, series: '# {{title}}\n\n{{> seasons}}\n' };

		const show = movie({
			id: 'tt1',
			type: 'series',
			title: 'Show',
			stremioUrl: webUrl('series', 'tt1'),
			seasons: [
				{
					number: 1,
					episodes: [
						{ season: 1, number: 1, videoId: 'tt1:1:1', title: 'Pilot', watched: true, current: false },
						{ season: 1, number: 2, videoId: 'tt1:1:2', title: 'Second', watched: false, current: false },
					],
				},
			],
		});

		await run(await buildPlan([show], vault, opts), vault);
		const content = vault.files.get(path)!;
		expect(content).toContain('1. [x] Pilot');
		expect(content).toContain('2. [ ] Second');
		expect(content).not.toContain('Stary tytuł');
	});

	it('does not emit a separate checkbox edit, because the rewrite already carries it', async () => {
		const vault = new FakeVault();
		const path = 'Series/Show (2020).md';
		vault.addNote(path, '# Show\n\n### Sezon 1\n\n1. [ ] Pilot\n', {
			source: webUrl('series', 'tt1'),
		});
		const opts = rewriting();
		opts.templates = { movie: TEMPLATE, series: '# {{title}}\n\n{{> seasons}}\n' };

		const show = movie({
			id: 'tt1',
			type: 'series',
			title: 'Show',
			stremioUrl: webUrl('series', 'tt1'),
			seasons: [
				{
					number: 1,
					episodes: [
						{ season: 1, number: 1, videoId: 'tt1:1:1', title: 'Pilot', watched: true, current: false },
					],
				},
			],
		});

		const plan = await buildPlan([show], vault, opts);
		const bodyOps = plan.update
			.map((operation) => operation.kind)
			.filter((kind) => kind !== 'update-frontmatter');
		expect(bodyOps).toEqual(['rewrite-body']);
	});

	it('leaves bodies alone in the default mode', async () => {
		const vault = new FakeVault();
		const body = '# Old heading\n\nOld paragraph.\n';
		vault.addNote(NOTE, body, claimed);
		await run(await buildPlan([movie()], vault, options()), vault);
		expect(vault.files.get(NOTE)).toBe(body);
	});
});
