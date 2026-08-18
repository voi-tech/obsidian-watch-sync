import { Notice, Platform, PluginSettingTab, SecretComponent, Setting, TFile, TFolder } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
import type StremioSyncPlugin from './main';
import type { PropertyNames } from './model/types';
import { ConnectModal } from './ui/connect-modal';
import { ConfirmModal } from './ui/confirm-modal';
import { DEFAULT_SETTINGS } from './model/types';
import { normalizeOptionalPath } from './model/plugin-data';
import { tagProblem } from './configuration';
import { t } from './i18n';

const TMDB_API_SETTINGS_URL = 'https://www.themoviedb.org/settings/api';

/** Where a key obtained through the pairing flow is stored. */
const AUTH_SECRET_ID = 'stremio-sync-auth-key';

type PropertyKey = keyof PropertyNames;

/**
 * The settings tab uses Obsidian's 1.13 declarative API for ordinary controls.
 * Imperative renderers are limited to pairing and SecretStorage, which do not
 * have equivalent declarative controls.
 */
export class StremioSyncSettingTab extends PluginSettingTab {
	constructor(private readonly plugin: StremioSyncPlugin) {
		super(plugin.app, plugin);
	}

	override getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: 'group',
				heading: t('settings.group.connection'),
				items: [
					{
						name: t('settings.account.name'),
						render: (setting) => this.renderConnection(setting),
					},
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
				heading: t('settings.group.notes'),
				items: [
					{
						name: t('settings.movieTemplate.name'),
						desc: `${t('settings.movieTemplate.desc')} ${t('settings.pathPicker.hint')}`,
						control: {
							type: 'file',
							key: 'movieTemplate',
							placeholder: t('settings.movieTemplate.placeholder'),
							filter: (file) => file.extension === 'md',
							validate: (value: string) => this.templateProblem(value) ?? undefined,
						},
					},
					{
						name: t('settings.seriesTemplate.name'),
						desc: `${t('settings.seriesTemplate.desc')} ${t('settings.pathPicker.hint')}`,
						control: {
							type: 'file',
							key: 'seriesTemplate',
							placeholder: t('settings.seriesTemplate.placeholder'),
							filter: (file) => file.extension === 'md',
							validate: (value: string) => this.templateProblem(value) ?? undefined,
						},
					},
					{
						name: t('settings.movieFilename.name'),
						control: { type: 'text', key: 'movieFilenamePattern', placeholder: '{{title}} ({{year}})' },
					},
					{
						name: t('settings.seriesFilename.name'),
						desc: t('settings.seriesFilename.desc'),
						control: { type: 'text', key: 'seriesFilenamePattern', placeholder: '{{title}} ({{yearRange}})' },
					},
					{
						name: t('settings.body.name'),
						desc: this.bodyModeDescription(),
						control: {
							type: 'dropdown',
							key: 'existingBodyMode',
							options: {
								leave: t('settings.body.option.leave'),
								'managed-block': t('settings.body.option.managed'),
								rewrite: t('settings.body.option.rewrite'),
							},
						},
					},
				],
			},
			{
				type: 'group',
				heading: t('settings.group.syncing'),
				items: [
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
				],
			},
			{
				type: 'group',
				heading: t('settings.group.properties'),
				items: [
					{
						name: t('settings.releaseDate.name'),
						control: this.propertyControl('releaseDate', 'released'),
					},
					{
						name: t('settings.lastWatched.name'),
						desc: t('settings.lastWatched.desc'),
						control: this.propertyControl('lastWatched', 'end'),
					},
					{ name: t('settings.runtime.name'), control: this.propertyControl('duration', 'duration') },
					{ name: t('settings.poster.name'), control: this.propertyControl('cover', 'cover') },
					{
						name: t('settings.source.name'),
						desc: t('settings.source.desc'),
						control: this.propertyControl('source', 'source'),
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
	}

	override getControlValue(key: string): unknown {
		if (key.startsWith('properties.')) {
			const property = key.slice('properties.'.length) as PropertyKey;
			return this.plugin.data.settings.properties[property];
		}
		return (this.plugin.data.settings as unknown as Record<string, unknown>)[key];
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
		if (key.startsWith('properties.')) {
			const property = key.slice('properties.'.length) as PropertyKey;
			if (property in this.plugin.data.settings.properties) {
				this.plugin.data.settings.properties[property] = typeof value === 'string' ? value.trim() : '';
			}
		} else if (key === 'doneTag') {
			this.plugin.data.settings.doneTag = typeof value === 'string' ? value.replace(/^#+/, '').trim() : '';
		} else if (['movieFolder', 'seriesFolder', 'movieTemplate', 'seriesTemplate'].includes(key)) {
			(this.plugin.data.settings as unknown as Record<string, unknown>)[key] =
				typeof value === 'string' ? normalizeOptionalPath(value) : '';
		} else if (key in this.plugin.data.settings) {
			(this.plugin.data.settings as unknown as Record<string, unknown>)[key] = value;
		}

		await this.plugin.persist();
		if (key === 'autoSyncEnabled' || key === 'autoSyncIntervalMinutes') this.plugin.restartAutoSync();
		// Re-render only when a setting can change visibility or connection status;
		// rebuilding a custom text row on every keystroke would steal its focus.
		if (key === 'skipSampledTitles' || key === 'autoSyncEnabled' || key === 'authKeySecretId') this.update();
	}

	private propertyControl(key: PropertyKey, placeholder: string): {
		type: 'text';
		key: `properties.${PropertyKey}`;
		placeholder: string;
		validate: (value: string) => string | undefined;
	} {
		return {
			type: 'text',
			key: `properties.${key}`,
			placeholder,
			validate: (value) => this.propertyProblem(key, value),
		};
	}

	private propertyProblem(key: PropertyKey, raw: string): string | undefined {
		const value = raw.trim();
		if (!value) return undefined;
		const properties = this.plugin.data.settings.properties;
		const clash = (Object.keys(properties) as PropertyKey[]).some(
			(other) => other !== key && properties[other] === value,
		);
		return clash ? t('settings.error.duplicateProperty', { value }) : undefined;
	}

	private markWideSetting(setting: Setting): void {
		setting.settingEl.addClass('stremio-sync-wide-setting');
	}

	private renderConnection(setting: Setting): void {
		const connected = Boolean(this.plugin.data.settings.authKeySecretId);
		setting.setDesc(t(connected ? 'settings.account.connected' : 'settings.account.disconnected'));
		setting.settingEl.addClass(connected ? 'stremio-sync-ok' : 'stremio-sync-todo');
		setting.addButton((button) =>
			button
				.setButtonText(t(connected ? 'settings.account.reconnect' : 'settings.account.connect'))
				.setCta()
				.onClick(() => {
					new ConnectModal(this.app, async (authKey) => {
						this.app.secretStorage.setSecret(AUTH_SECRET_ID, authKey);
						await this.setControlValue('authKeySecretId', AUTH_SECRET_ID);
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

	private renderSecret(setting: Setting, key: 'authKeySecretId' | 'tmdbKeySecretId'): void {
		this.markWideSetting(setting);
		setting.addComponent((controlEl) =>
			new SecretComponent(this.app, controlEl)
				.setValue(textValue(this.getControlValue(key)))
				.onChange((secretId) => void this.setControlValue(key, secretId ?? '')),
		);
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
				const { authKeySecretId, tmdbKeySecretId } = this.plugin.data.settings;
				this.plugin.data.settings = {
					...structuredClone(DEFAULT_SETTINGS),
					authKeySecretId,
					tmdbKeySecretId,
				};
				await this.plugin.persist();
				this.plugin.restartAutoSync();
				this.update();
				new Notice(t('settings.reset.done'));
			},
		}).open();
	}

	private templateProblem(path: string): string | null {
		if (!path) return null;
		const file = this.app.vault.getAbstractFileByPath(normalizeOptionalPath(path));
		if (!(file instanceof TFile)) return t('settings.error.fileMissing');
		if (file.extension !== 'md') return t('settings.error.fileMarkdown');
		return null;
	}

	private folderProblem(path: string): string | null {
		if (!path) return t('settings.error.folderRequired');
		const folder = this.app.vault.getAbstractFileByPath(normalizeOptionalPath(path));
		if (!(folder instanceof TFolder)) return t('settings.error.folderMissing');
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
