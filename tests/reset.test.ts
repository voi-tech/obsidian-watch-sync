import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type WatchSyncSettings } from '../src/model/types';
import { restoreDefaultSettings as restoreDefaults } from '../src/model/plugin-data';

const customised: WatchSyncSettings = {
	...DEFAULT_SETTINGS,
	authKeySecretId: 'stremio-sync-auth-key',
	tmdbKeySecretId: 'my-tmdb',
	sessionSecretIds: { nuvio: 'watch-sync-nuvio-session' },
	nuvioProfileId: 'profile-1',
	nuvioProfileName: 'Household',
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
		expect(restored.doneTag).toBe('');
	});

	it('puts the property names back too', () => {
		const restored = restoreDefaults(customised);
		expect(restored.properties).toEqual(DEFAULT_SETTINGS.properties);
	});

	it('leaves you connected to every service', () => {
		const restored = restoreDefaults(customised);
		expect(restored.authKeySecretId).toBe('stremio-sync-auth-key');
		expect(restored.tmdbKeySecretId).toBe('my-tmdb');
		expect(restored.sessionSecretIds).toEqual({ nuvio: 'watch-sync-nuvio-session' });
	});

	it('still clears the profile selection, which is an ordinary setting', () => {
		const restored = restoreDefaults(customised);
		expect(restored.nuvioProfileId).toBe('');
		expect(restored.nuvioProfileName).toBe('');
	});

	it('does not share the session ids with the settings it restored from', () => {
		const restored = restoreDefaults(customised);
		restored.sessionSecretIds.nuvio = 'mutated';
		expect(customised.sessionSecretIds.nuvio).toBe('watch-sync-nuvio-session');
	});

	it('does not share objects with the defaults', () => {
		const restored = restoreDefaults(customised);
		restored.properties.cover = 'mutated';
	expect(DEFAULT_SETTINGS.properties.cover).toBeUndefined();
	});

	it('covers every key, so a new setting cannot be forgotten', () => {
		expect(Object.keys(restoreDefaults(customised)).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
	});
});
