import { requestUrl } from 'obsidian';
import {
	tmdbFindSchema,
	tmdbMovieSchema,
	tmdbSeasonSchema,
	tmdbSeriesSchema,
	type TmdbMovie,
	type TmdbSeason,
	type TmdbSeries,
} from '../model/schema';
import type { MetadataLanguage } from '../model/types';
import { createLimiter, type Limiter } from '../util/limit';

const TMDB_BASE = 'https://api.themoviedb.org/3';
export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/original';

/**
 * Existing notes in the vault store `cover` as
 * `https://image.tmdb.org/t/p/original//abc.jpg` — TMDB's `poster_path` already
 * starts with a slash, so the doubled separator is original and kept verbatim to
 * stay byte-identical with hand-written notes.
 */
export function imageUrl(path: string | null | undefined): string | undefined {
	return path ? `${TMDB_IMAGE_BASE}/${path}` : undefined;
}

export class TmdbClient {
	/** TMDB tolerates roughly 50 requests a second; a handful in flight is plenty. */
	private readonly limiter: Limiter = createLimiter(5);

	/**
	 * Set when TMDB rejects the key. Without this a wrong key is indistinguishable
	 * from "no such title" and the user silently gets Cinemeta data forever.
	 */
	private rejected = false;

	constructor(
		private readonly apiKey: string,
		private readonly language: MetadataLanguage,
	) {}

	get keyRejected(): boolean {
		return this.rejected;
	}

	private async get(path: string, params: Record<string, string> = {}): Promise<unknown> {
		if (this.rejected) return null;
		return this.limiter.run(async () => {
			const query = new URLSearchParams({ api_key: this.apiKey, ...params }).toString();
			try {
				const response = await requestUrl({ url: `${TMDB_BASE}${path}?${query}`, method: 'GET', throw: false });
				if (response.status === 401 || response.status === 403) {
					// Stop hammering an endpoint that will keep refusing us.
					this.rejected = true;
					return null;
				}
				if (response.status !== 200) return null;
				return response.json as unknown;
			} catch {
				return null;
			}
		});
	}

	/** IMDb id → TMDB numeric id, for library items keyed by `tt…`. */
	async findByImdbId(imdbId: string): Promise<{ movieId?: number; seriesId?: number }> {
		const json = await this.get(`/find/${imdbId}`, { external_source: 'imdb_id' });
		const parsed = tmdbFindSchema.safeParse(json);
		if (!parsed.success) return {};
		return {
			movieId: parsed.data.movie_results[0]?.id,
			seriesId: parsed.data.tv_results[0]?.id,
		};
	}

	async movie(id: number, language = this.language): Promise<TmdbMovie | null> {
		const json = await this.get(`/movie/${id}`, { language, append_to_response: 'credits' });
		const parsed = tmdbMovieSchema.safeParse(json);
		return parsed.success ? parsed.data : null;
	}

	async series(id: number, language = this.language): Promise<TmdbSeries | null> {
		const json = await this.get(`/tv/${id}`, {
			language,
			append_to_response: 'credits,external_ids',
		});
		const parsed = tmdbSeriesSchema.safeParse(json);
		return parsed.success ? parsed.data : null;
	}

	async season(seriesId: number, seasonNumber: number, language = this.language): Promise<TmdbSeason | null> {
		const json = await this.get(`/tv/${seriesId}/season/${seasonNumber}`, { language });
		const parsed = tmdbSeasonSchema.safeParse(json);
		return parsed.success ? parsed.data : null;
	}

	/**
	 * TMDB frequently has a translated title but an empty `overview` for smaller
	 * languages. Rather than write an empty description, fall back one language
	 * at a time; the caller falls further back to Cinemeta.
	 */
	async movieWithDescription(id: number): Promise<TmdbMovie | null> {
		const primary = await this.movie(id);
		if (primary && !primary.overview && this.language !== 'en-US') {
			const fallback = await this.movie(id, 'en-US');
			if (fallback?.overview) return { ...primary, overview: fallback.overview };
		}
		return primary;
	}

	async seriesWithDescription(id: number): Promise<TmdbSeries | null> {
		const primary = await this.series(id);
		if (primary && !primary.overview && this.language !== 'en-US') {
			const fallback = await this.series(id, 'en-US');
			if (fallback?.overview) return { ...primary, overview: fallback.overview };
		}
		return primary;
	}
}

export function directorOf(credits: TmdbMovie['credits']): string | undefined {
	return credits?.crew?.find((member) => member.job === 'Director')?.name;
}

export function castNames(credits: TmdbMovie['credits'], limit = 5): string[] {
	return (credits?.cast ?? []).slice(0, limit).map((member) => member.name);
}

export function yearOf(date: string | undefined | null): number | undefined {
	if (!date) return undefined;
	const year = Number(date.slice(0, 4));
	return Number.isFinite(year) && year > 1800 ? year : undefined;
}
