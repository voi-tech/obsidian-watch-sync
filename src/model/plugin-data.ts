import { normalizePath } from 'obsidian';
import {
	DATA_SCHEMA_VERSION,
	DEFAULT_DATA,
	DEFAULT_PROPERTY_NAMES,
	DEFAULT_SETTINGS,
	type ExistingBodyMode,
	type MetadataLanguage,
	type PluginData,
	type PropertyNames,
	type StremioSyncSettings,
	type SyncResult,
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

/** Empty is meaningful for optional paths; normalize only actual vault paths. */
export function normalizeOptionalPath(value: unknown, fallback = ''): string {
	const path = stringValue(value, fallback).trim();
	return path ? normalizePath(path) : '';
}

function propertyNames(value: unknown): PropertyNames {
	const stored = record(value);
	const name = (candidate: unknown, fallback: string): string => stringValue(candidate, fallback).trim();
	return {
		releaseDate: name(stored.releaseDate, DEFAULT_PROPERTY_NAMES.releaseDate),
		lastWatched: name(stored.lastWatched, DEFAULT_PROPERTY_NAMES.lastWatched),
		duration: name(stored.duration, DEFAULT_PROPERTY_NAMES.duration),
		cover: name(stored.cover, DEFAULT_PROPERTY_NAMES.cover),
		source: name(stored.source, DEFAULT_PROPERTY_NAMES.source),
	};
}

function settingsOf(value: unknown): StremioSyncSettings {
	const stored = record(value);
	return {
		authKeySecretId: stringValue(stored.authKeySecretId, DEFAULT_SETTINGS.authKeySecretId),
		tmdbKeySecretId: stringValue(stored.tmdbKeySecretId, DEFAULT_SETTINGS.tmdbKeySecretId),
		movieFolder: normalizeOptionalPath(stored.movieFolder, DEFAULT_SETTINGS.movieFolder),
		seriesFolder: normalizeOptionalPath(stored.seriesFolder, DEFAULT_SETTINGS.seriesFolder),
		movieTemplate: normalizeOptionalPath(stored.movieTemplate, DEFAULT_SETTINGS.movieTemplate),
		seriesTemplate: normalizeOptionalPath(stored.seriesTemplate, DEFAULT_SETTINGS.seriesTemplate),
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
		doneTag: stringValue(stored.doneTag, DEFAULT_SETTINGS.doneTag).replace(/^#+/, '').trim(),
		properties: propertyNames(stored.properties),
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

function syncResultOf(value: unknown): SyncResult | undefined {
	const result = record(value);
	const counts = ['created', 'adopted', 'updated', 'skipped', 'deselected', 'durationMs'] as const;
	if (!counts.every((key) => typeof result[key] === 'number' && Number.isFinite(result[key]))) return undefined;
	if (!Array.isArray(result.errors)) return undefined;
	const errors = result.errors
		.map(record)
		.filter((error) => typeof error.id === 'string' && typeof error.message === 'string')
		.map((error) => ({ id: error.id as string, message: error.message as string }));
	return {
		created: result.created as number,
		adopted: result.adopted as number,
		updated: result.updated as number,
		skipped: result.skipped as number,
		deselected: result.deselected as number,
		errors,
		durationMs: result.durationMs as number,
	};
}

/**
 * Repairs persisted data at the trust boundary before the rest of the plugin
 * sees it. Secrets remain references only; unknown or malformed values never
 * reach sync logic.
 */
export function sanitizePluginData(value: unknown): PluginData {
	const stored = record(value);
	if (stored.schemaVersion !== DATA_SCHEMA_VERSION) return structuredClone(DEFAULT_DATA);
	const lastReport = syncResultOf(stored.lastReport);
	return {
		...structuredClone(DEFAULT_DATA),
		schemaVersion: DATA_SCHEMA_VERSION,
		settings: settingsOf(stored.settings),
		index: indexOf(stored.index),
		firstSyncDone: booleanValue(stored.firstSyncDone, DEFAULT_DATA.firstSyncDone),
		...(typeof stored.lastSyncMtime === 'string' ? { lastSyncMtime: stored.lastSyncMtime } : {}),
		...(lastReport ? { lastReport } : {}),
	};
}
