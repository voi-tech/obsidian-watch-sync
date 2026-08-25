import { Notice, Platform, Plugin } from 'obsidian';
import { configurationProblem } from './configuration';
import { DERIVED_SCHEMA_VERSION, MetadataCache } from './meta/cache';
import {
	planSize,
	selectionOptionsOf,
	type PluginData,
	type RecentEvent,
	type SyncPlan,
} from './model/types';
import { sanitizePluginData } from './model/plugin-data';
import { MissingSecretError, readSecret } from './secrets';
import { WatchSyncSettingTab } from './settings';
import { StremioApiError } from './stremio/api';
import { SyncService } from './sync/service';
import { TemplateError } from './vault/template';
import { ObsidianVaultGateway } from './vault/writer';
import { PreviewModal } from './ui/preview-modal';
import { summarize, SummaryModal } from './ui/summary-modal';
import { t } from './i18n';
import { discoverNuvioBackend, ensureNuvioSession, fetchNuvioProfiles, type NuvioProfile, type NuvioSession } from './nuvio/api';

const NUVIO_SESSION_SECRET_ID = 'stremio-sync-nuvio-session';

const MIN_AUTO_SYNC_MINUTES = 15;

export default class WatchSyncPlugin extends Plugin {
	data: PluginData = sanitizePluginData(null);
	private cache!: MetadataCache;
	private gateway!: ObsidianVaultGateway;
	private autoSyncTimer: number | null = null;
	/** Unit tests and settings edits can use the timer before onload; the real lifecycle flips this off until layout is ready. */
	private layoutReady = true;
	private readyPromise: Promise<void> = Promise.resolve();
	/** Guards the whole fetch → plan → write cycle, including the modal detour. */
	private busy = false;
	nuvioProfiles: NuvioProfile[] = [];

	override async onload(): Promise<void> {
		await this.loadPluginData();
		this.layoutReady = false;

		this.gateway = new ObsidianVaultGateway(this.app);
		// `manifest.dir` is optional in the API; without it the cache simply stays
		// in memory for the session rather than writing to a bogus path.
		this.cache = new MetadataCache(
			this.app.vault.adapter,
			this.manifest.dir ? `${this.manifest.dir}/cache.json` : '',
			`${DERIVED_SCHEMA_VERSION}:${this.manifest.version}`,
		);
		this.readyPromise = new Promise<void>((resolve) => {
			this.app.workspace.onLayoutReady(() => {
				void this.initializeAfterLayout().then(resolve, (error) => {
					this.reportError(error);
					this.layoutReady = true;
					this.restartAutoSync();
					resolve();
				});
			});
		});

		this.addSettingTab(new WatchSyncSettingTab(this));

		this.addRibbonIcon('clapperboard', t('app.ribbon'), () => {
			void this.sync();
		});

		this.addCommand({ id: 'sync', name: t('command.sync'), callback: () => void this.sync() });
		this.addCommand({
			id: 'preview',
			name: t('command.preview'),
			callback: () => void this.sync({ previewOnly: true }),
		});
		this.addCommand({
			id: 'show-library-summary',
			name: t('command.summary'),
			callback: () => void this.showLibrarySummary(),
		});
		this.addCommand({
			id: 'clear-metadata-cache',
			name: t('command.cache'),
			callback: () => void this.clearMetadataCache(),
		});

	}

	override onunload(): void {
		this.layoutReady = false;
		this.clearAutoSync();
	}

	private async loadPluginData(): Promise<void> {
		this.data = sanitizePluginData(await this.loadData());
	}

	/** Persists settings and caches. Secret values never reach this file. */
	async persist(): Promise<void> {
		await this.saveData(this.data);
	}

	async saveNuvioSession(session: NuvioSession): Promise<void> {
		this.app.secretStorage.setSecret(NUVIO_SESSION_SECRET_ID, JSON.stringify(session));
		this.data.settings.sessionSecretIds.nuvio = NUVIO_SESSION_SECRET_ID;
		this.recordEvent('connection', 'success', t('event.connected.nuvio'));
		await this.persist();
		await this.refreshNuvioProfiles();
	}

	async refreshNuvioProfiles(): Promise<void> {
		const secretId = this.data.settings.sessionSecretIds.nuvio;
		if (!secretId) { this.nuvioProfiles = []; return; }
		const raw = readSecret(this.app, secretId);
		if (!raw) { this.nuvioProfiles = []; return; }
		try {
			const session = JSON.parse(raw) as Partial<NuvioSession>;
			if (typeof session.accessToken !== 'string' || typeof session.refreshToken !== 'string' || typeof session.expiresAt !== 'number') throw new Error(t('nuvio.session.invalid'));
			const backend = await discoverNuvioBackend(this.data.settings.nuvioBackendUrl);
			const current = await ensureNuvioSession(backend, session as NuvioSession);
			if (current.accessToken !== session.accessToken || current.refreshToken !== session.refreshToken) {
				this.app.secretStorage.setSecret(secretId, JSON.stringify(current));
			}
			this.nuvioProfiles = await fetchNuvioProfiles(backend, current.accessToken);
		} catch (error) {
			this.nuvioProfiles = [];
			throw error;
		}
	}

	restartAutoSync(): void {
		this.clearAutoSync();
		if (!this.layoutReady || Platform.isMobileApp) return;
		const { autoSyncEnabled, autoSyncIntervalMinutes } = this.data.settings;
		if (!autoSyncEnabled) return;
		const minutes = Math.max(MIN_AUTO_SYNC_MINUTES, autoSyncIntervalMinutes);
		this.autoSyncTimer = window.setInterval(() => void this.sync({ silent: true }), minutes * 60_000);
		this.registerInterval(this.autoSyncTimer);
	}

	private clearAutoSync(): void {
		if (this.autoSyncTimer === null) return;
		window.clearInterval(this.autoSyncTimer);
		this.autoSyncTimer = null;
	}

	async clearMetadataCache(): Promise<void> {
		await this.waitUntilReady();
		try {
			this.cache.clear();
			await this.cache.save();
			new Notice(t('notice.cacheCleared'));
		} catch (error) {
			this.reportError(error);
		}
	}

	/**
	 * The one entry point for changing the vault.
	 *
	 * A preview always precedes the first sync and any run the user asks to
	 * preview, and by default every manual run — that dialog is where the user
	 * picks what to sync. With confirmation turned off, later manual runs apply
	 * everything directly. Automatic runs never write without a previous
	 * confirmed sync.
	 */
	async sync(options: { previewOnly?: boolean; silent?: boolean } = {}): Promise<void> {
		await this.waitUntilReady();
		if (this.busy) {
			if (!options.silent) new Notice(t('notice.busy'));
			return;
		}

		const problem = this.configurationProblem();
		if (problem) {
			this.recordEvent('sync', 'warning', 'Sync could not start — configuration needs attention.');
			await this.persist();
			if (!options.silent) {
				new Notice(t('notice.config', { problem }), 10_000);
			}
			return;
		}

		this.busy = true;
		const notice = options.silent ? null : new Notice(t('notice.fetching'), 0);
		let handedOffToModal = false;
		try {
			const service = new SyncService(this.app, this.data, this.gateway, this.cache);

			// A background run on an unchanged library costs one small request.
			if (options.silent && !(await service.hasChangesSinceLastSync())) return;

			const { plan, warnings } = await service.prepare((done, total) => {
				notice?.setMessage(t('notice.metadata', { done, total }));
			});
			notice?.hide();

			const needsConfirmation =
				options.previewOnly || !this.data.firstSyncDone || this.data.settings.confirmBeforeWriting;
			if (needsConfirmation) {
				if (options.silent) return;
				// The modal outlives this call, so the guard is released by whichever
				// path the user takes out of it rather than by the `finally` below.
				handedOffToModal = true;
				new PreviewModal(this.app, plan, warnings, (decision) => {
					if (!decision) {
						this.busy = false;
						return;
					}
					void this.applyPlan(service, decision.selection, {
						deselected: decision.deselected,
					}).finally(() => {
						this.busy = false;
					});
				}).open();
				return;
			}

			if (planSize(plan) === 0) {
				if (!options.silent) {
					this.recordEvent('sync', 'success', t('event.sync.none'));
					await this.persist();
					new Notice(t('notice.nothing'));
				}
				return;
			}

			await this.applyPlan(service, plan, { silent: options.silent });
		} catch (error) {
			notice?.hide();
			this.reportError(error);
		} finally {
			if (!handedOffToModal) this.busy = false;
		}
	}

	private async applyPlan(
		service: SyncService,
		plan: SyncPlan,
		options: { silent?: boolean; deselected?: number } = {},
	): Promise<void> {
		const notice = options.silent ? null : new Notice(t('notice.writing'), 0);
		try {
			const result = await service.apply(plan, {
				deselected: options.deselected,
				onProgress: (done, total) => {
				notice?.setMessage(t('notice.writingProgress', { done, total }));
				},
			});
			this.recordEvent(
				'sync',
				result.errors.length > 0 ? 'warning' : 'success',
				t('event.sync.done', {
					created: result.created,
					adopted: result.adopted,
					updated: result.updated,
					errors: result.errors.length,
				}),
			);
			await this.persist();
			notice?.hide();

			if (options.silent) {
				if (result.errors.length > 0) {
					new Notice(t('notice.errors', { count: result.errors.length }), 10_000);
				}
				return;
			}
			new Notice(t('notice.done', { created: result.created, updated: result.updated }), 5_000);
		} catch (error) {
			notice?.hide();
			this.reportError(error);
		}
	}

	/** Everything that must be configured before a single file may be touched. */
	private configurationProblem(): string | null {
		return configurationProblem(this.data.settings, {
			hasSecret: (id) => readSecret(this.app, id) !== null,
			folderExists: (path) => this.app.vault.getFolderByPath(path) !== null,
			markdownFileExists: (path) => this.app.vault.getFileByPath(path)?.extension === 'md',
		});
	}

	private async showLibrarySummary(): Promise<void> {
		await this.waitUntilReady();
		try {
			const service = new SyncService(this.app, this.data, this.gateway, this.cache);
			const { items } = await service.fetchLibraryItems();
			new SummaryModal(this.app, summarize(items, selectionOptionsOf(this.data.settings))).open();
		} catch (error) {
			this.reportError(error);
		}
	}

	private async initializeAfterLayout(): Promise<void> {
		await this.cache.load();
		this.layoutReady = true;
		this.restartAutoSync();
	}

	private async waitUntilReady(): Promise<void> {
		await this.readyPromise;
	}

	reportError(error: unknown): void {
		this.recordEvent('sync', 'error', t('event.sync.failed'));
		void this.persist().catch(() => undefined);
		if (
			error instanceof MissingSecretError ||
			error instanceof StremioApiError ||
			error instanceof TemplateError
		) {
			new Notice(t('notice.failed', { message: error.message }), 10_000);
			return;
		}
		console.error('[watch-sync]', error);
		new Notice(
			t('notice.unexpected', { error: error instanceof Error ? error.message : String(error) }),
			10_000,
		);
	}

	recordConnectionEvent(message: string): void {
		this.recordEvent('connection', 'success', message);
		void this.persist().catch(() => undefined);
	}

	private recordEvent(kind: RecentEvent['kind'], status: RecentEvent['status'], message: string): void {
		this.data.recentEvents = [{ at: new Date().toISOString(), kind, status, message }, ...this.data.recentEvents].slice(0, 20);
	}
}
