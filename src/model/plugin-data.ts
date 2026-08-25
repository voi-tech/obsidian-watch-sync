import { normalizePath } from 'obsidian';
import {
	DATA_SCHEMA_VERSION,
	DEFAULT_DATA,
	DEFAULT_IMPORT_SCOPES,
	DEFAULT_NUVIO_BACKEND_URL,
	DEFAULT_SETTINGS,
	type ExistingBodyMode,
	type MetadataLanguage,
	type ImportScope,
	type PluginData,
	type ProviderSecretIds,
	type ProviderSyncCursors,
	type PropertyNames,
	type RecentEvent,
	type TemplatePropertyKey,
	type SelectedSyncProvider,
	type WatchSyncSettings,
} from './types';

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as JsonRecord)
		: {};
}

function stringValue(value: unknown, fallback: string): string {
	return typeof value === 'string' ? value : fallback;
}

/**
 * Keeps user-authored template content intact while removing characters that
 * cannot represent useful Markdown and making line endings portable.
 */
export function normalizeTemplateText(value: unknown, fallback = ''): string {
	if (typeof value !== 'string') return fallback;
	return value.replace(/\r\n?/g, '\n').replaceAll(String.fromCharCode(0), '');
}

function booleanValue(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function rangedInteger(value: unknown, fallback: number, min: number, max: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, Math.round(value)));
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback;
}

function trimmedString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function importScopesOf(value: unknown, legacy = false): ImportScope[] {
	if (!Array.isArray(value)) return legacy ? [...DEFAULT_IMPORT_SCOPES] : [];
	const result = [...new Set(value.filter((scope): scope is ImportScope =>
		scope === 'library' || scope === 'watchHistory' || scope === 'progress',
	))];
	return result.length > 0 || value.length === 0 ? result : legacy ? [...DEFAULT_IMPORT_SCOPES] : [];
}

function providerSecretIdsOf(value: unknown, legacyStremioId: string): ProviderSecretIds {
	const stored = record(value);
	const result: ProviderSecretIds = {};
	for (const provider of ['stremio', 'nuvio'] as const) {
		const id = trimmedString(stored[provider]);
		if (id) result[provider] = id;
	}
	// Schema 1 called the Stremio SecretStorage reference authKeySecretId.
	// Migrate it only when the new map has no explicit Stremio entry.
	if (!Object.prototype.hasOwnProperty.call(stored, 'stremio') && legacyStremioId) {
		result.stremio = legacyStremioId;
	}
	return result;
}

function backendUrlOf(value: unknown): string {
	const candidate = trimmedString(value);
	if (!candidate) return DEFAULT_NUVIO_BACKEND_URL;
	try {
		const url = new URL(candidate);
		if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || !url.hostname) {
			return DEFAULT_NUVIO_BACKEND_URL;
		}
		const path = url.pathname.replace(/\/+$/, '');
		return `${url.origin}${path}`;
	} catch {
		return DEFAULT_NUVIO_BACKEND_URL;
	}
}

function syncCursorsOf(value: unknown, legacyStremioMtime: unknown): ProviderSyncCursors {
	const stored = record(value);
	const result: ProviderSyncCursors = {};
	for (const provider of ['stremio', 'nuvio'] as const) {
		const cursor = trimmedString(stored[provider]);
		if (cursor) result[provider] = cursor;
	}
	if (!Object.prototype.hasOwnProperty.call(stored, 'stremio')) {
		const legacy = trimmedString(legacyStremioMtime);
		if (legacy) result.stremio = legacy;
	}
	return result;
}

/** Empty is meaningful for optional paths; normalize only actual vault paths. */
export function normalizeOptionalPath(value: unknown, fallback = ''): string {
	const path = stringValue(value, fallback).trim();
	return path ? normalizePath(path) : '';
}

const TEMPLATE_PROPERTY_KEYS: TemplatePropertyKey[] = [
	'title', 'original', 'source', 'provider', 'kind', 'year', 'years', 'released',
	'description', 'duration', 'genres', 'cast', 'director', 'cover', 'backdrop',
	'link', 'resume', 'imdb', 'status', 'progress', 'finished', 'watched', 'episodes', 'current',
];

function propertyNames(value: unknown, keepStored = true): PropertyNames {
	if (!keepStored) return {};
	const stored = record(value);
	return Object.fromEntries(
		TEMPLATE_PROPERTY_KEYS.flatMap((key) => {
			const name = stringValue(stored[key], '').trim();
			return name ? [[key, name]] : [];
		}),
	);
}

function selectedProviderOf(value: unknown, legacy: boolean, hasLegacyStremioSecret: boolean): SelectedSyncProvider {
	if (value === 'stremio' || value === 'nuvio') return value;
	return legacy && hasLegacyStremioSecret ? 'stremio' : DEFAULT_SETTINGS.provider;
}

function settingsOf(value: unknown, legacy = false, keepPropertyMappings = true): WatchSyncSettings {
	const stored = record(value);
	const authKeySecretId = stringValue(stored.authKeySecretId, DEFAULT_SETTINGS.authKeySecretId);
	return {
		provider: selectedProviderOf(stored.provider, legacy, Boolean(authKeySecretId)),
		importScopes: importScopesOf(stored.importScopes, legacy),
		authKeySecretId,
		tmdbKeySecretId: stringValue(stored.tmdbKeySecretId, DEFAULT_SETTINGS.tmdbKeySecretId),
		sessionSecretIds: providerSecretIdsOf(stored.sessionSecretIds, authKeySecretId),
		nuvioBackendUrl: backendUrlOf(stored.nuvioBackendUrl),
		nuvioProfileId: stringValue(stored.nuvioProfileId, DEFAULT_SETTINGS.nuvioProfileId).trim(),
		nuvioProfileName: stringValue(stored.nuvioProfileName, DEFAULT_SETTINGS.nuvioProfileName).trim(),
		movieFolder: normalizeOptionalPath(stored.movieFolder, DEFAULT_SETTINGS.movieFolder),
		seriesFolder: normalizeOptionalPath(stored.seriesFolder, DEFAULT_SETTINGS.seriesFolder),
		movieTemplate: normalizeOptionalPath(stored.movieTemplate, DEFAULT_SETTINGS.movieTemplate),
		seriesTemplate: normalizeOptionalPath(stored.seriesTemplate, DEFAULT_SETTINGS.seriesTemplate),
		movieTemplateText: normalizeTemplateText(stored.movieTemplateText, DEFAULT_SETTINGS.movieTemplateText),
		seriesTemplateText: normalizeTemplateText(stored.seriesTemplateText, DEFAULT_SETTINGS.seriesTemplateText),
		movieFilenamePattern: stringValue(stored.movieFilenamePattern, DEFAULT_SETTINGS.movieFilenamePattern),
		seriesFilenamePattern: stringValue(stored.seriesFilenamePattern, DEFAULT_SETTINGS.seriesFilenamePattern),
		language: oneOf<MetadataLanguage>(stored.language, ['pl-PL', 'en-US'], DEFAULT_SETTINGS.language),
		includeUnwatchedLibrary: booleanValue(
			stored.includeUnwatchedLibrary,
			DEFAULT_SETTINGS.includeUnwatchedLibrary,
		),
		skipSampledTitles: booleanValue(stored.skipSampledTitles, DEFAULT_SETTINGS.skipSampledTitles),
		sampledThresholdMinutes: rangedInteger(
			stored.sampledThresholdMinutes,
			DEFAULT_SETTINGS.sampledThresholdMinutes,
			1,
			60,
		),
		watchedThresholdPercent: rangedInteger(
			stored.watchedThresholdPercent,
			DEFAULT_SETTINGS.watchedThresholdPercent,
			10,
			100,
		),
		doneTag: stringValue(stored.doneTag, legacy ? 'done' : DEFAULT_SETTINGS.doneTag).replace(/^#+/, '').trim(),
		properties: propertyNames(stored.properties, keepPropertyMappings),
		confirmBeforeWriting: booleanValue(stored.confirmBeforeWriting, DEFAULT_SETTINGS.confirmBeforeWriting),
		existingBodyMode: oneOf<ExistingBodyMode>(
			stored.existingBodyMode,
			['leave', 'managed-block', 'rewrite'],
			DEFAULT_SETTINGS.existingBodyMode,
		),
		autoSyncEnabled: booleanValue(stored.autoSyncEnabled, DEFAULT_SETTINGS.autoSyncEnabled),
		autoSyncIntervalMinutes: rangedInteger(
			stored.autoSyncIntervalMinutes,
			DEFAULT_SETTINGS.autoSyncIntervalMinutes,
			15,
			720,
		),
	};
}

function indexOf(value: unknown): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [id, path] of Object.entries(record(value))) {
		if (typeof path === 'string' && path.trim()) result[id] = normalizePath(path);
	}
	return result;
}

function recentEventsOf(value: unknown): RecentEvent[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap<RecentEvent>((entry) => {
		const item = record(entry);
		const at = typeof item.at === 'string' && Number.isFinite(Date.parse(item.at)) ? item.at : '';
		const kind = item.kind === 'sync' || item.kind === 'connection' ? item.kind : null;
		const status = item.status === 'success' || item.status === 'warning' || item.status === 'error' ? item.status : null;
		return at && kind && status && typeof item.message === 'string' && item.message.trim()
			? [{
				at,
				kind: kind === 'sync' ? 'sync' : 'connection',
				status: status === 'success' ? 'success' : status === 'warning' ? 'warning' : 'error',
				message: item.message.slice(0, 300),
			}]
			: [];
	}).slice(0, 20);
}

/**
 * Repairs persisted data at the trust boundary before the rest of the plugin
 * sees it. Secrets remain references only; unknown or malformed values never
 * reach sync logic.
 */
/**
 * What the "Restore defaults" button does. Everything on the settings page goes
 * back to its shipped value except the references that connect you to a service;
 * losing those would silently disconnect an account the dialog promised to keep.
 */
export function restoreDefaultSettings(current: WatchSyncSettings): WatchSyncSettings {
	return {
		...structuredClone(DEFAULT_SETTINGS),
		authKeySecretId: current.authKeySecretId,
		tmdbKeySecretId: current.tmdbKeySecretId,
		sessionSecretIds: structuredClone(current.sessionSecretIds),
	};
}

export function sanitizePluginData(value: unknown): PluginData {
	const stored = record(value);
	// Schema 1 is the existing released contract. Additive fields are migrated
	// below so users keep their settings, index and incremental watermark.
	if (stored.schemaVersion !== 1 && stored.schemaVersion !== 2 && stored.schemaVersion !== DATA_SCHEMA_VERSION) {
		return structuredClone(DEFAULT_DATA);
	}
	return {
		...structuredClone(DEFAULT_DATA),
		schemaVersion: DATA_SCHEMA_VERSION,
		settings: settingsOf(
			stored.settings,
			stored.schemaVersion === 1,
			stored.schemaVersion === DATA_SCHEMA_VERSION,
		),
		index: indexOf(stored.index),
		syncCursors: syncCursorsOf(stored.syncCursors, stored.lastSyncMtime),
		firstSyncDone: booleanValue(stored.firstSyncDone, DEFAULT_DATA.firstSyncDone),
		recentEvents: recentEventsOf(stored.recentEvents),
		...(typeof stored.lastSyncMtime === 'string' ? { lastSyncMtime: stored.lastSyncMtime } : {}),
	};
}
