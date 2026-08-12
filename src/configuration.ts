import type { StremioSyncSettings } from './model/types';

export interface ConfigurationEnvironment {
	hasSecret(secretId: string): boolean;
	folderExists(path: string): boolean;
	markdownFileExists(path: string): boolean;
}

/** Empty disables the tag. Otherwise follow Obsidian's documented tag grammar. */
export function tagProblem(tag: string): string | null {
	if (!tag) return null;
	if (tag.startsWith('/') || tag.endsWith('/') || tag.includes('//')) {
		return 'Use a valid Obsidian tag without empty path segments.';
	}
	if (/^\p{N}+$/u.test(tag) || !/^[\p{L}\p{N}\p{M}\p{S}_/-]+$/u.test(tag)) {
		return 'Use letters, numbers, underscores, hyphens, slashes, or Unicode symbols; a tag cannot be numeric-only.';
	}
	return null;
}

function duplicatePropertyName(settings: StremioSyncSettings): string | null {
	const used = new Set<string>();
	const names = settings.properties;
	for (const name of [names.releaseDate, names.lastWatched, names.duration, names.cover, names.source]) {
		if (!name) continue;
		if (used.has(name)) return name;
		used.add(name);
	}
	return null;
}

/** Returns the first problem that makes a sync unsafe to start. */
export function configurationProblem(
	settings: StremioSyncSettings,
	environment: ConfigurationEnvironment,
): string | null {
	if (!settings.authKeySecretId || !environment.hasSecret(settings.authKeySecretId)) {
		return 'the Stremio secret is missing — connect the account again in settings.';
	}

	for (const [label, folder] of [
		['movie', settings.movieFolder],
		['series', settings.seriesFolder],
	] as const) {
		if (!folder) return `no ${label} folder selected.`;
		if (!environment.folderExists(folder)) return `the ${label} folder "${folder}" does not exist.`;
	}

	for (const [label, template] of [
		['movie', settings.movieTemplate],
		['series', settings.seriesTemplate],
	] as const) {
		if (template && !environment.markdownFileExists(template)) {
			return `the ${label} template "${template}" is not an existing Markdown note.`;
		}
	}

	const duplicate = duplicatePropertyName(settings);
	if (duplicate) return `the property name "${duplicate}" is used more than once.`;

	const invalidTag = tagProblem(settings.doneTag);
	if (invalidTag) return `the completion tag is invalid. ${invalidTag}`;
	return null;
}
