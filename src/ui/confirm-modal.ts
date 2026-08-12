import { Modal, Setting, type App } from 'obsidian';

/** Yes/no for an action that cannot be undone by pressing the same button again. */
export class ConfirmModal extends Modal {
	private confirmed = false;

	constructor(
		app: App,
		private readonly options: {
			title: string;
			message: string;
			confirmText: string;
			onConfirm: () => void | Promise<void>;
		},
	) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle(this.options.title);
		this.contentEl.createEl('p', { text: this.options.message });

		new Setting(this.contentEl)
			.addButton((button) => {
				button.buttonEl.addClass('mod-warning');
				button.setButtonText(this.options.confirmText).onClick(() => {
						this.confirmed = true;
						this.close();
					});
			})
			.addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()));
	}

	override onClose(): void {
		this.contentEl.empty();
		if (this.confirmed) void this.options.onConfirm();
	}
}
