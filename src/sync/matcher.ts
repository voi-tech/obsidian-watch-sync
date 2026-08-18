import type { Conflict, NormalizedMedia } from '../model/types';
import { parseWebUrl } from '../stremio/links';
import { sanitizeFilename } from '../vault/template';
import { t } from '../i18n';

export interface NoteRef {
	path: string;
	basename: string;
	/** Value of the `source` property, if present. */
	source?: string;
	aliases: string[];
	/** Frontmatter as Obsidian's metadata cache reports it. */
	frontmatter: Record<string, unknown>;
}

export type MatchTier = 'source' | 'index' | 'alias' | 'filename' | 'filename-suffix';

export interface Match {
	note: NoteRef;
	tier: MatchTier;
	/** True once the note carries a `source` pointing at this exact item. */
	certain: boolean;
}

export type MatchOutcome = { match: Match } | { conflict: Conflict } | { match: null };

/**
 * Finds the note a library item belongs to.
 *
 * Confidence descends through the tiers; the first tier that yields exactly one
 * candidate wins. Two candidates in the same tier is a conflict, never a guess —
 * writing into the wrong note is the one failure this plugin must not have.
 */
export function matchNote(
	media: NormalizedMedia,
	notes: NoteRef[],
	index: Record<string, string>,
): MatchOutcome {
	const bySource = notes.filter((note) => note.source && parseWebUrl(note.source)?.id === media.id);
	if (bySource.length === 1) return { match: { note: bySource[0], tier: 'source', certain: true } };
	if (bySource.length > 1) {
		return { conflict: conflictOf(media, t('conflict.sameSource'), bySource) };
	}

	const indexedPath = index[media.id];
	const indexed = indexedPath ? notes.find((note) => note.path === indexedPath) : undefined;
	// An index entry is only trustworthy while the note has not been claimed by
	// something else; a foreign `source` means the file was reused.
	if (indexed && (!indexed.source || parseWebUrl(indexed.source)?.id === media.id)) {
		return { match: { note: indexed, tier: 'index', certain: false } };
	}

	const unclaimed = notes.filter((note) => !note.source || !parseWebUrl(note.source));

	const titles = [media.title, media.originalTitle].filter((title): title is string => Boolean(title));
	const byAlias = unclaimed.filter((note) =>
		note.aliases.some((alias) => titles.some((title) => equalsLoose(alias, title))),
	);
	if (byAlias.length === 1) return { match: { note: byAlias[0], tier: 'alias', certain: false } };
		if (byAlias.length > 1) return { conflict: conflictOf(media, t('conflict.sameAlias'), byAlias) };

	const expected = expectedBasenames(media);
	const byFilename = unclaimed.filter((note) => expected.some((name) => equalsLoose(note.basename, name)));
	if (byFilename.length === 1) return { match: { note: byFilename[0], tier: 'filename', certain: false } };
	if (byFilename.length > 1) {
			return { conflict: conflictOf(media, t('conflict.sameFilename'), byFilename) };
	}

	// The vault prefixes some notes with a collection — "Avengers - The Avengers
	// (2012)", "Alien - Romulus (2024)". TMDB never produces that prefix, so match
	// the tail instead, and only when the year agrees.
	const bySuffix = media.year
		? unclaimed.filter((note) => expected.some((name) => endsWithTitle(note.basename, name)))
		: [];
	if (bySuffix.length === 1) return { match: { note: bySuffix[0], tier: 'filename-suffix', certain: false } };
	if (bySuffix.length > 1) {
		return { conflict: conflictOf(media, t('conflict.sameSuffix'), bySuffix) };
	}

	return { match: null };
}

function conflictOf(media: NormalizedMedia, reason: string, candidates: NoteRef[]): Conflict {
	return {
		mediaId: media.id,
		title: media.title,
		reason,
		candidates: candidates.map((note) => note.path),
	};
}

/**
 * Every filename form the vault is known to use for one title: `(2016)`,
 * `(2022-2025)` and the redundant `(2025-2025)` all occur.
 */
export function expectedBasenames(media: NormalizedMedia): string[] {
	const title = sanitizeFilename(media.title);
	const original = media.originalTitle ? sanitizeFilename(media.originalTitle) : null;
	const names = new Set<string>();

	for (const base of [title, original].filter((value): value is string => Boolean(value))) {
		names.add(base);
		if (media.yearStart && media.yearEnd && media.yearStart !== media.yearEnd) {
			names.add(`${base} (${media.yearStart}-${media.yearEnd})`);
		}
		if (media.yearStart) {
			names.add(`${base} (${media.yearStart})`);
			names.add(`${base} (${media.yearStart}-${media.yearStart})`);
		}
		if (media.yearEnd) names.add(`${base} (${media.yearEnd})`);
	}

	return [...names];
}

const normalizedCache = new Map<string, string>();

function normalizeForCompare(value: string): string {
	const cached = normalizedCache.get(value);
	if (cached !== undefined) return cached;
	const normalized = value.toLocaleLowerCase('pl').replace(/[’'`´]/g, "'").replace(/\s+/g, ' ').trim();
	// Bounded so a long-running session cannot grow this without limit.
	if (normalizedCache.size > 5000) normalizedCache.clear();
	normalizedCache.set(value, normalized);
	return normalized;
}

function equalsLoose(a: string, b: string): boolean {
	return normalizeForCompare(a) === normalizeForCompare(b);
}

function endsWithTitle(basename: string, expected: string): boolean {
	const normalizedBase = normalizeForCompare(basename);
	const normalizedExpected = normalizeForCompare(expected);
	// Require the separator so "Aliens (1986)" does not swallow "Xenomorph Aliens (1986)".
	return normalizedBase.endsWith(` - ${normalizedExpected}`) || normalizedBase.endsWith(`- ${normalizedExpected}`);
}
