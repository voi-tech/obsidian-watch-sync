import { describe, expect, it } from 'vitest';
import { sanitizePluginData } from '../src/model/plugin-data';
import { DATA_SCHEMA_VERSION, DEFAULT_DATA, DEFAULT_SETTINGS } from '../src/model/types';

describe('persisted plugin data', () => {
	it('ships with no source, scopes, or completion tag selected', () => {
		expect(DEFAULT_SETTINGS.provider).toBeNull();
		expect(DEFAULT_SETTINGS.importScopes).toEqual([]);
		expect(DEFAULT_SETTINGS.doneTag).toBe('');
		expect(DEFAULT_SETTINGS.movieTemplateText).toBe('');
		expect(DEFAULT_SETTINGS.seriesTemplateText).toBe('');
		expect(DEFAULT_SETTINGS.properties).toEqual({});
	});

	it('does not carry legacy property mappings into the flat template-key mapping', () => {
		const data = sanitizePluginData({
			schemaVersion: 2,
			settings: { ...DEFAULT_SETTINGS, properties: { source: 'source', cover: 'cover' } },
		});

		expect(data.settings.properties).toEqual({});
	});

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
				movieTemplateText: '\r\n# {{title}}\r\n',
				seriesTemplateText: '---\r\n# {{title}}\r\n',
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
		expect(data.settings.movieTemplateText).toBe('\n# {{title}}\n');
		expect(data.settings.seriesTemplateText).toBe('---\n# {{title}}\n');
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
			properties: { cover: false, link: 'stremio' },
			},
			index: { tt1: 42, tt2: 'Series/Show.md' },
			firstSyncDone: 'yes',
		});

		expect(data.settings.authKeySecretId).toBe('');
		expect(data.settings.movieTemplateText).toBe('');
		expect(data.settings.seriesTemplateText).toBe('');
		expect(data.settings.language).toBe(DEFAULT_SETTINGS.language);
		expect(data.settings.includeUnwatchedLibrary).toBe(DEFAULT_SETTINGS.includeUnwatchedLibrary);
		expect(data.settings.sampledThresholdMinutes).toBe(1);
		expect(data.settings.watchedThresholdPercent).toBe(100);
		expect(data.settings.existingBodyMode).toBe(DEFAULT_SETTINGS.existingBodyMode);
		expect(data.settings.autoSyncIntervalMinutes).toBe(DEFAULT_SETTINGS.autoSyncIntervalMinutes);
		expect(data.settings.properties.cover).toBe(DEFAULT_SETTINGS.properties.cover);
		expect(data.settings.properties.link).toBe('stremio');
		expect(data.index).toEqual({ tt2: 'Series/Show.md' });
		expect(data.firstSyncDone).toBe(false);
	});

	it('removes null characters without trimming user-authored template content', () => {
		const data = sanitizePluginData({
			schemaVersion: DATA_SCHEMA_VERSION,
			settings: {
				...DEFAULT_SETTINGS,
				movieTemplateText: '  # {{title}}\u0000\n',
				seriesTemplateText: 42,
			},
		});

		expect(data.settings.movieTemplateText).toBe('  # {{title}}\n');
		expect(data.settings.seriesTemplateText).toBe('');
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
		expect(DEFAULT_SETTINGS.properties.cover).toBeUndefined();
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

	it('keeps a small, valid local history of recent events', () => {
		const data = sanitizePluginData({
			schemaVersion: DATA_SCHEMA_VERSION,
			recentEvents: Array.from({ length: 24 }, (_, index) => ({
				at: `2026-08-25T12:${String(index).padStart(2, '0')}:00.000Z`,
				kind: 'sync',
				status: 'success',
				message: `Event ${index}`,
			})),
		});

		expect(data.recentEvents).toHaveLength(20);
		expect(data.recentEvents[0]).toMatchObject({ message: 'Event 0' });
		expect(data.recentEvents.at(-1)).toMatchObject({ message: 'Event 19' });
	});

	it('drops invalid recent events and old reports during migration', () => {
		const data = sanitizePluginData({
			schemaVersion: DATA_SCHEMA_VERSION,
			lastReport: { created: 1 },
			recentEvents: [
				{ at: 'not-a-date', kind: 'sync', status: 'success', message: 'Invalid' },
				{ at: '2026-08-25T12:00:00.000Z', kind: 'sync', status: 'success', message: 'Kept' },
			],
		});

		expect(data.recentEvents).toEqual([{
			at: '2026-08-25T12:00:00.000Z', kind: 'sync', status: 'success', message: 'Kept',
		}]);
		expect('lastReport' in data).toBe(false);
	});

	it('sanitizes the multi-provider import contract', () => {
		const data = sanitizePluginData({
			schemaVersion: DATA_SCHEMA_VERSION,
			settings: {
				...DEFAULT_SETTINGS,
				provider: 'nuvio',
				importScopes: ['library', 'watchHistory', 'watchHistory', 'not-supported'],
				nuvioBackendUrl: ' https://my-nuvio.example/ ',
				nuvioProfileId: ' profile-2 ',
				nuvioProfileName: ' Kids ',
				sessionSecretIds: { nuvio: 'nuvio-session-id', stremio: 'stremio-session-id' },
			},
			syncCursors: { stremio: 'stremio-cursor', nuvio: 'nuvio-cursor' },
		});

		expect(data.settings.provider).toBe('nuvio');
		expect(data.settings.importScopes).toEqual(['library', 'watchHistory']);
		expect(data.settings.nuvioBackendUrl).toBe('https://my-nuvio.example');
		expect(data.settings.nuvioProfileId).toBe('profile-2');
		expect(data.settings.nuvioProfileName).toBe('Kids');
		expect(data.settings.sessionSecretIds).toEqual({
			stremio: 'stremio-session-id',
			nuvio: 'nuvio-session-id',
		});
		expect(data.syncCursors).toEqual({ stremio: 'stremio-cursor', nuvio: 'nuvio-cursor' });
	});

	it('migrates schema 1 without discarding existing settings, index, or Stremio watermark', () => {
		const data = sanitizePluginData({
			schemaVersion: 1,
			settings: {
				...DEFAULT_SETTINGS,
				provider: 'stremio',
				importScopes: ['library', 'watchHistory', 'progress'],
				doneTag: 'done',
				authKeySecretId: 'existing-stremio-secret',
				movieFolder: 'Movies',
			},
			index: { tt1: 'Movies/Arrival.md' },
			lastSyncMtime: '2026-08-01T10:00:00.000Z',
			firstSyncDone: true,
		});

		expect(data.schemaVersion).toBe(DATA_SCHEMA_VERSION);
		expect(data.settings.authKeySecretId).toBe('existing-stremio-secret');
		expect(data.settings.sessionSecretIds).toEqual({ stremio: 'existing-stremio-secret' });
		expect(data.settings.movieFolder).toBe('Movies');
		expect(data.index).toEqual({ tt1: 'Movies/Arrival.md' });
		expect(data.lastSyncMtime).toBe('2026-08-01T10:00:00.000Z');
		expect(data.syncCursors).toEqual({ stremio: '2026-08-01T10:00:00.000Z' });
		expect(data.firstSyncDone).toBe(true);
	});

	it('migrates a pre-provider schema 1 account to Stremio with its legacy scopes', () => {
		const data = sanitizePluginData({
			schemaVersion: 1,
			settings: {
				authKeySecretId: 'existing-stremio-secret',
				movieFolder: 'Movies',
				seriesFolder: 'Series',
			},
		});

		expect(data.settings.provider).toBe('stremio');
		expect(data.settings.importScopes).toEqual(['library', 'watchHistory', 'progress']);
		expect(data.settings.doneTag).toBe('done');
	});

	it('rejects secret values and invalid provider fields while keeping safe defaults', () => {
		const data = sanitizePluginData({
			schemaVersion: DATA_SCHEMA_VERSION,
			settings: {
				...DEFAULT_SETTINGS,
				provider: 'trakt',
				importScopes: [42],
				nuvioBackendUrl: 'javascript:alert(1)',
				nuvioProfileId: 42,
				nuvioProfileName: false,
				sessionSecretIds: {
					stremio: 'safe-id',
					nuvio: 42,
				},
				accessToken: 'do-not-persist',
			},
			syncCursors: { stremio: 42, nuvio: '  ' },
			nuvioToken: 'do-not-persist',
		});

		expect(data.settings.provider).toBe(DEFAULT_SETTINGS.provider);
		expect(data.settings.importScopes).toEqual(DEFAULT_SETTINGS.importScopes);
		expect(data.settings.nuvioBackendUrl).toBe(DEFAULT_SETTINGS.nuvioBackendUrl);
		expect(data.settings.nuvioProfileId).toBe('');
		expect(data.settings.nuvioProfileName).toBe('');
		expect(data.settings.sessionSecretIds).toEqual({ stremio: 'safe-id' });
		expect(data.syncCursors).toEqual({});
		expect(JSON.stringify(data)).not.toContain('do-not-persist');
	});
});
