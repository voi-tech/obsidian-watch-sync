import { Modal, Notice, Setting, type App } from 'obsidian';
import { createLinkCode, readLinkAuthKey, type LinkCode } from '../stremio/link';
import { t } from '../i18n';

const POLL_INTERVAL_MS = 2000;
const TIMEOUT_MS = 3 * 60 * 1000;

/**
 * Walks the user through Stremio's pairing flow: show a short code, open the
 * approval page, and wait for the key to come back. The alternative is asking
 * someone to paste a snippet into a browser console, which is not a thing a
 * plugin should require.
 */
export class ConnectModal extends Modal {
	private link: LinkCode | null = null;
	private timer: number | null = null;
	private startedAt = 0;
	private statusEl: HTMLElement | null = null;
	private done = false;
	private polling = false;
	private closed = false;
	private readonly handleVisibilityChange = (): void => {
		if (document.visibilityState === 'hidden') return;
		void this.poll();
	};

	constructor(
		app: App,
		private readonly onKey: (authKey: string) => Promise<void>,
	) {
		super(app);
	}

	override onOpen(): void {
		this.closed = false;
		document.addEventListener('visibilitychange', this.handleVisibilityChange);
		this.setTitle(t('connect.title'));
		this.modalEl.addClass('stremio-sync-connect');
		void this.begin();
	}

	override onClose(): void {
		this.closed = true;
		document.removeEventListener('visibilitychange', this.handleVisibilityChange);
		this.stopPolling();
		this.contentEl.empty();
	}

	private async begin(): Promise<void> {
		this.stopPolling();
		this.done = false;
		this.polling = false;
		this.statusEl = null;
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('p', { text: t('connect.generating'), cls: 'stremio-sync-note' });

		try {
			this.link = await createLinkCode();
		} catch (error) {
			contentEl.empty();
			contentEl.createEl('p', {
				text: error instanceof Error ? error.message : String(error),
				cls: 'stremio-sync-connect-error',
			});
			new Setting(contentEl).addButton((button) =>
				button
					.setButtonText(t('connect.retry'))
					.setCta()
					.onClick(() => void this.begin()),
			);
			return;
		}

		contentEl.empty();
		contentEl.createEl('p', {
			text: t('connect.approve'),
		});

		contentEl.createDiv({ cls: 'stremio-sync-code', text: this.link.code });

		const steps = contentEl.createEl('ol', { cls: 'stremio-sync-steps' });
		steps.createEl('li', { text: t('connect.step.open') });
		steps.createEl('li', { text: t('connect.step.check') });
		steps.createEl('li', { text: t('connect.step.return') });

		this.statusEl = contentEl.createEl('p', {
			text: t('connect.waiting'),
			cls: 'stremio-sync-note',
		});

		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText(t('connect.open'))
					.setCta()
					.onClick(() => {
						if (this.link) window.open(this.link.link, '_blank', 'noopener,noreferrer');
					}),
			)
			.addButton((button) =>
					button.setButtonText(t('connect.copy')).onClick(() => {
					if (!this.link) return;
					void navigator.clipboard.writeText(this.link.link).then(
						() => new Notice(t('connect.linkCopied')),
						() => new Notice(t('clipboard.failed')),
					);
				}),
			)
			.addButton((button) => button.setButtonText(t('connect.cancel')).onClick(() => this.close()));

		this.startPolling();
	}

	private startPolling(): void {
		this.startedAt = Date.now();
		this.timer = window.setInterval(() => void this.poll(), POLL_INTERVAL_MS);
	}

	private stopPolling(): void {
		if (this.timer === null) return;
		window.clearInterval(this.timer);
		this.timer = null;
	}

	private async poll(): Promise<void> {
		if (!this.link || this.done || this.polling || this.closed) return;

		if (Date.now() - this.startedAt > TIMEOUT_MS) {
			this.stopPolling();
			this.statusEl?.setText(t('connect.expired'));
			this.statusEl?.addClass('stremio-sync-connect-error');
			return;
		}

		this.polling = true;
		try {
			const authKey = await readLinkAuthKey(this.link.code);
			if (!authKey || this.closed || this.done) return;

			this.done = true;
			this.stopPolling();
			await this.onKey(authKey);
			if (this.closed) return;
				new Notice(t('connect.connected'));
			this.close();
		} catch (error) {
			if (this.closed) return;
			this.done = false;
			this.stopPolling();
			this.showPollingError(error);
		} finally {
			this.polling = false;
		}
	}

	private showPollingError(error: unknown): void {
		this.statusEl?.setText(error instanceof Error ? error.message : String(error));
		this.statusEl?.addClass('stremio-sync-connect-error');
		new Setting(this.contentEl).addButton((button) =>
			button
					.setButtonText(t('connect.retry'))
				.setCta()
				.onClick(() => void this.begin()),
		);
	}
}
