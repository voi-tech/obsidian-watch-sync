import type { NormalizedMedia } from '../model/types';

/**
 * The one region of an existing note the plugin is allowed to rewrite.
 *
 * Templates only ever run when a note is created — rendering one over a note the
 * user has written would destroy their text. The managed block is the way to
 * keep template-driven content fresh in a note that already exists: it is
 * explicitly delimited, so both sides know exactly what belongs to the plugin.
 *
 * The markers are Obsidian comments, invisible in reading view.
 */
export const MANAGED_START = '%% stremio %%';
export const MANAGED_END = '%% /stremio %%';

export function hasManagedBlock(content: string): boolean {
	return boundsOf(content) !== null;
}

export function readManagedBlock(content: string): string | null {
	const bounds = boundsOf(content);
	return bounds ? content.slice(bounds.innerStart, bounds.innerEnd).trim() : null;
}

export function replaceManagedBlock(content: string, inner: string): string | null {
	const bounds = boundsOf(content);
	if (!bounds) return null;
	return `${content.slice(0, bounds.innerStart)}\n${inner.trim()}\n${content.slice(bounds.innerEnd)}`;
}

/** Adds the block at the end of a note that does not have one yet. */
export function appendManagedBlock(content: string, inner: string): string {
	const trimmed = content.replace(/\s+$/, '');
	return `${trimmed}\n\n${MANAGED_START}\n${inner.trim()}\n${MANAGED_END}\n`;
}

/**
 * The raw, unrendered block out of a template source, so it can be rendered per
 * title without re-rendering the whole template.
 */
export function managedBlockTemplate(templateSource: string): string | null {
	const bounds = boundsOf(templateSource);
	return bounds ? templateSource.slice(bounds.innerStart, bounds.innerEnd).trim() : null;
}

/** Fallback content when the template declares a block but leaves it empty. */
export function defaultManagedBlock(media: NormalizedMedia): string {
	const lines: string[] = [];
	if (media.type === 'series' && media.lastEpisode) {
		const label = `S${String(media.lastEpisode.season).padStart(2, '0')}E${String(media.lastEpisode.number).padStart(2, '0')}`;
		lines.push(
			`Last watched episode: **${label}**${media.lastEpisode.title ? ` — ${media.lastEpisode.title}` : ''}`,
		);
	}
	lines.push(`Progress: **${media.progressPercent}%**${media.finished ? ' (finished)' : ''}`);
	lines.push(`[Open in Stremio](${media.stremioAppUrl})`);
	if (media.stremioEpisodeUrl) lines.push(`[Resume episode](${media.stremioEpisodeUrl})`);
	return lines.join('\n');
}

function boundsOf(content: string): { innerStart: number; innerEnd: number } | null {
	const start = content.indexOf(MANAGED_START);
	if (start === -1) return null;
	const innerStart = start + MANAGED_START.length;
	const innerEnd = content.indexOf(MANAGED_END, innerStart);
	if (innerEnd === -1) return null;
	return { innerStart, innerEnd };
}
