import { requestUrl } from 'obsidian';
import { cinemetaResponseSchema, type CinemetaMeta, type CinemetaVideo } from '../model/schema';
import type { MediaType } from '../model/types';

const CINEMETA_BASE = 'https://v3-cinemeta.strem.io/meta';

/**
 * Cinemeta is the addon Stremio itself ships with, so its `videos` ordering is
 * the one the watched bitfield was indexed against. That makes it the canonical
 * source for episode ids even when TMDB supplies the display text.
 */
export async function fetchCinemetaMeta(type: MediaType, imdbId: string): Promise<CinemetaMeta | null> {
	if (!/^tt\d+$/.test(imdbId)) return null;
	try {
		const response = await requestUrl({
			url: `${CINEMETA_BASE}/${type}/${imdbId}.json`,
			method: 'GET',
			throw: false,
		});
		if (response.status !== 200) return null;
		const parsed = cinemetaResponseSchema.safeParse(response.json);
		return parsed.success ? parsed.data.meta : null;
	} catch {
		return null;
	}
}

export function episodeNumber(video: CinemetaVideo): number | undefined {
	return video.episode ?? video.number;
}

/**
 * Regular episodes in Stremio's own order. Specials (season 0) and entries
 * without a season/episode pair are dropped: they are not part of the bitfield
 * index and would shift every subsequent episode.
 */
export function orderedVideos(meta: CinemetaMeta | null): CinemetaVideo[] {
	if (!meta?.videos) return [];
	return meta.videos
		.filter((video) => (video.season ?? 0) > 0 && (episodeNumber(video) ?? 0) > 0)
		.sort((a, b) => {
			const bySeason = (a.season ?? 0) - (b.season ?? 0);
			if (bySeason !== 0) return bySeason;
			const byEpisode = (episodeNumber(a) ?? 0) - (episodeNumber(b) ?? 0);
			if (byEpisode !== 0) return byEpisode;
			return (a.released ?? a.firstAired ?? '').localeCompare(b.released ?? b.firstAired ?? '');
		});
}

/** `"47 min"` → `47`. */
export function parseRuntimeMinutes(runtime: string | undefined): number | undefined {
	if (!runtime) return undefined;
	const match = /(\d+)/.exec(runtime);
	return match ? Number(match[1]) : undefined;
}

/** `"2023–"`, `"2022-2025"`, `"2016"` → start and end year. */
export function parseReleaseInfo(info: string | undefined): { start?: number; end?: number } {
	if (!info) return {};
	const years = info.match(/\d{4}/g);
	if (!years || years.length === 0) return {};
	return { start: Number(years[0]), end: years[1] ? Number(years[1]) : undefined };
}
