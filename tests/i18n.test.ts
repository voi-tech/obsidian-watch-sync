import { describe, expect, it } from 'vitest';
import { localeForLanguage, translate } from '../src/i18n';

describe('UI localization', () => {
	it('uses Polish for Polish Obsidian locales and English otherwise', () => {
		expect(localeForLanguage('pl')).toBe('pl');
		expect(localeForLanguage('pl-PL')).toBe('pl');
		expect(localeForLanguage('en')).toBe('en');
		expect(localeForLanguage('de')).toBe('en');
	});

	it('interpolates values in translated messages', () => {
		expect(translate('en', 'sync.progress', { done: 2, total: 5 })).toBe('Metadata 2/5…');
		expect(translate('pl', 'sync.progress', { done: 2, total: 5 })).toBe('Metadane 2/5…');
	});

	it('falls back to English when a translation key is missing', () => {
		expect(translate('pl', 'sync.progress', { done: 1, total: 1 })).toBe('Metadane 1/1…');
		expect(translate('pl', 'missing.key')).toBe('missing.key');
	});
});
