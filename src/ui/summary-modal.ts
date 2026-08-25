import { Modal, type App } from 'obsidian';
import type { LibraryItem } from '../model/schema';
import { isSupportedType, selectRelevant, type SelectionOptions } from '../stremio/api';
import { titleWatchStatus } from '../stremio/watch-status';
import { t } from '../i18n';

export interface LibrarySummary {
	total: number;
	movies: number;
	series: number;
	watched: number;
	inProgress: number;
	sampled: number;
	neverPlayed: number;
	willSync: number;
	tmdbIds: number;
	sampledExamples: { name: string; minutes: number }[];
	newest: { name: string; when: string }[];
}

/**
 * Read-only picture of the library, including how many titles fall in each watch
 * state. The sampled count and its examples are the point: they show what the
 * "only opened it briefly" rule is about to exclude.
 */
export function summarize(items: LibraryItem[], options: SelectionOptions): LibrarySummary {
	const supported = items.filter(isSupportedType);
	const summary: LibrarySummary = {
		total: supported.length,
		movies: 0,
		series: 0,
		watched: 0,
		inProgress: 0,
		sampled: 0,
		neverPlayed: 0,
		willSync: selectRelevant(items, options).length,
		tmdbIds: 0,
		sampledExamples: [],
		newest: [],
	};

	const sampled: { name: string; minutes: number }[] = [];

	for (const item of supported) {
		if (item.type === 'movie') summary.movies += 1;
		if (item.type === 'series') summary.series += 1;
		if (item._id.startsWith('tmdb:')) summary.tmdbIds += 1;

		const status = titleWatchStatus(item, options);
		if (status === 'watched') summary.watched += 1;
		else if (status === 'in-progress') summary.inProgress += 1;
		else if (status === 'sampled') {
			summary.sampled += 1;
			const state = item.state ?? {};
			const ms = Math.max(state.timeWatched ?? 0, state.timeOffset ?? 0, state.overallTimeWatched ?? 0);
			sampled.push({ name: item.name, minutes: ms / 60_000 });
		} else summary.neverPlayed += 1;
	}

	summary.sampledExamples = sampled.sort((a, b) => a.minutes - b.minutes).slice(0, 8);

	summary.newest = supported
		.filter((item) => item.state?.lastWatched)
		.sort((a, b) => (b.state.lastWatched ?? '').localeCompare(a.state.lastWatched ?? ''))
		.slice(0, 10)
		.map((item) => ({ name: item.name, when: (item.state.lastWatched ?? '').slice(0, 10) }));

	return summary;
}

export class SummaryModal extends Modal {
	constructor(
		app: App,
		private readonly summary: LibrarySummary,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		this.setTitle(t('summary.title'));

		const rows: [string, string][] = [
			[t('summary.total'), String(this.summary.total)],
			[t('summary.movies'), String(this.summary.movies)],
			[t('summary.series'), String(this.summary.series)],
			[t('summary.watched'), String(this.summary.watched)],
			[t('summary.inProgress'), String(this.summary.inProgress)],
			[t('summary.sampled'), String(this.summary.sampled)],
			[t('summary.neverPlayed'), String(this.summary.neverPlayed)],
			[t('summary.willSync'), String(this.summary.willSync)],
			[t('summary.tmdbIds'), String(this.summary.tmdbIds)],
		];

		const table = contentEl.createEl('table', { cls: 'watch-sync-summary' });
		for (const [label, value] of rows) {
			const tr = table.createEl('tr');
			tr.createEl('td', { text: label });
			tr.createEl('td', { text: value });
		}

		if (this.summary.sampledExamples.length > 0) {
			contentEl.createEl('h4', { text: t('summary.sampledHeading') });
			const list = contentEl.createEl('ul');
			for (const entry of this.summary.sampledExamples) {
				list.createEl('li', { text: `${entry.name} — ${entry.minutes.toFixed(1)} min` });
			}
		}

		if (this.summary.newest.length > 0) {
			contentEl.createEl('h4', { text: t('summary.recentHeading') });
			const list = contentEl.createEl('ol');
			for (const entry of this.summary.newest) {
				list.createEl('li', { text: `${entry.name} — ${entry.when}` });
			}
		}

		contentEl.createEl('p', {
			text: t('summary.readOnly'),
			cls: 'watch-sync-note',
		});
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
