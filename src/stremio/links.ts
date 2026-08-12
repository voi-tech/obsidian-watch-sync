import type { MediaType } from '../model/types';

/**
 * Stremio routes detail pages as `/detail/:type/:id/:videoId?` — the regexp in
 * `stremio-web/src/common/routesRegexp.js`, mirrored by the deep-link builder in
 * `stremio-core/src/deep_links`. The third segment is a *video* id, so repeating
 * the item id there does not open the item page: Stremio tries to resolve it as
 * an episode. Two segments open the show, three open one video of it.
 */

const WEB_BASE = 'https://web.stremio.com/#/detail';
const APP_BASE = 'stremio:///detail';

function path(base: string, type: MediaType, id: string, videoId?: string): string {
	const url = `${base}/${type}/${encodeURIComponent(id)}`;
	return videoId ? `${url}/${encodeURIComponent(videoId)}` : url;
}

/**
 * The item's own page. Doubles as the note's canonical `source` property and as
 * the key that matches a note back to its library item, so its shape must stay
 * stable.
 */
export function webUrl(type: MediaType, id: string): string {
	return path(WEB_BASE, type, id);
}

/** A single episode's page on the web. */
export function webEpisodeUrl(type: MediaType, id: string, videoId: string): string {
	return path(WEB_BASE, type, id, videoId);
}

/** The item's page, opened in the desktop or mobile app. */
export function appUrl(type: MediaType, id: string): string {
	return path(APP_BASE, type, id);
}

/** A single episode, opened in the app — its stream list rather than the show. */
export function appEpisodeUrl(type: MediaType, id: string, videoId: string): string {
	return path(APP_BASE, type, id, videoId);
}

export function imdbUrl(imdbId: string | undefined): string | undefined {
	return imdbId ? `https://www.imdb.com/title/${imdbId}/` : undefined;
}

const WEB_URL_PATTERN = /^https:\/\/web\.stremio\.com\/#\/detail\/(movie|series)\/([^/]+)/;

/**
 * Reads a Stremio id back out of a note's `source` property. Deliberately
 * ignores anything after the id, so notes written before the trailing-segment
 * fix still match.
 */
export function parseWebUrl(url: string): { type: MediaType; id: string } | null {
	const match = WEB_URL_PATTERN.exec(url.trim());
	if (!match) return null;
	return { type: match[1] as MediaType, id: decodeURIComponent(match[2]) };
}

/** `tt19854762:2:8` → `{ season: 2, episode: 8 }`; null for movie ids. */
export function parseVideoId(videoId: string): { season: number; episode: number } | null {
	const parts = videoId.split(':');
	if (parts.length < 3) return null;
	const episode = Number(parts.pop());
	const season = Number(parts.pop());
	if (!Number.isFinite(season) || !Number.isFinite(episode)) return null;
	return { season, episode };
}
