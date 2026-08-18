/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as obsidian from 'obsidian';
import { Platform, Setting } from 'obsidian';
import { StremioSyncSettingTab } from '../src/settings';
import { DEFAULT_DATA } from '../src/model/types';
import type StremioSyncPlugin from '../src/main';
import { installObsidianDom } from './stubs/dom';

const globalObsidian = globalThis as typeof globalThis & {
	createFragment: (callback?: (fragment: DocumentFragment) => void) => DocumentFragment;
	createEl: <K extends keyof HTMLElementTagNameMap>(
		tag: K,
		options?: { text?: string; cls?: string } | string,
	) => HTMLElementTagNameMap[K];
};

globalObsidian.createFragment = (callback) => {
	const fragment = document.createDocumentFragment();
	callback?.(fragment);
	return fragment;
};
globalObsidian.createEl = (tag, options) => {
	const element = document.createElement(tag);
	if (typeof options === 'string') element.textContent = options;
	else if (options) {
		if (typeof options.text === 'string') element.textContent = options.text;
		if (typeof options.cls === 'string') element.className = options.cls;
	}
	return element;
};

installObsidianDom();

function makeTab(): { tab: StremioSyncSettingTab; plugin: StremioSyncPlugin; persist: ReturnType<typeof vi.fn> } {
	const persist = vi.fn().mockResolvedValue(undefined);
	const plugin = {
		app: {},
		data: structuredClone(DEFAULT_DATA),
		persist,
		restartAutoSync: vi.fn(),
	} as unknown as StremioSyncPlugin;
	const tab = new StremioSyncSettingTab(plugin);
	Object.defineProperty(tab, 'update', { configurable: true, value: vi.fn() });
	return { tab, plugin, persist };
}

function definitionsOf(tab: StremioSyncSettingTab): Record<string, unknown>[] {
	return tab
		.getSettingDefinitions()
		.flatMap((item) => ('items' in item && item.items ? item.items : [item])) as unknown as Record<string, unknown>[];
}

describe('declarative settings', () => {
	afterEach(() => {
		Platform.isMobileApp = false;
		vi.restoreAllMocks();
	});

	it('declares native controls and conditional visibility', () => {
		const { tab, plugin } = makeTab();
		plugin.data.settings.skipSampledTitles = false;
		const definitions = definitionsOf(tab);
		const controls = definitions.filter((definition) => 'control' in definition) as {
			control: { key: string; type: string; includeRoot?: boolean };
		}[];

		expect(controls.find(({ control }) => control.key === 'skipSampledTitles')?.control.type).toBe('toggle');
		expect(controls.find(({ control }) => control.key === 'sampledThresholdMinutes')?.control.type).toBe('slider');
		expect(controls.find(({ control }) => control.key === 'existingBodyMode')?.control.type).toBe('dropdown');
		expect(controls.find(({ control }) => control.key === 'movieFolder')?.control.type).toBe('folder');
		expect(controls.find(({ control }) => control.key === 'movieFolder')?.control.includeRoot).toBe(true);
		expect(controls.find(({ control }) => control.key === 'movieTemplate')?.control.type).toBe('file');
		expect(definitions.find((definition) => definition.name === 'Movie template')?.desc).toContain('Start typing');

		const threshold = definitions.find((definition) => definition.name === 'Treat as sampled below')!;
		expect((threshold.visible as () => boolean)()).toBe(false);
	});

	it('organizes settings into clear native sections', () => {
		const { tab } = makeTab();
		const groups = tab.getSettingDefinitions().filter((item) => 'type' in item) as { heading?: string }[];

		expect(groups.map((group) => group.heading)).toEqual([
			'Connection',
			'Files and folders',
			'Library filtering',
			'Notes',
			'Syncing',
			'Metadata',
			'Properties',
			'Reset',
		]);
	});

	it('uses the Obsidian language for setting labels without changing stored metadata language', () => {
		const { tab, plugin } = makeTab();
		vi.spyOn(obsidian, 'getLanguage').mockReturnValue('pl');

		const definitions = definitionsOf(tab);
		const groups = tab.getSettingDefinitions().filter((item) => 'type' in item) as { heading?: string }[];

		expect(groups[0].heading).toBe('Połączenie');
		expect(definitions.find((definition) => definition.name === 'Język metadanych')).toBeDefined();
		expect(plugin.data.settings.language).toBe('pl-PL');
	});

	it('keeps custom rendering only for pairing, secrets, and a deliberate reset button', () => {
		const { tab } = makeTab();
		const definitions = definitionsOf(tab);
		const rendered = definitions.filter((definition) => 'render' in definition).map((definition) => definition.name);

		expect(rendered).toEqual(['Stremio account', 'TMDB API key', 'Restore defaults']);
		expect(definitions.find((definition) => definition.name === 'Enter an auth key manually')).toBeUndefined();
		expect(definitions.find((definition) => definition.name === 'Template reference')).toBeUndefined();
	});

	it('uses a visible warning button for restoring defaults', () => {
		const { tab } = makeTab();
		const reset = definitionsOf(tab).find((definition) => definition.name === 'Restore defaults')! as {
			render: (setting: Setting) => void;
		};
		const container = document.createElement('div');

		reset.render(new Setting(container));

		const button = container.querySelector('button');
		expect(button?.textContent).toBe('Restore defaults');
		expect(button?.classList.contains('mod-warning')).toBe(true);
	});

	it('reads and writes plugin.data.settings through control accessors', async () => {
		const { tab, plugin, persist } = makeTab();

		expect(tab.getControlValue('properties.cover')).toBe('cover');
		await tab.setControlValue('skipSampledTitles', true);
		await tab.setControlValue('properties.cover', 'poster');
		await tab.setControlValue('doneTag', '##Finished');

		expect(plugin.data.settings.skipSampledTitles).toBe(true);
		expect(plugin.data.settings.properties.cover).toBe('poster');
		expect(plugin.data.settings.doneTag).toBe('Finished');
		expect(persist).toHaveBeenCalledTimes(3);
	});

	it('does not expose automatic sync controls on mobile', () => {
		Platform.isMobileApp = true;
		const { tab } = makeTab();
		const definitions = definitionsOf(tab);

		expect(definitions.some((definition) => definition.name === 'Sync in the background')).toBe(false);
		expect(definitions.some((definition) => definition.name === 'Every')).toBe(false);
	});

	it('validates duplicate property names and tags before persistence', () => {
		const { tab } = makeTab();
		const definitions = definitionsOf(tab);
		const cover = definitions.find((definition) => definition.name === 'Poster')! as {
			control: { validate: (value: string) => string | undefined };
		};
		const tag = definitions.find((definition) => definition.name === 'Completion tag')! as {
			control: { validate: (value: string) => string | undefined };
		};
		const validateCover = (value: string) => cover.control.validate(value);
		const validateTag = (value: string) => tag.control.validate(value);

		expect(validateCover('source')).toContain('already used');
		expect(validateCover('poster')).toBeUndefined();
		expect(validateTag('bad//tag')).toContain('tag');
		expect(validateTag('Watched')).toBeUndefined();
	});

});
