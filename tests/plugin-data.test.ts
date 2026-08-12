import { describe, expect, it } from 'vitest';
import { sanitizePluginData } from '../src/model/plugin-data';
import { DATA_SCHEMA_VERSION, DEFAULT_DATA, DEFAULT_SETTINGS } from '../src/model/types';

describe('persisted plugin data', () => {
	it('preserves valid settings while normalizing vault paths', () => {
		const data = sanitizePluginData({
			schemaVersion: DATA_SCHEMA_VERSION,
			settings: {
				...DEFAULT_SETTINGS,
				authKeySecretId: 'stremio-key',
				movieFolder: '\\Media\\Movies\\',
				seriesFolder: 'Media//Series/',
				movieTemplate: '/Templates//Movie.md',
				seriesTemplate: 'Templates\\Series.md',
				properties: { ...DEFAULT_SETTINGS.properties, cover: 'poster' },
			},
			index: { tt1: 'Media/Movies/Arrival.md' },
			firstSyncDone: true,
			lastSyncMtime: '2026-08-01T10:00:00.000Z',
		});

		expect(data.settings.movieFolder).toBe('Media/Movies');
		expect(data.settings.seriesFolder).toBe('Media/Series');
		expect(data.settings.movieTemplate).toBe('Templates/Movie.md');
		expect(data.settings.seriesTemplate).toBe('Templates/Series.md');
		expect(data.settings.properties.cover).toBe('poster');
		expect(data.index).toEqual({ tt1: 'Media/Movies/Arrival.md' });
		expect(data.firstSyncDone).toBe(true);
		expect(data.lastSyncMtime).toBe('2026-08-01T10:00:00.000Z');
	});

	it('repairs malformed values with defaults and clamps supported ranges', () => {
		const data = sanitizePluginData({
			schemaVersion: DATA_SCHEMA_VERSION,
			settings: {
				authKeySecretId: 42,
				language: 'de-DE',
				includeUnwatchedLibrary: 'yes',
				sampledThresholdMinutes: -10,
				watchedThresholdPercent: 250,
				existingBodyMode: 'erase',
				autoSyncIntervalMinutes: Number.POSITIVE_INFINITY,
				properties: { cover: false, source: 'stremio' },
			},
			index: { tt1: 42, tt2: 'Series/Show.md' },
			firstSyncDone: 'yes',
		});

		expect(data.settings.authKeySecretId).toBe('');
		expect(data.settings.language).toBe(DEFAULT_SETTINGS.language);
		expect(data.settings.includeUnwatchedLibrary).toBe(DEFAULT_SETTINGS.includeUnwatchedLibrary);
		expect(data.settings.sampledThresholdMinutes).toBe(1);
		expect(data.settings.watchedThresholdPercent).toBe(100);
		expect(data.settings.existingBodyMode).toBe(DEFAULT_SETTINGS.existingBodyMode);
		expect(data.settings.autoSyncIntervalMinutes).toBe(DEFAULT_SETTINGS.autoSyncIntervalMinutes);
		expect(data.settings.properties.cover).toBe(DEFAULT_SETTINGS.properties.cover);
		expect(data.settings.properties.source).toBe('stremio');
		expect(data.index).toEqual({ tt2: 'Series/Show.md' });
		expect(data.firstSyncDone).toBe(false);
	});

	it('resets unversioned data instead of migrating legacy settings', () => {
		const data = sanitizePluginData({
			settings: {
				writeSourceProperty: false,
				properties: { start: 'start', end: 'watched-on' },
			},
			index: { tt1: 'legacy/old-note.md' },
			firstSyncDone: true,
		});

		expect(data).toEqual({ ...structuredClone(DEFAULT_DATA), settings: structuredClone(DEFAULT_SETTINGS) });
	});

	it('returns independent defaults for non-object input', () => {
		const data = sanitizePluginData({ schemaVersion: DATA_SCHEMA_VERSION });
		data.settings.properties.cover = 'changed';

		expect(data).toMatchObject({ ...DEFAULT_DATA, settings: { ...DEFAULT_SETTINGS, properties: { cover: 'changed' } } });
		expect(DEFAULT_SETTINGS.properties.cover).toBe('cover');
	});

	it('keeps only SecretStorage references in persisted data', () => {
		const data = sanitizePluginData({
			schemaVersion: DATA_SCHEMA_VERSION,
			settings: {
				...DEFAULT_SETTINGS,
				authKeySecretId: 'stremio-sync-auth-key',
				tmdbKeySecretId: 'tmdb-api-key',
			},
			secret: 'must-not-be-persisted',
		});

		expect(data.settings.authKeySecretId).toBe('stremio-sync-auth-key');
		expect(data.settings.tmdbKeySecretId).toBe('tmdb-api-key');
		expect(JSON.stringify(data)).not.toContain('must-not-be-persisted');
	});
});
