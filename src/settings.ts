import { Notice, Platform, PluginSettingTab, SecretComponent, Setting } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
import type WatchSyncPlugin from './main';
import type { ImportScope, TemplatePropertyKey } from './model/types';
import { ConnectModal } from './ui/connect-modal';
import { ConfirmModal } from './ui/confirm-modal';
import { normalizeOptionalPath, normalizeTemplateText, restoreDefaultSettings } from './model/plugin-data';
import { tagProblem } from './configuration';
import { t } from './i18n';
import { NuvioConnectModal } from './ui/nuvio-connect-modal';
import { TEMPLATE_TOKEN_GROUPS } from './vault/template-reference';
import { buildContext, renderFilename } from './vault/template';
import type { MediaType, NormalizedMedia } from './model/types';

const TMDB_API_SETTINGS_URL = 'https://www.themoviedb.org/settings/api';

/** Where a key obtained through the pairing flow is stored. */
const AUTH_SECRET_ID = 'stremio-sync-auth-key';

function filenameSample(type: MediaType): NormalizedMedia {
	return {
		id: 'sample', type, title: type === 'movie' ? 'Arrival' : 'Severance',
		year: type === 'movie' ? 2016 : 2022, yearStart: type === 'movie' ? 2016 : 2022,
		yearEnd: type === 'movie' ? 2016 : 2025, genres: [], cast: [],
		watchStatus: 'unwatched', finished: false, progressPercent: 0,
		stremioUrl: '', stremioAppUrl: '', seasons: [],
	};
}

/**
 * The settings tab uses Obsidian's 1.13 declarative API for ordinary controls.
 * Imperative renderers are limited to pairing and SecretStorage, which do not
 * have equivalent declarative controls.
 */
export class WatchSyncSettingTab extends PluginSettingTab {
	constructor(private readonly plugin: WatchSyncPlugin) {
		super(plugin.app, plugin);
	}

	override getSettingDefinitions(): SettingDefinitionItem[] {
		const groups: SettingDefinitionItem[] = [
			{
				type: 'group', heading: t('settings.group.events'), items: [{
					name: t('settings.events.name'), desc: t('settings.events.desc'),
					render: (setting) => this.renderRecentEvents(setting),
				}],
			},
			{
				type: 'group',
				heading: t('settings.group.connection'),
				items: [
					{
						name: t('settings.provider.name'),
						desc: t('settings.provider.desc'),
						render: (setting) => this.renderSource(setting),
					},
					{
						name: t('settings.scope.library.name'),
						desc: t('settings.scope.library.desc'),
						visible: () => this.plugin.data.settings.provider !== null,
						render: (setting) => this.renderScope(setting, 'library'),
					},
					{
						name: t('settings.scope.watchHistory.name'),
						desc: t('settings.scope.watchHistory.desc'),
						visible: () => this.plugin.data.settings.provider !== null,
						render: (setting) => this.renderScope(setting, 'watchHistory'),
					},
					{
						name: t('settings.scope.progress.name'),
						desc: t('settings.scope.progress.desc'),
						visible: () => this.plugin.data.settings.provider !== null,
						render: (setting) => this.renderScope(setting, 'progress'),
					},
					{
						name: t('settings.account.name'),
						visible: () => this.plugin.data.settings.provider === 'stremio',
						render: (setting) => this.renderConnection(setting),
					},
					{
						name: t('settings.nuvio.account.name'),
						visible: () => this.plugin.data.settings.provider === 'nuvio',
						render: (setting) => this.renderNuvioConnection(setting),
					},
					{
						name: t('settings.nuvio.profile.name'),
						visible: () => this.plugin.data.settings.provider === 'nuvio',
						render: (setting) => this.renderNuvioProfile(setting),
					},
					{
						name: t('settings.confirm.name'),
						desc: t('settings.confirm.desc'),
						control: { type: 'toggle', key: 'confirmBeforeWriting' },
					},
					...(Platform.isMobileApp
						? []
						: [
								{
									name: t('settings.auto.name'),
									desc: t('settings.auto.desc'),
									control: { type: 'toggle' as const, key: 'autoSyncEnabled' },
								},
								{
									name: t('settings.interval.name'),
									desc: t('settings.interval.desc'),
									visible: () => Boolean(this.getControlValue('autoSyncEnabled')),
									control: {
										type: 'slider' as const,
										key: 'autoSyncIntervalMinutes',
										min: 15,
										max: 720,
										step: 15,
									},
								},
							] as const),
				],
			},
			{
				type: 'group',
				heading: t('settings.group.files'),
				items: [
					{
						name: t('settings.movieFolder.name'),
						desc: `${t('settings.movieFolder.desc')} ${t('settings.pathPicker.hint')}`,
						control: {
							type: 'folder',
							key: 'movieFolder',
							placeholder: t('settings.movieFolder.placeholder'),
							includeRoot: true,
							validate: (value: string) => this.folderProblem(value) ?? undefined,
						},
					},
					{
						name: t('settings.seriesFolder.name'),
						desc: `${t('settings.seriesFolder.desc')} ${t('settings.pathPicker.hint')}`,
						control: {
							type: 'folder',
							key: 'seriesFolder',
							placeholder: t('settings.seriesFolder.placeholder'),
							includeRoot: true,
							validate: (value: string) => this.folderProblem(value) ?? undefined,
						},
					},
					{
						name: t('settings.movieTemplate.name'),
						desc: `${t('settings.movieTemplate.desc')} ${t('settings.pathPicker.hint')}`,
						control: {
							type: 'file', key: 'movieTemplate', placeholder: t('settings.movieTemplate.placeholder'),
							filter: (file) => file.extension === 'md',
							validate: (value: string) => this.templateProblem(value) ?? undefined,
						},
					},
					{
						name: t('settings.seriesTemplate.name'),
						desc: `${t('settings.seriesTemplate.desc')} ${t('settings.pathPicker.hint')}`,
						control: {
							type: 'file', key: 'seriesTemplate', placeholder: t('settings.seriesTemplate.placeholder'),
							filter: (file) => file.extension === 'md',
							validate: (value: string) => this.templateProblem(value) ?? undefined,
						},
					},
					{
						name: t('settings.movieFilename.name'),
						render: (setting) => this.renderFilenamePattern(setting, 'movie'),
					},
					{
						name: t('settings.seriesFilename.name'),
						render: (setting) => this.renderFilenamePattern(setting, 'series'),
					},
					{
						name: t('settings.body.name'),
						desc: this.bodyModeDescription(),
						control: {
							type: 'dropdown', key: 'existingBodyMode',
							options: { leave: t('settings.body.option.leave'), 'managed-block': t('settings.body.option.managed'), rewrite: t('settings.body.option.rewrite') },
						},
					},
				],
			},
			{
				type: 'group',
				heading: t('settings.group.filtering'),
				items: [
					{
						name: t('settings.sampled.name'),
						desc: t('settings.sampled.desc'),
						control: { type: 'toggle', key: 'skipSampledTitles' },
					},
					{
						name: t('settings.sampledThreshold.name'),
						desc: t('settings.sampledThreshold.desc'),
						visible: () => Boolean(this.getControlValue('skipSampledTitles')),
						control: { type: 'slider', key: 'sampledThresholdMinutes', min: 1, max: 60, step: 1 },
					},
					{
						name: t('settings.watchedThreshold.name'),
						desc: t('settings.watchedThreshold.desc'),
						control: { type: 'slider', key: 'watchedThresholdPercent', min: 10, max: 100, step: 5 },
					},
					{
						name: t('settings.unwatched.name'),
						desc: t('settings.unwatched.desc'),
						control: { type: 'toggle', key: 'includeUnwatchedLibrary' },
					},
				],
			},
			{
				type: 'group',
				heading: t('settings.group.metadata'),
				items: [
					{
						name: t('settings.tmdb.name'),
						desc: this.tmdbKeyDescription(),
						render: (setting) => this.renderSecret(setting, 'tmdbKeySecretId'),
					},
					{
						name: t('settings.language.name'),
						desc: t('settings.language.desc'),
						control: {
							type: 'dropdown',
							key: 'language',
							options: {
								'pl-PL': t('settings.language.polish'),
								'en-US': t('settings.language.english'),
							},
						},
					},
					{
						name: t('settings.tag.name'),
						desc: t('settings.tag.desc'),
						control: {
							type: 'text',
							key: 'doneTag',
							placeholder: t('settings.tag.placeholder'),
							validate: (value: string) => tagProblem(value.replace(/^#+/, '').trim()) ?? undefined,
						},
					},
					{
						name: t('settings.templateKeys.name'),
						desc: t('settings.templateKeys.desc'),
						render: (setting) => this.renderTemplateKeys(setting),
					},
				],
			},
			{
				type: 'group',
				heading: t('settings.group.reset'),
				items: [
					{
						name: t('settings.reset.name'),
						desc: t('settings.reset.desc'),
						render: (setting) => this.renderReset(setting),
					},
				],
			},
		];
		const order = new Map([
			[t('settings.group.connection'), 0],
			[t('settings.group.filtering'), 1],
			[t('settings.group.files'), 2],
			[t('settings.group.metadata'), 3],
			[t('settings.group.reset'), 4], [t('settings.group.events'), 5],
		]);
		const itemOrder = new Map<string, number>([
			[t('settings.provider.name'), 0], [t('settings.account.name'), 1], [t('settings.nuvio.account.name'), 1], [t('settings.nuvio.profile.name'), 2],
			[t('settings.scope.library.name'), 3], [t('settings.scope.watchHistory.name'), 4], [t('settings.scope.progress.name'), 5], [t('settings.confirm.name'), 6], [t('settings.auto.name'), 7], [t('settings.interval.name'), 8],
			[t('settings.unwatched.name'), 0], [t('settings.sampled.name'), 1], [t('settings.sampledThreshold.name'), 2], [t('settings.watchedThreshold.name'), 3],
			[t('settings.movieFolder.name'), 0], [t('settings.seriesFolder.name'), 1], [t('settings.movieFilename.name'), 2], [t('settings.seriesFilename.name'), 3], [t('settings.movieTemplate.name'), 4], [t('settings.seriesTemplate.name'), 5], [t('settings.body.name'), 6],
			[t('settings.language.name'), 0], [t('settings.tmdb.name'), 1], [t('settings.tag.name'), 2], [t('settings.templateKeys.name'), 3],
		]);
		for (const group of groups) {
			if (!('items' in group) || !group.items) continue;
			group.items.sort((left, right) =>
				(itemOrder.get('name' in left ? left.name : '') ?? 99) - (itemOrder.get('name' in right ? right.name : '') ?? 99),
			);
		}
		return groups.sort((left, right) =>
			(order.get('heading' in left ? left.heading ?? '' : '') ?? 99) -
			(order.get('heading' in right ? right.heading ?? '' : '') ?? 99),
		);
	}

	override getControlValue(key: string): unknown {
		if (key.startsWith('properties.')) {
			const property = key.slice('properties.'.length) as TemplatePropertyKey;
			return this.plugin.data.settings.properties[property];
		}
		return (this.plugin.data.settings as unknown as Record<string, unknown>)[key];
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
		if (key.startsWith('properties.')) {
			const property = key.slice('properties.'.length) as TemplatePropertyKey;
			const name = typeof value === 'string' ? value.trim() : '';
			if (name) this.plugin.data.settings.properties[property] = name;
			else delete this.plugin.data.settings.properties[property];
		} else if (key === 'doneTag') {
			this.plugin.data.settings.doneTag = typeof value === 'string' ? value.replace(/^#+/, '').trim() : '';
		} else if (['movieFolder', 'seriesFolder', 'movieTemplate', 'seriesTemplate'].includes(key)) {
			(this.plugin.data.settings as unknown as Record<string, unknown>)[key] =
				typeof value === 'string' ? normalizeOptionalPath(value) : '';
		} else if (key === 'movieTemplateText' || key === 'seriesTemplateText') {
			(this.plugin.data.settings as unknown as Record<string, unknown>)[key] = normalizeTemplateText(value);
		} else if (key in this.plugin.data.settings) {
			(this.plugin.data.settings as unknown as Record<string, unknown>)[key] = value;
		}

		await this.plugin.persist();
		if (key === 'autoSyncEnabled' || key === 'autoSyncIntervalMinutes') this.plugin.restartAutoSync();
		// Re-render only when a setting can change visibility or connection status;
		// rebuilding a custom text row on every keystroke would steal its focus.
		if (key === 'skipSampledTitles' || key === 'autoSyncEnabled' || key === 'authKeySecretId') this.update();
	}

	private propertyProblem(key: TemplatePropertyKey, raw: string): string | undefined {
		const value = raw.trim();
		if (!value) return undefined;
		if (value === 'tags' || ['__proto__', 'prototype', 'constructor'].includes(value)) {
			return t('settings.error.reservedProperty');
		}
		const properties = this.plugin.data.settings.properties;
		const clash = (Object.keys(properties) as TemplatePropertyKey[]).some(
			(other) => other !== key && properties[other] === value,
		);
		return clash ? t('settings.error.duplicateProperty', { value }) : undefined;
	}

	private markWideSetting(setting: Setting): void {
		setting.settingEl.addClass('watch-sync-wide-setting');
	}

	private renderConnection(setting: Setting): void {
		const connected = Boolean(this.plugin.data.settings.authKeySecretId);
		setting.setDesc(t(connected ? 'settings.account.connected' : 'settings.account.disconnected'));
		setting.settingEl.addClass(connected ? 'watch-sync-ok' : 'watch-sync-todo');
		setting.addButton((button) =>
			button
				.setButtonText(t(connected ? 'settings.account.reconnect' : 'settings.account.connect'))
				.setCta()
				.onClick(() => {
					new ConnectModal(this.app, async (authKey) => {
						this.app.secretStorage.setSecret(AUTH_SECRET_ID, authKey);
						await this.setControlValue('authKeySecretId', AUTH_SECRET_ID);
						this.plugin.recordConnectionEvent(t('event.connected.stremio'));
					}).open();
				}),
		);

		if (connected) {
			setting.addExtraButton((button) =>
				button
					.setIcon('unplug')
					.setTooltip(t('settings.account.disconnect'))
					.onClick(() => void this.setControlValue('authKeySecretId', '')),
			);
		}
	}

	private renderSource(setting: Setting): void {
		setting.addDropdown((dropdown) => {
			dropdown
				.addOption('', t('settings.provider.choose'))
				.addOption('stremio', 'Stremio')
				.addOption('nuvio', 'Nuvio')
				.setValue(this.plugin.data.settings.provider ?? '')
				.onChange(async (value) => {
					this.plugin.data.settings.provider = value === 'stremio' || value === 'nuvio' ? value : null;
					await this.plugin.persist();
					this.update();
				});
		});
	}

	private renderScope(setting: Setting, scope: ImportScope): void {
		setting.addToggle((toggle) =>
			toggle.setValue(this.plugin.data.settings.importScopes.includes(scope)).onChange(async (enabled) => {
				const selected = new Set(this.plugin.data.settings.importScopes);
				if (enabled) selected.add(scope);
				else selected.delete(scope);
				this.plugin.data.settings.importScopes = ['library', 'watchHistory', 'progress'].filter(
					(candidate): candidate is ImportScope => selected.has(candidate as ImportScope),
				);
				await this.plugin.persist();
			}),
		);
	}

	private renderSecret(setting: Setting, key: 'tmdbKeySecretId'): void {
		this.markWideSetting(setting);
		setting.addComponent((controlEl) =>
			new SecretComponent(this.app, controlEl)
				.setValue(textValue(this.getControlValue(key)))
				.onChange((secretId) => void this.setControlValue(key, secretId ?? '')),
		);
	}

	private renderNuvioConnection(setting: Setting): void {
		const connected = Boolean(this.plugin.data.settings.sessionSecretIds.nuvio);
		setting.setDesc(t(connected ? 'settings.nuvio.account.connected' : 'settings.nuvio.account.disconnected'));
		setting.addButton((button) => button.setButtonText(t(connected ? 'settings.account.reconnect' : 'settings.account.connect')).setCta().onClick(() => {
			new NuvioConnectModal(this.app, this.plugin.data.settings.nuvioBackendUrl, async (session) => {
				await this.plugin.saveNuvioSession(session);
				this.update();
			}).open();
		}));
	}

	private renderNuvioProfile(setting: Setting): void {
		const render = async (): Promise<void> => {
			try { await this.plugin.refreshNuvioProfiles(); } catch { setting.setDesc(t('settings.nuvio.profile.failed')); return; }
			if (this.plugin.nuvioProfiles.length === 0) { setting.setDesc(t('settings.nuvio.profile.none')); return; }
			setting.setDesc(t('settings.nuvio.profile.desc'));
			setting.addDropdown((dropdown) => {
				dropdown.addOption('', t('settings.nuvio.profile.choose'));
				for (const profile of this.plugin.nuvioProfiles) dropdown.addOption(profile.id, profile.name);
				dropdown.setValue(this.plugin.data.settings.nuvioProfileId).onChange(async (id) => {
					if (!id) {
						this.plugin.data.settings.nuvioProfileId = '';
						this.plugin.data.settings.nuvioProfileName = '';
						await this.plugin.persist();
						return;
					}
					const profile = this.plugin.nuvioProfiles.find((candidate) => candidate.id === id);
					if (!profile) return;
					this.plugin.data.settings.nuvioProfileId = profile.id;
					this.plugin.data.settings.nuvioProfileName = profile.name;
					await this.plugin.persist();
				});
			});
		};
		void render();
	}

	private renderTemplateKeys(setting: Setting): void {
		setting.settingEl.addClass('watch-sync-wide-setting');
		const container = setting.controlEl.createDiv({ cls: 'watch-sync-template-keys' });
		for (const group of TEMPLATE_TOKEN_GROUPS) {
			const section = container.createDiv();
			section.createEl('strong', { text: group.title });
			const keys = section.createDiv({ cls: 'watch-sync-template-property-list' });
			for (const field of group.fields) {
				const key = field.name as TemplatePropertyKey;
				const token = `{{${field.name}}}`;
				const row = keys.createDiv({ cls: 'watch-sync-template-property-row' });
				const button = row.createEl('button', { text: token });
				button.setAttribute('aria-label', field.description);
				button.onClickEvent(() => void navigator.clipboard.writeText(token).then(
					() => new Notice(t('clipboard.copiedToken', { token })),
					() => new Notice(t('clipboard.failed')),
				));
				row.createSpan({ text: `${field.kind ?? 'text'}${field.example ? ` · ${field.example}` : ''}${field.description ? ` — ${field.description}` : ''}`, cls: 'watch-sync-template-key-example' });
				if (field.name === 'seasons') {
					row.createSpan({ text: t('settings.templateKeys.templateOnly'), cls: 'watch-sync-template-key-example' });
					continue;
				}
				const input = row.createEl('input', { type: 'text', placeholder: t('settings.templateKeys.propertyPlaceholder') });
				input.value = this.plugin.data.settings.properties[key] ?? '';
				input.setAttribute('aria-label', t('settings.templateKeys.propertyLabel', { field: field.name }));
				input.addEventListener('change', () => {
					const problem = this.propertyProblem(key, input.value);
					input.setCustomValidity(problem ?? '');
					if (problem) { new Notice(problem); return; }
					void this.setControlValue(`properties.${key}`, input.value);
				});
			}
		}
	}

	private renderFilenamePattern(setting: Setting, type: MediaType): void {
		const key = type === 'movie' ? 'movieFilenamePattern' : 'seriesFilenamePattern';
		const sample = buildContext(filenameSample(type));
		const updateExample = (pattern: string): void => {
			setting.setDesc(`Example: ${renderFilename(pattern, sample)}.md`);
		};
		updateExample(this.plugin.data.settings[key]);
		setting.addText((text) => {
			text.setPlaceholder(type === 'movie' ? '{{title}} ({{year}})' : '{{title}} ({{years}})')
				.setValue(this.plugin.data.settings[key])
				.onChange(async (value) => {
				this.plugin.data.settings[key] = value;
				updateExample(value);
				await this.plugin.persist();
				});
		});
	}

	private renderRecentEvents(setting: Setting): void {
		const events = this.plugin.data.recentEvents;
		if (events.length === 0) setting.setDesc(t('settings.events.empty'));
		else {
			const list = setting.controlEl.createEl('ul', { cls: 'watch-sync-list' });
			for (const event of events) {
				list.createEl('li', { text: `${new Date(event.at).toLocaleString()} — ${event.message}` });
			}
		}
		setting.addButton((button) => button.setButtonText(t('settings.events.clear')).onClick(async () => {
			this.plugin.data.recentEvents = [];
			await this.plugin.persist();
			this.update();
		}));
	}

	private renderReset(setting: Setting): void {
		setting.addButton((button) => {
			button.buttonEl.addClass('mod-warning');
			button.setButtonText(t('settings.reset.confirm')).onClick(() => this.confirmReset());
		});
	}

	private confirmReset(): void {
		new ConfirmModal(this.app, {
			title: t('settings.reset.title'),
			message: t('settings.reset.message'),
			confirmText: t('settings.reset.confirm'),
			onConfirm: async () => {
				this.plugin.data.settings = restoreDefaultSettings(this.plugin.data.settings);
				await this.plugin.persist();
				this.plugin.restartAutoSync();
				this.update();
				new Notice(t('settings.reset.done'));
			},
		}).open();
	}

	private templateProblem(path: string): string | null {
		if (!path) return null;
		const file = this.app.vault.getFileByPath(normalizeOptionalPath(path));
		if (file === null) return t('settings.error.fileMissing');
		if (file.extension !== 'md') return t('settings.error.fileMarkdown');
		return null;
	}

	private folderProblem(path: string): string | null {
		if (!path) return t('settings.error.folderRequired');
		const folder = this.app.vault.getFolderByPath(normalizeOptionalPath(path));
		if (folder === null) return t('settings.error.folderMissing');
		return null;
	}

	private tmdbKeyDescription(): DocumentFragment {
		const fragment = createFragment();
		fragment.append(
			t('settings.tmdb.desc.before'),
			link(TMDB_API_SETTINGS_URL, t('settings.tmdb.link')),
			t('settings.tmdb.desc.after'),
		);
		return fragment;
	}

	private bodyModeDescription(): DocumentFragment {
		const fragment = createFragment();
		const list = createEl('ul');
		for (const [label, text] of [
			[t('settings.body.option.leave'), t('settings.body.desc.leave')],
			[t('settings.body.option.managed'), t('settings.body.desc.managed')],
			[t('settings.body.option.rewrite'), t('settings.body.desc.rewrite')],
		] as const) {
			const item = createEl('li');
			const name = createEl('strong');
			name.textContent = `${label}: `;
			item.append(name, text);
			list.append(item);
		}
		fragment.append(list);
		return fragment;
	}
}

function link(href: string, text: string): HTMLAnchorElement {
	const anchor = createEl('a');
	anchor.href = href;
	anchor.textContent = text;
	anchor.target = '_blank';
	anchor.rel = 'noopener';
	return anchor;
}

function textValue(value: unknown): string {
	return typeof value === 'string' ? value : '';
}
