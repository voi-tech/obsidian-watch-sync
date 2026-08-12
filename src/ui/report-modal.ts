import { Modal, type App } from 'obsidian';
import type { SyncResult } from '../model/types';

export class ReportModal extends Modal {
	constructor(
		app: App,
		private readonly result: SyncResult,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		this.setTitle('Stremio Sync — report');

		const rows: [string, string][] = [
			['Created', String(this.result.created)],
			['Adopted', String(this.result.adopted)],
			['Updated', String(this.result.updated)],
			['Skipped', String(this.result.skipped)],
			['Deselected', String(this.result.deselected)],
			['Errors', String(this.result.errors.length)],
			['Duration', `${(this.result.durationMs / 1000).toFixed(1)} s`],
		];

		const table = contentEl.createEl('table', { cls: 'stremio-sync-summary' });
		for (const [label, value] of rows) {
			const tr = table.createEl('tr');
			tr.createEl('td', { text: label });
			tr.createEl('td', { text: value });
		}

		if (this.result.errors.length > 0) {
			contentEl.createEl('h4', { text: 'Errors' });
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
