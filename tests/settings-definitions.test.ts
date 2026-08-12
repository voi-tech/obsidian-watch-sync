/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { Setting } from 'obsidian';
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
	it('declares native controls and conditional visibility', () => {
		const { tab, plugin } = makeTab();
		plugin.data.settings.skipSampledTitles = false;
		const definitions = definitionsOf(tab);
		const controls = definitions.filter((definition) => 'control' in definition) as {
			control: { key: string; type: string };
		}[];

		expect(controls.find(({ control }) => control.key === 'skipSampledTitles')?.control.type).toBe('toggle');
		expect(controls.find(({ control }) => control.key === 'sampledThresholdMinutes')?.control.type).toBe('slider');
		expect(controls.find(({ control }) => control.key === 'existingBodyMode')?.control.type).toBe('dropdown');
		expect(controls.find(({ control }) => control.key === 'movieFolder')).toBeUndefined();
		expect(definitions.some((definition) => definition.name === 'Movie folder' && 'render' in definition)).toBe(true);

		const threshold = definitions.find((definition) => definition.name === 'Counts as sampled below')!;
		expect((threshold.visible as () => boolean)()).toBe(false);
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

	it('places template reference in a full-width wrapper and exposes a reset button', () => {
		const { tab } = makeTab();
		const definitions = definitionsOf(tab);
		const template = definitions.find((definition) => definition.name === 'Template reference')! as {
			render: (setting: Setting, group: unknown) => void;
		};
		const reset = definitions.find((definition) => definition.name === 'Restore defaults')! as {
			render: (setting: Setting, group: unknown) => void;
		};
		const templateRow = new Setting(document.body);
		const resetRow = new Setting(document.body);

		template.render(templateRow, {});
		reset.render(resetRow, {});

		expect(templateRow.settingEl.classList.contains('stremio-sync-wide-setting')).toBe(true);
		expect(templateRow.controlEl.querySelector('.stremio-sync-template-reference')).not.toBeNull();
		expect(templateRow.controlEl.children).toHaveLength(1);
		expect(templateRow.settingEl.querySelectorAll(':scope > details')).toHaveLength(0);
		expect(resetRow.controlEl.querySelector('button')?.textContent).toBe('Restore defaults');
	});
});
