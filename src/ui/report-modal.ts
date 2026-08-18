import { Modal, type App } from 'obsidian';
import type { SyncResult } from '../model/types';
import { t } from '../i18n';

export class ReportModal extends Modal {
	constructor(
		app: App,
		private readonly result: SyncResult,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		this.setTitle(t('report.title'));

		const rows: [string, string][] = [
			[t('report.created'), String(this.result.created)],
			[t('report.adopted'), String(this.result.adopted)],
			[t('report.updated'), String(this.result.updated)],
			[t('report.skipped'), String(this.result.skipped)],
			[t('report.deselected'), String(this.result.deselected)],
			[t('report.errors'), String(this.result.errors.length)],
			[t('report.duration'), `${(this.result.durationMs / 1000).toFixed(1)} s`],
		];

		const table = contentEl.createEl('table', { cls: 'stremio-sync-summary' });
		for (const [label, value] of rows) {
			const tr = table.createEl('tr');
			tr.createEl('td', { text: label });
			tr.createEl('td', { text: value });
		}

		if (this.result.errors.length > 0) {
			contentEl.createEl('h4', { text: t('report.errors') });
			const list = contentEl.createEl('ul', { cls: 'stremio-sync-list mod-warning' });
			for (const error of this.result.errors) {
				list.createEl('li', { text: error.message });
			}
		}
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
