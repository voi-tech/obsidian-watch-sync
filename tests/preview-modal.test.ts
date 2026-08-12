/**
 * @vitest-environment jsdom
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PreviewModal, groupByTitle, type PreviewDecision } from '../src/ui/preview-modal';
import { emptyPlan, planSize, type Operation, type SyncPlan } from '../src/model/types';
import { installObsidianDom } from './stubs/dom';

beforeAll(() => {
	installObsidianDom();
});

function op(
	kind: Operation['kind'],
	mediaId: string,
	title: string,
	path: string,
	summary: string,
): Operation {
	return {
		kind,
		mediaId,
		title,
		path,
		summary: () => summary,
		describe: () => `${summary} — ${path}`,
	};
}

function samplePlan(): SyncPlan {
	const plan = emptyPlan();
	plan.create.push(op('create-file', 'tt1', 'Arrival', 'Movies/Arrival (2016).md', 'Create the note'));
	plan.adopt.push(
		op('adopt-note', 'tt2', 'Severance', 'Series/Severance (2022-2025).md', 'Adopt this note'),
	);
	plan.update.push(
		op(
			'update-episodes',
			'tt2',
			'Severance',
			'Series/Severance (2022-2025).md',
			'Episodes: tick 9 · S1E1, S1E2, S1E3 +6',
		),
	);
	plan.update.push(op('update-frontmatter', 'tt3', 'Zodiac', 'Movies/Zodiac (2007).md', 'Properties: end'));
	plan.conflicts.push({ mediaId: 'tt4', title: 'Alien', reason: 'two candidates', candidates: ['a', 'b'] });
	plan.skipped.push({ mediaId: 'tt5', title: 'Dune', reason: 'no episode list' });
	return plan;
}

function open(plan: SyncPlan, warnings: string[] = []) {
	const decisions: PreviewDecision[] = [];
	const modal = new PreviewModal({} as never, plan, warnings, (decision) => decisions.push(decision));
	modal.open();
	const root = modal.contentEl;
	return {
		modal,
		root,
		decisions,
		groups: () => Array.from(root.querySelectorAll('.stremio-sync-group')),
		visibleGroups: () =>
			Array.from(root.querySelectorAll('.stremio-sync-group')).filter(
				(el) => !el.classList.contains('is-hidden'),
			),
		summary: () => root.querySelector('.stremio-sync-summary-line')?.textContent ?? '',
		chips: () => Array.from(root.querySelectorAll<HTMLButtonElement>('.stremio-sync-chip')),
		search: () => root.querySelector<HTMLInputElement>('.stremio-sync-search input')!,
		applyButton: () =>
			Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
				b.textContent?.startsWith('Apply'),
			)!,
	};
}

describe('groupByTitle', () => {
	it('gives a title one group even when its operations span categories', () => {
		const groups = groupByTitle(samplePlan());
		const severance = groups.find((group) => group.title === 'Severance')!;
		expect(severance.operations).toHaveLength(2);
	});

	it('labels a group by its strongest category', () => {
		const groups = groupByTitle(samplePlan());
		expect(groups.find((g) => g.title === 'Arrival')!.category).toBe('create');
		// Adopting outranks the episode update that comes with it.
		expect(groups.find((g) => g.title === 'Severance')!.category).toBe('adopt');
		expect(groups.find((g) => g.title === 'Zodiac')!.category).toBe('update');
	});

	it('carries the path so the rows below do not have to repeat it', () => {
		expect(groupByTitle(samplePlan())[0].path).toBe('Movies/Arrival (2016).md');
	});
});

describe('preview layout', () => {
	it('shows the path once per title, not once per operation', () => {
		const ui = open(samplePlan());
		const severance = ui.groups().find((el) => el.textContent?.includes('Severance'))!;
		const occurrences = severance.textContent.split('Series/Severance (2022-2025).md').length - 1;
		expect(occurrences).toBe(1);
	});

	it('lists operations by their short summary', () => {
		const ui = open(samplePlan());
		const texts = Array.from(ui.root.querySelectorAll('.stremio-sync-op-text')).map((el) => el.textContent);
		expect(texts).toContain('Create the note');
		expect(texts.every((text) => !text?.includes('.md'))).toBe(true);
	});

	it('counts titles per category in the chips', () => {
		const ui = open(samplePlan());
		expect(ui.chips().map((chip) => chip.textContent)).toEqual([
			'All3',
			'New notes1',
			'Adopted1',
			'Updated1',
		]);
	});

	it('folds conflicts, skips and warnings away instead of burying the list', () => {
		const ui = open(samplePlan(), ['tt9: no data from TMDB']);
		const summaries = Array.from(ui.root.querySelectorAll('details summary')).map((el) => el.textContent);
		expect(summaries).toEqual(['Conflicts — skipped (1)', 'Skipped (1)', 'Metadata warnings (1)']);
	});

	it('says nothing is to be done for an empty plan', () => {
		const ui = open(emptyPlan());
		expect(ui.summary()).toContain('Nothing to do');
		expect(ui.groups()).toHaveLength(0);
	});
});

describe('filtering', () => {
	it('narrows the list by title', () => {
		const ui = open(samplePlan());
		ui.search().value = 'sever';
		ui.search().dispatchEvent(new Event('input'));
		expect(ui.visibleGroups()).toHaveLength(1);
	});

	it('narrows the list by path', () => {
		const ui = open(samplePlan());
		ui.search().value = 'movies/';
		ui.search().dispatchEvent(new Event('input'));
		expect(ui.visibleGroups().map((el) => el.textContent?.includes('Arrival'))).toContain(true);
		expect(ui.visibleGroups()).toHaveLength(2);
	});

	it('narrows the list by category', () => {
		const ui = open(samplePlan());
		ui.chips().find((chip) => chip.textContent?.startsWith('New notes'))!.click();
		expect(ui.visibleGroups()).toHaveLength(1);
	});

	it('tells the user when a filter matches nothing', () => {
		const ui = open(samplePlan());
		ui.search().value = 'nothing at all';
		ui.search().dispatchEvent(new Event('input'));
		expect(ui.root.querySelector('.stremio-sync-empty')?.classList.contains('is-hidden')).toBe(false);
	});

	it('does not change what is selected', () => {
		const plan = samplePlan();
		const ui = open(plan);
		ui.search().value = 'sever';
		ui.search().dispatchEvent(new Event('input'));
		expect(ui.summary()).toContain(`${planSize(plan)} of ${planSize(plan)}`);
	});
});

describe('selection', () => {
	it('applies bulk actions only to what the filter shows', () => {
		const plan = samplePlan();
		const ui = open(plan);
		ui.search().value = 'sever';
		ui.search().dispatchEvent(new Event('input'));

		const selectNone = Array.from(ui.root.querySelectorAll<HTMLButtonElement>('button')).find(
			(b) => b.textContent === 'Select none',
		)!;
		selectNone.click();

		// Severance contributed two operations; the other two titles keep theirs.
		expect(ui.summary()).toContain('2 of 4 operations selected');
	});

	it('reports the deselected count when applying', () => {
		const plan = samplePlan();
		const ui = open(plan);
		const firstBox = ui.root.querySelector<HTMLInputElement>('.stremio-sync-operations input')!;
		firstBox.checked = false;
		firstBox.dispatchEvent(new Event('change'));

		ui.applyButton().click();
		expect(ui.decisions[0]).toMatchObject({ deselected: 1 });
		expect(planSize(ui.decisions[0]!.selection)).toBe(3);
	});

	it('disables Apply when nothing is selected', () => {
		const ui = open(samplePlan());
		Array.from(ui.root.querySelectorAll<HTMLButtonElement>('button'))
			.find((b) => b.textContent === 'Select none')!
			.click();
		expect(ui.applyButton().disabled).toBe(true);
		expect(ui.summary()).toContain('Nothing is selected');
	});

	it('marks a partly selected group as indeterminate', () => {
		const ui = open(samplePlan());
		const severance = ui.groups().find((el) => el.textContent?.includes('Severance'))!;
		const opBox = severance.querySelector<HTMLInputElement>('.stremio-sync-operations input')!;
		opBox.checked = false;
		opBox.dispatchEvent(new Event('change'));

		const groupBox = severance.querySelector<HTMLInputElement>('.stremio-sync-group-header input')!;
		expect(groupBox.indeterminate).toBe(true);
	});

	it('reports a dismissal as no decision at all', () => {
		const ui = open(samplePlan());
		const cancel = Array.from(ui.root.querySelectorAll<HTMLButtonElement>('button')).find(
			(b) => b.textContent === 'Cancel',
		)!;
		cancel.click();
		expect(ui.decisions).toEqual([null]);
	});

	it('calls back exactly once', () => {
		const onDecision = vi.fn();
		const modal = new PreviewModal({} as never, samplePlan(), [], onDecision);
		modal.open();
		modal.close();
		expect(onDecision).toHaveBeenCalledTimes(1);
	});
});
