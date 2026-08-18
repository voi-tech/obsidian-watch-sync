import { Modal, Setting, type App, type ButtonComponent } from 'obsidian';
import type { Operation, SyncPlan } from '../model/types';
import { allOperations, planSize, selectOperations } from '../model/types';
import { t } from '../i18n';

/** Which bucket a title falls into, for the counts row and the filter. */
type Category = 'create' | 'adopt' | 'update';

function categoryLabel(category: Category): string {
	return t(`preview.${category === 'create' ? 'new' : category === 'adopt' ? 'adopted' : 'updated'}`);
}

function kindLabel(kind: Operation['kind']): string {
	const key =
		kind === 'create-file'
			? 'create'
			: kind === 'adopt-note'
				? 'adopt'
				: kind === 'update-frontmatter'
					? 'properties'
					: kind === 'update-episodes'
						? 'episodes'
						: kind === 'append-season'
							? 'season'
							: kind === 'rewrite-body'
								? 'rewrite'
								: 'block';
	return t(`preview.kind.${key}`);
}

export interface TitleGroup {
	mediaId: string;
	title: string;
	path: string;
	category: Category;
	operations: Operation[];
}

/** What the user decided; `null` means they left the dialog without applying. */
export type PreviewDecision = { selection: SyncPlan; deselected: number } | null;

/**
 * Shows exactly the operations that will run and lets the user deselect any of
 * them. Nothing is written until confirmation here, and what runs is the subset
 * that stayed checked — deselected work is reported separately, not silently
 * dropped.
 *
 * The list is grouped by title rather than by category: one title can produce
 * several operations at once, and "sync this show or don't" is the decision a
 * person actually makes. The path sits on the group header so the operation
 * lines under it stay short instead of repeating it three times.
 */
export class PreviewModal extends Modal {
	private readonly selected = new Set<Operation>();
	private confirmed = false;
	private groups: TitleGroup[] = [];
	private summaryEl: HTMLElement | null = null;
	private emptyEl: HTMLElement | null = null;
	private applyButton: ButtonComponent | null = null;
	private filterText = '';
	private categoryFilter: Category | 'all' = 'all';
	private readonly rows = new Map<string, { el: HTMLElement; group: TitleGroup }>();
	private readonly groupCheckboxes = new Map<string, HTMLInputElement>();
	private readonly operationCheckboxes = new Map<Operation, HTMLInputElement>();

	constructor(
		app: App,
		private readonly plan: SyncPlan,
		private readonly warnings: string[],
		/** Called exactly once, however the dialog is left. */
		private readonly onDecision: (decision: PreviewDecision) => void,
	) {
		super(app);
		for (const operation of allOperations(plan)) this.selected.add(operation);
	}

	override onOpen(): void {
		const { contentEl } = this;
		this.setTitle(t('preview.title'));
		this.modalEl.addClass('stremio-sync-preview');

		this.groups = groupByTitle(this.plan);
		this.summaryEl = contentEl.createEl('p', { cls: 'stremio-sync-summary-line' });

		if (planSize(this.plan) > 0) {
			this.renderToolbar(contentEl);
			const list = contentEl.createDiv({ cls: 'stremio-sync-groups' });
			for (const group of this.groups) this.renderGroup(list, group);
			this.emptyEl = contentEl.createEl('p', {
				text: t('preview.empty'),
				cls: 'stremio-sync-note stremio-sync-empty',
			});
		}

		this.renderProblems(contentEl);
		this.renderFooter(contentEl);
		this.applyFilter();
		this.refreshSummary();
	}

	override onClose(): void {
		this.contentEl.empty();
		this.rows.clear();
		this.groupCheckboxes.clear();
		this.operationCheckboxes.clear();
		this.applyButton = null;
		this.summaryEl = null;
		this.emptyEl = null;

		if (!this.confirmed) {
			this.onDecision(null);
			return;
		}
		const selection = selectOperations(this.plan, (operation) => this.selected.has(operation));
		this.onDecision({ selection, deselected: planSize(this.plan) - planSize(selection) });
	}

	/** Counts, a category filter and a search box — three ways to cut 200 titles down. */
	private renderToolbar(containerEl: HTMLElement): void {
		const counts = containerEl.createDiv({ cls: 'stremio-sync-counts' });
		const chips: HTMLElement[] = [];

		const addChip = (key: Category | 'all', label: string, count: number): void => {
			const chip = counts.createEl('button', { cls: 'stremio-sync-chip' });
			chip.createSpan({ text: label });
			chip.createSpan({ text: String(count), cls: 'stremio-sync-chip-count' });
			if (this.categoryFilter === key) chip.addClass('is-active');
			chips.push(chip);
			chip.addEventListener('click', () => {
				this.categoryFilter = key;
				for (const other of chips) other.removeClass('is-active');
				chip.addClass('is-active');
				this.applyFilter();
			});
		};

			addChip('all', t('preview.all'), this.groups.length);
			for (const category of ['create', 'adopt', 'update'] as const) {
				const count = this.groups.filter((group) => group.category === category).length;
				if (count > 0) addChip(category, categoryLabel(category), count);
		}

		const input = containerEl
			.createDiv({ cls: 'stremio-sync-search' })
				.createEl('input', { type: 'search', placeholder: t('preview.filter') });
		input.addEventListener('input', () => {
			this.filterText = input.value.trim().toLowerCase();
			this.applyFilter();
		});

		new Setting(containerEl)
			.setClass('stremio-sync-bulk')
				.setDesc(t('preview.unchecked'))
				.addButton((button) => button.setButtonText(t('preview.selectAll')).onClick(() => this.setAll(true)))
				.addButton((button) => button.setButtonText(t('preview.selectNone')).onClick(() => this.setAll(false)));
	}

	private renderGroup(container: HTMLElement, group: TitleGroup): void {
		const groupEl = container.createDiv({ cls: 'stremio-sync-group' });

		const header = groupEl.createEl('label', { cls: 'stremio-sync-group-header' });
		const groupBox = header.createEl('input', { type: 'checkbox' });
		groupBox.checked = true;

		const text = header.createDiv({ cls: 'stremio-sync-group-text' });
		text.createDiv({ text: group.title, cls: 'stremio-sync-group-title' });
		text.createDiv({ text: group.path, cls: 'stremio-sync-group-path' });
		header.createSpan({ text: categoryLabel(group.category), cls: 'stremio-sync-group-badge' });

		this.groupCheckboxes.set(group.mediaId, groupBox);
		this.rows.set(group.mediaId, { el: groupEl, group });

		groupBox.addEventListener('change', () => {
			for (const operation of group.operations) {
				this.toggle(operation, groupBox.checked);
				const box = this.operationCheckboxes.get(operation);
				if (box) box.checked = groupBox.checked;
			}
			groupBox.indeterminate = false;
			this.refreshSummary();
		});

		const rows = groupEl.createEl('ul', { cls: 'stremio-sync-operations' });
		for (const operation of group.operations) {
			const label = rows.createEl('li').createEl('label');
			const box = label.createEl('input', { type: 'checkbox' });
			box.checked = true;
			label.createSpan({ text: kindLabel(operation.kind), cls: 'stremio-sync-kind' });
			label.createSpan({ text: operation.summary(), cls: 'stremio-sync-op-text' });
			this.operationCheckboxes.set(operation, box);

			box.addEventListener('change', () => {
				this.toggle(operation, box.checked);
				this.refreshGroupCheckbox(group);
				this.refreshSummary();
			});
		}
	}

	private applyFilter(): void {
		let visible = 0;
		for (const { el, group } of this.rows.values()) {
			const show = this.matches(group);
			el.toggleClass('is-hidden', !show);
			if (show) visible += 1;
		}
		this.emptyEl?.toggleClass('is-hidden', visible > 0 || this.rows.size === 0);
	}

	private matches(group: TitleGroup): boolean {
		if (this.categoryFilter !== 'all' && group.category !== this.categoryFilter) return false;
		if (!this.filterText) return true;
		return (
			group.title.toLowerCase().includes(this.filterText) ||
			group.path.toLowerCase().includes(this.filterText)
		);
	}

	private toggle(operation: Operation, on: boolean): void {
		if (on) this.selected.add(operation);
		else this.selected.delete(operation);
	}

	/** Bulk actions apply to what the filter is showing, not to the whole plan. */
	private setAll(on: boolean): void {
		for (const { group } of this.rows.values()) {
			if (!this.matches(group)) continue;
			for (const operation of group.operations) {
				this.toggle(operation, on);
				const box = this.operationCheckboxes.get(operation);
				if (box) box.checked = on;
			}
			const groupBox = this.groupCheckboxes.get(group.mediaId);
			if (groupBox) {
				groupBox.checked = on;
				groupBox.indeterminate = false;
			}
		}
		this.refreshSummary();
	}

	private refreshGroupCheckbox(group: TitleGroup): void {
		const box = this.groupCheckboxes.get(group.mediaId);
		if (!box) return;
		const chosen = group.operations.filter((operation) => this.selected.has(operation)).length;
		box.checked = chosen > 0;
		box.indeterminate = chosen > 0 && chosen < group.operations.length;
	}

	private refreshSummary(): void {
		if (!this.summaryEl) return;
		const total = planSize(this.plan);
		if (total === 0) {
			this.summaryEl.setText(t('preview.nothing'));
			return;
		}

		const chosen = this.selected.size;
		const titles = this.groups.filter((group) =>
			group.operations.some((operation) => this.selected.has(operation)),
		).length;

		this.summaryEl.setText(
			chosen === 0
				? t('preview.noneSelected')
				: t('preview.selected', { chosen, total, titles }),
		);
		this.applyButton?.setDisabled(chosen === 0);
		this.applyButton?.setButtonText(
			chosen === total ? t('preview.apply') : t('preview.applySelected', { chosen }),
		);
	}

	/** Anything the user cannot act on, folded away so it never buries the list. */
	private renderProblems(containerEl: HTMLElement): void {
		const sections: { title: string; items: string[]; warning?: boolean }[] = [
			{
				title: t('preview.conflicts'),
				items: this.plan.conflicts.map(
					(conflict) => `${conflict.title}: ${conflict.reason} → ${conflict.candidates.join(', ')}`,
				),
				warning: true,
			},
			{ title: t('preview.skipped'), items: this.plan.skipped.map((s) => `${s.title}: ${s.reason}`) },
			{ title: t('preview.warnings'), items: this.warnings },
		];

		for (const section of sections) {
			if (section.items.length === 0) continue;
			const details = containerEl.createEl('details', { cls: 'stremio-sync-details' });
			details.createEl('summary', { text: `${section.title} (${section.items.length})` });
			const list = details.createEl('ul', {
				cls: section.warning ? 'stremio-sync-list mod-warning' : 'stremio-sync-list',
			});
			for (const item of section.items.slice(0, 100)) list.createEl('li', { text: item });
			if (section.items.length > 100) {
				details.createEl('p', {
					text: t('preview.more', { count: section.items.length - 100 }),
					cls: 'stremio-sync-note',
				});
			}
		}
	}

	private renderFooter(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setClass('stremio-sync-footer')
			.addButton((button) => {
				this.applyButton = button;
				button
					.setButtonText(t('preview.apply'))
					.setCta()
					.onClick(() => {
						this.confirmed = this.selected.size > 0;
						this.close();
					});
			})
			.addButton((button) => button.setButtonText(t('preview.cancel')).onClick(() => this.close()));
	}
}

/**
 * One group per title. Operations for the same item can span several categories
 * — adopting a note and ticking its episodes, say — so the group takes the
 * strongest one: creating outranks adopting, which outranks a plain update.
 */
export function groupByTitle(plan: SyncPlan): TitleGroup[] {
	const categories = new Map<string, Category>();
	for (const [category, operations] of [
		['update', plan.update],
		['adopt', plan.adopt],
		['create', plan.create],
	] as const) {
		for (const operation of operations) categories.set(operation.mediaId, category);
	}

	const groups = new Map<string, TitleGroup>();
	for (const operation of allOperations(plan)) {
		const existing = groups.get(operation.mediaId);
		if (existing) {
			existing.operations.push(operation);
			continue;
		}
		groups.set(operation.mediaId, {
			mediaId: operation.mediaId,
			title: operation.title,
			path: operation.path,
			category: categories.get(operation.mediaId) ?? 'update',
			operations: [operation],
		});
	}

	return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title, 'pl'));
}
