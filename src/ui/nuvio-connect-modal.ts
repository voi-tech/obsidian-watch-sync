import { Modal, Notice, Setting, type App } from 'obsidian';
import {
	beginNuvioTvLogin,
	discoverNuvioBackend,
	exchangeNuvioTvLogin,
	pollNuvioTvLogin,
	type NuvioBackend,
	type NuvioSession,
} from '../nuvio/api';
import { t } from '../i18n';

export class NuvioConnectModal extends Modal {
	private timer: number | null = null;
	private closed = false;

	constructor(
		app: App,
		private readonly backendUrl: string,
		private readonly onConnected: (session: NuvioSession) => Promise<void>,
	) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle(t('nuvio.connect.title'));
		void this.begin();
	}

	override onClose(): void {
		this.closed = true;
		this.stopPolling();
		this.contentEl.empty();
	}

	private stopPolling(): void {
		if (this.timer === null) return;
		window.clearInterval(this.timer);
		this.timer = null;
	}

	private async begin(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.createEl('p', { text: t('nuvio.connect.preparing') });

		try {
			const backend = await discoverNuvioBackend(this.backendUrl);
			const nonce = crypto.randomUUID();
			const challenge = await beginNuvioTvLogin(backend, nonce, 'Obsidian');

			this.contentEl.empty();
			this.contentEl.createEl('p', { text: t('nuvio.connect.approve') });
			this.contentEl.createEl('p', { text: t('connect.waiting') });

			new Setting(this.contentEl)
				.addButton((button) =>
					button
						.setButtonText(t('nuvio.connect.open'))
						.setCta()
						.onClick(() => window.open(challenge.loginUrl, '_blank', 'noopener,noreferrer')),
				)
				.addButton((button) => button.setButtonText(t('connect.cancel')).onClick(() => this.close()));

			this.timer = window.setInterval(
				() => void this.poll(backend, challenge.callerAccessToken, challenge.code, nonce),
				challenge.pollIntervalMs,
			);
		} catch (error) {
			this.showError(error);
		}
	}

	private async poll(backend: NuvioBackend, caller: string, code: string, nonce: string): Promise<void> {
		if (this.closed) return;

		try {
			const status = await pollNuvioTvLogin(backend, caller, code, nonce);
			if (status === 'pending') return;
			if (status === 'expired') throw new Error(t('nuvio.connect.expired'));

			this.stopPolling();
			await this.onConnected(await exchangeNuvioTvLogin(backend, caller, code, nonce));
			if (this.closed) return;

			new Notice(t('nuvio.connect.connected'));
			this.close();
		} catch (error) {
			if (!this.closed) this.showError(error);
		}
	}

	private showError(error: unknown): void {
		this.stopPolling();
		this.contentEl.empty();
		this.contentEl.createEl('p', {
			text: error instanceof Error ? error.message : String(error),
			cls: 'watch-sync-connect-error',
		});
		new Setting(this.contentEl).addButton((button) =>
			button.setButtonText(t('connect.retry')).setCta().onClick(() => void this.begin()),
		);
	}
}
