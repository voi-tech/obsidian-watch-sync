/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { renderTemplateReference } from '../src/ui/template-reference-view';
import { installObsidianDom } from './stubs/dom';

installObsidianDom();

describe('template reference view', () => {
	it('hides non-matching entries and empty groups when filtering', () => {
		const container = document.createElement('div');
		renderTemplateReference(container);

		const search = container.querySelector<HTMLInputElement>('.stremio-sync-ref-search');
		const entries = Array.from(container.querySelectorAll<HTMLElement>('.stremio-sync-ref-entry'));
		const groups = Array.from(container.querySelectorAll<HTMLElement>('.stremio-sync-ref-group'));
		expect(search).not.toBeNull();
		expect(entries.length).toBeGreaterThan(1);

		search!.value = 'title';
		search!.dispatchEvent(new Event('input', { bubbles: true }));

		expect(entries.some((entry) => !entry.hidden)).toBe(true);
		expect(entries.some((entry) => entry.hidden)).toBe(true);
		expect(groups.some((group) => group.hidden)).toBe(true);
	});
});
