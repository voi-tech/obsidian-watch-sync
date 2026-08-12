import { Notice, PluginSettingTab, SecretComponent, Setting, TFile, TFolder } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
import type StremioSyncPlugin from './main';
import { FolderSuggest, NoteSuggest } from './ui/suggest';
import { FolderPickerModal, NotePickerModal } from './ui/pickers';
import type { PropertyNames } from './model/types';
import { renderTemplateReference } from './ui/template-reference-view';
import { ConnectModal } from './ui/connect-modal';
import { ConfirmModal } from './ui/confirm-modal';
import { DEFAULT_SETTINGS } from './model/types';
import { normalizeOptionalPath } from './model/plugin-data';
import { tagProblem } from './configuration';

const STREMIO_WEB_URL = 'https://web.stremio.com/';
const STREMIO_AUTH_SNIPPET = "JSON.parse(localStorage.getItem('profile')).auth.key";
const TMDB_API_SETTINGS_URL = 'https://www.themoviedb.org/settings/api';

/** Where a key obtained through the pairing flow is stored. */
const AUTH_SECRET_ID = 'stremio-sync-auth-key';

type PropertyKey = keyof PropertyNames;

/**
 * The settings tab uses Obsidian's 1.13 declarative API for ordinary controls.
 * Imperative renderers are limited to controls that need vault-aware pickers,
 * SecretComponent, custom help, or an explicit destructive-looking action.
 */
export class StremioSyncSettingTab extends PluginSettingTab {
	constructor(private readonly plugin: StremioSyncPlugin) {
		super(plugin.app, plugin);
	}

	override getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: 'group',
				heading: 'Setup',
				items: [
					{
						name: 'Stremio account',
						render: (setting) => this.renderConnection(setting),
					},
					{
						name: 'Enter a key by hand',
						desc: 'Only needed if you already have an auth key. The value is stored by Obsidian SecretStorage.',
						render: (setting) => this.renderManualAuth(setting),
					},
					{
						name: 'Movie folder',
						desc: 'Notes for films are created here.',
						render: (setting) => this.renderFolder(setting, 'movieFolder', 'Movies'),
					},
					{
						name: 'Series folder',
						desc: 'Notes for series are created here.',
						render: (setting) => this.renderFolder(setting, 'seriesFolder', 'TV Shows'),
					},
				],
			},
			{
				type: 'group',
				heading: 'What gets synced',
				items: [
					{
						name: 'Skip titles you only sampled',
						desc: 'Opening something briefly leaves the same trace in Stremio as watching it. The summary command shows affected titles.',
						control: { type: 'toggle', key: 'skipSampledTitles' },
					},
					{
						name: 'Counts as sampled below',
						desc: 'Minutes of playback.',
						visible: () => Boolean(this.getControlValue('skipSampledTitles')),
						control: { type: 'slider', key: 'sampledThresholdMinutes', min: 1, max: 60, step: 1 },
					},
					{
						name: 'Counts as watched above',
						desc: 'Share of the runtime. Stremio marks a video watched at 70%; this promotes titles it has not flagged, such as a film stopped before the credits.',
						control: { type: 'slider', key: 'watchedThresholdPercent', min: 10, max: 100, step: 5 },
					},
					{
						name: 'Include titles you never played',
						desc: 'Things sitting in your Stremio library that you have not started.',
						control: { type: 'toggle', key: 'includeUnwatchedLibrary' },
					},
				],
			},
			{
				type: 'group',
				heading: 'Notes',
				items: [
					{
						name: 'Movie template',
						desc: 'Empty uses the built-in template.',
						render: (setting) => this.renderTemplate(setting, 'movieTemplate', 'Templates/Movie.md'),
					},
					{
						name: 'Series template',
						desc: 'Empty uses the built-in template.',
						render: (setting) => this.renderTemplate(setting, 'seriesTemplate', 'Templates/Series.md'),
					},
					{
						name: 'Movie file name',
						control: { type: 'text', key: 'movieFilenamePattern', placeholder: '{{title}} ({{year}})' },
					},
					{
						name: 'Series file name',
						desc: 'Use {{yearRange}} to avoid a redundant "(2025-2025)".',
						control: { type: 'text', key: 'seriesFilenamePattern', placeholder: '{{title}} ({{yearRange}})' },
					},
					{
						name: 'Body of existing notes',
						desc: this.bodyModeDescription(),
						control: {
							type: 'dropdown',
							key: 'existingBodyMode',
							options: {
								leave: 'Leave alone',
								'managed-block': 'Keep the managed block up to date',
								rewrite: 'Rewrite from the template',
							},
						},
					},
					{
						name: 'Template reference',
						searchable: false,
						desc: 'Available fields, helpers, and built-in templates.',
						render: (setting) => this.renderTemplateReference(setting),
					},
				],
			},
			{
				type: 'group',
				heading: 'Syncing',
				items: [
					{
						name: 'Ask before writing',
						desc: 'Show the preview before every manual sync — that is where you pick what to apply. The first sync always asks.',
						control: { type: 'toggle', key: 'confirmBeforeWriting' },
					},
					{
						name: 'Sync in the background',
						desc: 'Off by default. Manual syncing is the intended mode.',
						control: { type: 'toggle', key: 'autoSyncEnabled' },
					},
					{
						name: 'Every',
						desc: 'Minimum 15 minutes between automatic syncs.',
						visible: () => Boolean(this.getControlValue('autoSyncEnabled')),
						control: { type: 'slider', key: 'autoSyncIntervalMinutes', min: 15, max: 720, step: 15 },
					},
				],
			},
			{
				type: 'group',
				heading: 'Advanced',
				items: [
					{
						name: 'TMDB API key',
						desc: this.tmdbKeyDescription(),
						render: (setting) => this.renderSecret(setting, 'tmdbKeySecretId'),
					},
					{
						name: 'Metadata language',
						desc: 'Applies to TMDB. Cinemeta remains the fallback provider.',
						control: {
							type: 'dropdown',
							key: 'language',
							options: { 'pl-PL': 'Polish', 'en-US': 'English' },
						},
					},
					{
						name: 'Completion tag',
						desc: 'Added once everything aired has been watched. Empty adds no tag.',
						control: {
							type: 'text',
							key: 'doneTag',
							placeholder: 'Done',
							validate: (value: string) => tagProblem(value.replace(/^#+/, '').trim()) ?? undefined,
						},
					},
					{
						name: 'Release date',
						control: this.propertyControl('releaseDate', 'released'),
					},
					{
						name: 'Last watched',
						desc: 'The last time Stremio played it, whether or not it was finished.',
						control: this.propertyControl('lastWatched', 'end'),
					},
					{ name: 'Runtime', control: this.propertyControl('duration', 'duration') },
					{ name: 'Poster', control: this.propertyControl('cover', 'cover') },
					{
						name: 'Stremio link',
						desc: 'Also the key that matches a note on later syncs. Clearing it makes the plugin guess from file names.',
						control: this.propertyControl('source', 'source'),
					},
				],
			},
			{
				type: 'group',
				heading: 'Reset',
				items: [
					{
						name: 'Restore defaults',
						desc: 'Restores every setting on this page. Connected Stremio and TMDB secrets stay, and no note is touched.',
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
		return clash ? `"${value}" is already used by another property.` : undefined;
	}

	private markWideSetting(setting: Setting): void {
		setting.settingEl.addClass('stremio-sync-wide-setting');
	}

	private renderConnection(setting: Setting): void {
		const connected = Boolean(this.plugin.data.settings.authKeySecretId);
		setting.setDesc(connected ? 'Connected.' : 'Not connected yet — nothing will sync until it is.');
		setting.settingEl.addClass(connected ? 'stremio-sync-ok' : 'stremio-sync-todo');
		setting.addButton((button) =>
			button
				.setButtonText(connected ? 'Reconnect' : 'Connect')
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
					.setTooltip('Disconnect')
					.onClick(() => void this.setControlValue('authKeySecretId', '')),
			);
		}
	}

	private renderManualAuth(setting: Setting): void {
		this.markWideSetting(setting);
		this.codeBlock(setting.controlEl, STREMIO_AUTH_SNIPPET, 'Copy the snippet', [
			{ label: 'Open Stremio Web', href: STREMIO_WEB_URL },
		]);
		setting.addComponent((controlEl) =>
			new SecretComponent(this.app, controlEl)
				.setValue(textValue(this.getControlValue('authKeySecretId')))
				.onChange((secretId) => void this.setControlValue('authKeySecretId', secretId ?? '')),
		);
	}

	private renderSecret(setting: Setting, key: 'authKeySecretId' | 'tmdbKeySecretId'): void {
		this.markWideSetting(setting);
		setting.addComponent((controlEl) =>
			new SecretComponent(this.app, controlEl)
				.setValue(textValue(this.getControlValue(key)))
				.onChange((secretId) => void this.setControlValue(key, secretId ?? '')),
		);
	}

	private renderFolder(setting: Setting, key: 'movieFolder' | 'seriesFolder', placeholder: string): void {
		this.markWideSetting(setting);
		let input: HTMLInputElement | null = null;
		const current = textValue(this.getControlValue(key));

		setting.addText((text) => {
			input = text.inputEl;
			text
				.setPlaceholder(placeholder)
				.setValue(current)
				.onChange((value) => void this.setControlValue(key, normalizeOptionalPath(value)));
			new FolderSuggest(this.app, text.inputEl, (path) => void this.setControlValue(key, normalizeOptionalPath(path)));
		});
		setting.addExtraButton((button) =>
			button
				.setIcon('folder-open')
				.setTooltip('Browse folders')
				.onClick(() => {
					new FolderPickerModal(this.app, (path) => {
						if (input) input.value = path;
						void this.setControlValue(key, normalizeOptionalPath(path));
					}).open();
				}),
		);
		setSettingError(setting, this.folderError(current));
	}

	private renderTemplate(
		setting: Setting,
		key: 'movieTemplate' | 'seriesTemplate',
		placeholder: string,
	): void {
		this.markWideSetting(setting);
		let input: HTMLInputElement | null = null;
		const current = textValue(this.getControlValue(key));
		setting.addText((text) => {
			input = text.inputEl;
			text
				.setPlaceholder(placeholder)
				.setValue(current)
				.onChange((value) => void this.setControlValue(key, normalizeOptionalPath(value)));
			new NoteSuggest(this.app, text.inputEl, (path) => void this.setControlValue(key, normalizeOptionalPath(path)));
		});
		setting.addExtraButton((button) =>
			button
				.setIcon('files')
				.setTooltip('Browse notes')
				.onClick(() => {
					new NotePickerModal(this.app, (path) => {
						if (input) input.value = path;
						void this.setControlValue(key, normalizeOptionalPath(path));
					}).open();
				}),
		);
		setting.addExtraButton((button) =>
			button
				.setIcon('x')
				.setTooltip('Use the built-in template')
				.onClick(() => {
					if (input) input.value = '';
					void this.setControlValue(key, '');
				}),
		);
		setSettingError(setting, this.templateError(current));
	}

	private renderTemplateReference(setting: Setting): void {
		this.markWideSetting(setting);
		setting.settingEl.addClass('stremio-sync-template-reference-setting');
		setting.controlEl.empty();
		const container = setting.controlEl.createDiv({ cls: 'stremio-sync-template-reference' });
		renderTemplateReference(container);
	}

	private renderReset(setting: Setting): void {
		setting.addButton((button) => {
			button.buttonEl.addClass('mod-warning');
			button.setButtonText('Restore defaults').onClick(() => this.confirmReset());
		});
	}

	private confirmReset(): void {
		new ConfirmModal(this.app, {
			title: 'Restore defaults?',
			message: 'Every setting on this page goes back to its shipped value. Your Stremio and TMDB keys stay connected, and no note is touched.',
			confirmText: 'Restore defaults',
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
				new Notice('Stremio Sync: settings restored to defaults.');
			},
		}).open();
	}

	private templateError(path: string): string | null {
		if (!path) return null;
		const file = this.app.vault.getAbstractFileByPath(normalizeOptionalPath(path));
		if (!(file instanceof TFile)) return 'No such note in this vault.';
		if (file.extension !== 'md') return 'Pick a Markdown note.';
		return null;
	}

	private folderError(path: string): string | null {
		if (!path) return 'Pick a folder — syncing will not start without one.';
		const folder = this.app.vault.getAbstractFileByPath(normalizeOptionalPath(path));
		if (!(folder instanceof TFolder)) return 'No such folder in this vault.';
		return null;
	}

	private codeBlock(
		containerEl: HTMLElement,
		code: string,
		copyLabel: string,
		links: { label: string; href: string }[] = [],
	): void {
		const wrapper = containerEl.createDiv({ cls: 'stremio-sync-codeblock' });
		wrapper.createEl('pre').createEl('code', { text: code });
		const actions = wrapper.createDiv({ cls: 'stremio-sync-codeblock-actions' });
		const copy = actions.createEl('button', { text: copyLabel });
		copy.addEventListener('click', () => void copyToClipboard(code, copy));
		for (const target of links) {
			const open = actions.createEl('button', { text: target.label });
			open.addEventListener('click', () => window.open(target.href, '_blank'));
		}
	}

	private tmdbKeyDescription(): DocumentFragment {
		const fragment = createFragment();
		fragment.append(
			'Optional. Without it only Cinemeta is used, so descriptions and episode titles stay in English. Create a free v3 key under ',
			link(TMDB_API_SETTINGS_URL, 'TMDB → Settings → API'),
			'.',
		);
		return fragment;
	}

	private bodyModeDescription(): DocumentFragment {
		const fragment = createFragment();
		const list = createEl('ul');
		for (const [label, text] of [
			['Leave alone', 'only episode checkboxes and newly aired seasons are touched.'],
			['Keep the managed block up to date', 'adds and refreshes a %% stremio %% region.'],
			['Rewrite from the template', 'regenerates the whole body, replacing what is there. Each rewrite is its own line in the preview.'],
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

async function copyToClipboard(text: string, button: HTMLButtonElement): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
		const original = button.textContent;
		button.textContent = 'Copied';
		window.setTimeout(() => {
			button.textContent = original;
		}, 1500);
	} catch {
		new Notice('Stremio Sync: could not reach the clipboard.');
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

function setSettingError(setting: Setting, message: string | null): void {
	setting.settingEl.toggleClass('is-invalid', Boolean(message));
	const existing = setting.settingEl.querySelector<HTMLElement>('.stremio-sync-setting-error');
	if (!message) {
		existing?.remove();
		return;
	}
	const error = existing ?? setting.settingEl.createDiv({ cls: 'stremio-sync-setting-error' });
	error.setText(message);
}
