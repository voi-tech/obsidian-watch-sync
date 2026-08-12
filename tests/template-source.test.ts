import { describe, expect, it } from 'vitest';
import { TFile } from 'obsidian';
import { readTemplateSource } from '../src/vault/template-source';

describe('template source loading', () => {
	it('uses the built-in template only when the configured path is empty', async () => {
		const vault = {
			getFileByPath: () => null,
			cachedRead: async () => 'unused',
		};
		await expect(readTemplateSource(vault, '')).resolves.toBe('');
	});

	it('fails instead of silently falling back when a selected template disappeared', async () => {
		const vault = {
			getFileByPath: () => null,
			cachedRead: async () => 'unused',
		};
		await expect(readTemplateSource(vault, 'Templates/Movie.md')).rejects.toThrow('Templates/Movie.md');
	});

	it('reads an existing Markdown template', async () => {
		const file = Object.assign(new TFile(), {
			path: 'Templates/Movie.md',
			basename: 'Movie',
			extension: 'md',
		});
		const vault = {
			getFileByPath: () => file,
			cachedRead: async (selected: TFile) => (selected === file ? '# {{title}}' : 'wrong'),
		};
		await expect(readTemplateSource(vault, 'Templates/Movie.md')).resolves.toBe('# {{title}}');
	});
});
