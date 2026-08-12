import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type StremioSyncSettings } from '../src/model/types';

/**
 * Mirrors what the "Restore defaults" button does. Kept as a function here so
 * the rule it encodes — everything resets except what connects you to a service
 * — is stated once and checked.
 */
function restoreDefaults(current: StremioSyncSettings): StremioSyncSettings {
	return {
		...structuredClone(DEFAULT_SETTINGS),
		authKeySecretId: current.authKeySecretId,
		tmdbKeySecretId: current.tmdbKeySecretId,
	};
}

const customised: StremioSyncSettings = {
	...DEFAULT_SETTINGS,
	authKeySecretId: 'stremio-sync-auth-key',
	tmdbKeySecretId: 'my-tmdb',
	movieFolder: 'Movies',
	seriesFolder: 'Series',
	movieTemplate: 'Templates/Movie.md',
	doneTag: '',
	existingBodyMode: 'rewrite',
	watchedThresholdPercent: 95,
	sampledThresholdMinutes: 20,
	autoSyncEnabled: true,
	properties: { ...DEFAULT_SETTINGS.properties, cover: 'poster', source: '' },
};

describe('restore defaults', () => {
	it('puts every ordinary setting back', () => {
		const restored = restoreDefaults(customised);
		expect(restored.movieFolder).toBe(DEFAULT_SETTINGS.movieFolder);
		expect(restored.existingBodyMode).toBe('leave');
		expect(restored.watchedThresholdPercent).toBe(70);
		expect(restored.sampledThresholdMinutes).toBe(5);
		expect(restored.autoSyncEnabled).toBe(false);
		expect(restored.doneTag).toBe('done');
	});

	it('puts the property names back too', () => {
		const restored = restoreDefaults(customised);
		expect(restored.properties).toEqual(DEFAULT_SETTINGS.properties);
	});

	it('leaves you connected', () => {
		const restored = restoreDefaults(customised);
		expect(restored.authKeySecretId).toBe('stremio-sync-auth-key');
		expect(restored.tmdbKeySecretId).toBe('my-tmdb');
	});

	it('does not share objects with the defaults', () => {
		const restored = restoreDefaults(customised);
		restored.properties.cover = 'mutated';
		expect(DEFAULT_SETTINGS.properties.cover).toBe('cover');
	});

	it('covers every key, so a new setting cannot be forgotten', () => {
		expect(Object.keys(restoreDefaults(customised)).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
	});
});
