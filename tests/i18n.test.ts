import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { allStrings, PLUGIN_NAME, t } from '../src/i18n';

const sourceRoot = fileURLToPath(new URL('../src', import.meta.url));

function sourceFiles(directory: string): string[] {
	return readdirSync(directory).flatMap((entry) => {
		const path = join(directory, entry);
		if (statSync(path).isDirectory()) return sourceFiles(path);
		return path.endsWith('.ts') ? [path] : [];
	});
}

/**
 * Literal keys used at call sites. Keys built from a template literal
 * (`config.label.${key}`) are resolved at runtime and cannot be collected here.
 */
function referencedKeys(): Set<string> {
	const keys = new Set<string>();
	for (const file of sourceFiles(sourceRoot)) {
		if (file.endsWith('i18n.ts')) continue;
		const source = readFileSync(file, 'utf8');
		for (const match of source.matchAll(/\bt\(\s*'([^']+)'/g)) keys.add(match[1]);
		for (const match of source.matchAll(/\bt\(\s*[^)'"]+\?\s*'([^']+)'\s*:\s*'([^']+)'/g)) {
			keys.add(match[1]);
			keys.add(match[2]);
		}
	}
	return keys;
}

describe('UI strings', () => {
	it('interpolates values', () => {
		expect(t('sync.progress', { done: 2, total: 5 })).toBe('Metadata 2/5…');
	});

	it('returns the key itself when it is unknown', () => {
		expect(t('missing.key')).toBe('missing.key');
	});

	it('leaves placeholders alone when no value is supplied', () => {
		expect(t('sync.progress', { done: 2 })).toBe('Metadata 2/{total}…');
	});

	it('defines every key used in the source', () => {
		const defined = allStrings();
		const missing = [...referencedKeys()].filter((key) => !(key in defined)).sort();
		expect(missing).toEqual([]);
	});

	it('names the plugin through PLUGIN_NAME only', () => {
		const stale = Object.entries(allStrings())
			.filter(([, value]) => /stremio sync|watch sync/i.test(value) && !value.includes(PLUGIN_NAME))
			.map(([key]) => key)
			.sort();
		expect(stale).toEqual([]);
	});

	it('spells Nuvio consistently', () => {
		const lowercase = Object.entries(allStrings())
			.filter(([, value]) => /\bnuvio\b/.test(value))
			.map(([key]) => key)
			.sort();
		expect(lowercase).toEqual([]);
	});
});
