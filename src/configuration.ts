import type { WatchSyncSettings } from './model/types';
import { t } from './i18n';

export interface ConfigurationEnvironment {
	hasSecret(secretId: string): boolean;
	folderExists(path: string): boolean;
	markdownFileExists(path: string): boolean;
}

/** Empty disables the tag. Otherwise follow Obsidian's documented tag grammar. */
export function tagProblem(tag: string): string | null {
	if (!tag) return null;
	if (tag.startsWith('/') || tag.endsWith('/') || tag.includes('//')) {
		return t('tag.path');
	}
	if (/^\p{N}+$/u.test(tag) || !/^[\p{L}\p{N}\p{M}\p{S}_/-]+$/u.test(tag)) {
		return t('tag.characters');
	}
	return null;
}

function duplicatePropertyName(settings: WatchSyncSettings): string | null {
	const used = new Set<string>();
	for (const name of Object.values(settings.properties)) {
		if (!name) continue;
		if (used.has(name)) return name;
		used.add(name);
	}
	return null;
}

/** Returns the first problem that makes a sync unsafe to start. */
export function configurationProblem(
	settings: WatchSyncSettings,
	environment: ConfigurationEnvironment,
): string | null {
	if (!settings.provider) {
		return t('config.provider');
	}
	if (settings.importScopes.length === 0) {
		return t('config.scopes');
	}

	if (settings.provider === 'stremio') {
		const secretId = settings.authKeySecretId || settings.sessionSecretIds.stremio || '';
		if (!secretId || !environment.hasSecret(secretId)) {
			return t('config.secret');
		}
	}

	if (settings.provider === 'nuvio') {
		const secretId = settings.sessionSecretIds.nuvio || '';
		if (!secretId || !environment.hasSecret(secretId)) {
			return t('config.nuvioSecret');
		}
		if (!settings.nuvioProfileId) {
			return t('config.nuvioProfile');
		}
	}

	for (const [key, folder] of [
		['movie', settings.movieFolder],
		['series', settings.seriesFolder],
	] as const) {
		const label = t(`config.label.${key}`);
		if (!folder) return t('config.folderRequired', { label });
		if (!environment.folderExists(folder)) return t('config.folderMissing', { label, path: folder });
	}

	for (const [key, template] of [
		['movie', settings.movieTemplate],
		['series', settings.seriesTemplate],
	] as const) {
		if (template && !environment.markdownFileExists(template)) {
			const label = t(`config.label.${key}`);
			return t('config.templateMissing', { label, path: template });
		}
	}

	const duplicate = duplicatePropertyName(settings);
	if (duplicate) return t('config.duplicateProperty', { value: duplicate });

	const invalidTag = tagProblem(settings.doneTag);
	if (invalidTag) return t('config.invalidTag', { problem: invalidTag });
	return null;
}
