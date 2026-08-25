import { describe, expect, it } from 'vitest';
import { configurationProblem, tagProblem } from '../src/configuration';
import { DEFAULT_SETTINGS, type WatchSyncSettings } from '../src/model/types';

const configured = (overrides: Partial<WatchSyncSettings> = {}): WatchSyncSettings => ({
	...DEFAULT_SETTINGS,
	provider: 'stremio',
	authKeySecretId: 'stremio-secret',
	importScopes: ['library', 'watchHistory', 'progress'],
	movieFolder: 'Movies',
	seriesFolder: 'Series',
	properties: { ...DEFAULT_SETTINGS.properties },
	...overrides,
});

const environment = (overrides: Record<string, boolean> = {}) => ({
	hasSecret: (id: string) => overrides[`secret:${id}`] ?? true,
	folderExists: (path: string) => overrides[`folder:${path}`] ?? true,
	markdownFileExists: (path: string) => overrides[`template:${path}`] ?? true,
});

describe('configuration validation', () => {
	it('blocks sync when a stored secret reference has no value', () => {
		const problem = configurationProblem(
			configured(),
			environment({ 'secret:stremio-secret': false }),
		);
		expect(problem).toContain('Stremio secret');
	});

	it('requires an explicit source before checking source credentials', () => {
		const problem = configurationProblem(
			configured({ provider: null, authKeySecretId: '', importScopes: [] }),
			environment(),
		);
		expect(problem).toContain('choose a sync source');
	});

	it('requires the selected Nuvio profile and session secret', () => {
		const missingSession = configurationProblem(
			configured({
				provider: 'nuvio',
				authKeySecretId: '',
				sessionSecretIds: {},
				nuvioProfileId: 'profile-1',
			}),
			environment(),
		);
		expect(missingSession).toContain('Nuvio session is missing');

		const missingProfile = configurationProblem(
			configured({
				provider: 'nuvio',
				authKeySecretId: '',
				sessionSecretIds: { nuvio: 'nuvio-session' },
				nuvioProfileId: '',
			}),
			environment(),
		);
		expect(missingProfile).toContain('choose a Nuvio profile');
	});

	it('does not require inactive provider credentials', () => {
		expect(configurationProblem(
			configured({ provider: 'nuvio', authKeySecretId: 'stremio-secret', sessionSecretIds: { nuvio: 'nuvio-session' }, nuvioProfileId: 'profile-1' }),
			environment({ 'secret:stremio-secret': false }),
		)).toBeNull();

		expect(configurationProblem(
			configured({ provider: 'stremio', authKeySecretId: 'stremio-secret', sessionSecretIds: {} }),
			environment({ 'secret:stremio-secret': true }),
		)).toBeNull();
	});

	it('blocks sync when an explicitly selected template disappeared', () => {
		const problem = configurationProblem(
			configured({ movieTemplate: 'Templates/Movie.md' }),
			environment({ 'template:Templates/Movie.md': false }),
		);
		expect(problem).toContain('movie template');
	});

	it('allows an empty template because it selects the built-in template', () => {
		expect(configurationProblem(configured({ movieTemplate: '', seriesTemplate: '' }), environment())).toBeNull();
	});

	it('blocks duplicate non-empty property names', () => {
		const settings = configured({
		properties: { ...DEFAULT_SETTINGS.properties, cover: 'source', link: 'source' },
		});
		expect(configurationProblem(settings, environment())).toContain('property name');
	});

	it('blocks tags Obsidian cannot index', () => {
		expect(configurationProblem(configured({ doneTag: 'watch list' }), environment())).toContain('completion tag');
	});

	it('accepts Unicode and nested Obsidian tags, and allows disabling the tag', () => {
		expect(tagProblem('obejrzane/2026')).toBeNull();
		expect(tagProblem('filmy-ukończone')).toBeNull();
		expect(tagProblem('2026-filmy')).toBeNull();
		expect(tagProblem('filmy/🎬')).toBeNull();
		expect(tagProblem('')).toBeNull();
	});

	it('rejects a numeric-only tag and malformed nested tags', () => {
		expect(tagProblem('2026')).not.toBeNull();
		expect(tagProblem('/done')).not.toBeNull();
		expect(tagProblem('done//movie')).not.toBeNull();
	});
});
