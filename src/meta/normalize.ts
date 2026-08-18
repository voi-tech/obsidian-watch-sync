import type { CinemetaMeta, LibraryItem } from '../model/schema';
import type { EpisodeProgress, MediaType, NormalizedMedia, Season } from '../model/types';
import { appEpisodeUrl, appUrl, imdbUrl, webUrl } from '../stremio/links';
import {
	decodeSeriesProgress,
	movieProgressPercent,
	seriesProgressPercent,
	type EpisodeInput,
} from '../stremio/progress';
import {
	movieWatchStatus,
	seriesWatchStatus,
	DEFAULT_THRESHOLDS,
	type WatchThresholds,
} from '../stremio/watch-status';
import { episodeNumber, orderedVideos, parseReleaseInfo, parseRuntimeMinutes } from './cinemeta';
import { castNames, directorOf, imageUrl, yearOf, type TmdbClient } from './tmdb';
import type { TmdbMovie, TmdbSeason, TmdbSeries } from '../model/schema';
import { t } from '../i18n';

export interface NormalizeWarning {
	mediaId: string;
	message: string;
}

export interface NormalizeResult {
	media: NormalizedMedia;
	warnings: NormalizeWarning[];
}

export interface MetadataSources {
	tmdb: TmdbClient | null;
	fetchCinemeta: (type: MediaType, imdbId: string) => Promise<CinemetaMeta | null>;
	/** What counts as watched; defaults to Stremio's own 70% mark. */
	thresholds?: WatchThresholds;
}

export function mediaTypeOf(item: LibraryItem): MediaType {
	return item.type === 'series' ? 'series' : 'movie';
}

/** `tmdb:31011` → 31011. */
function tmdbIdFrom(id: string): number | undefined {
	const match = /^tmdb:(\d+)$/.exec(id);
	return match ? Number(match[1]) : undefined;
}

/**
 * Library items added through the TMDB addon are keyed `tmdb:N` and carry the
 * IMDb id only in `state.video_id`. That fallback is what lets Cinemeta — and
 * therefore the episode ordering — still work for them.
 */
function imdbIdFrom(item: LibraryItem): string | undefined {
	if (/^tt\d+$/.test(item._id)) return item._id;
	const videoId = item.state?.video_id ?? '';
	const head = videoId.split(':')[0];
	return /^tt\d+$/.test(head) ? head : undefined;
}

function isoDate(value: string | null | undefined): string | undefined {
	if (!value) return undefined;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

export async function normalize(item: LibraryItem, sources: MetadataSources): Promise<NormalizeResult> {
	const type = mediaTypeOf(item);
	return type === 'series' ? normalizeSeries(item, sources) : normalizeMovie(item, sources);
}

async function normalizeMovie(item: LibraryItem, sources: MetadataSources): Promise<NormalizeResult> {
	const warnings: NormalizeWarning[] = [];
	const imdbId = imdbIdFrom(item);
	let tmdbId = tmdbIdFrom(item._id);

	let tmdbMovie: TmdbMovie | null = null;
	if (sources.tmdb) {
		if (!tmdbId && imdbId) tmdbId = (await sources.tmdb.findByImdbId(imdbId)).movieId;
		if (tmdbId) tmdbMovie = await sources.tmdb.movieWithDescription(tmdbId);
		if (!tmdbMovie) warnings.push({ mediaId: item._id, message: t('warning.tmdb') });
	}

	const needsCinemeta = !tmdbMovie || !tmdbMovie.overview || !tmdbMovie.poster_path;
	const cinemeta = needsCinemeta && imdbId ? await sources.fetchCinemeta('movie', imdbId) : null;

	const state = item.state ?? {};
	const watchStatus = movieWatchStatus(state, sources.thresholds ?? DEFAULT_THRESHOLDS);
	const finished = watchStatus === 'watched';
	const releaseDate = isoDate(tmdbMovie?.release_date || cinemeta?.released);
	const releaseYear =
		yearOf(tmdbMovie?.release_date) ??
		yearOf(releaseDate) ??
		parseReleaseInfo(cinemeta?.year ?? cinemeta?.releaseInfo).start;

	const media: NormalizedMedia = {
		id: item._id,
		imdbId: imdbId ?? tmdbMovie?.imdb_id ?? cinemeta?.imdb_id ?? undefined,
		tmdbId,
		type: 'movie',
		title: tmdbMovie?.title ?? cinemeta?.name ?? item.name,
		originalTitle: tmdbMovie?.original_title,
		year: releaseYear,
		yearStart: releaseYear,
		yearEnd: releaseYear,
		releaseDate,
		description: tmdbMovie?.overview || cinemeta?.description || undefined,
		cover: imageUrl(tmdbMovie?.poster_path) ?? cinemeta?.poster ?? item.poster ?? undefined,
		backdrop: imageUrl(tmdbMovie?.backdrop_path) ?? cinemeta?.background,
		durationMinutes: tmdbMovie?.runtime ?? parseRuntimeMinutes(cinemeta?.runtime),
		genres: tmdbMovie?.genres?.map((genre) => genre.name) ?? cinemeta?.genre ?? cinemeta?.genres ?? [],
		cast: castNames(tmdbMovie?.credits) ?? [],
		director: directorOf(tmdbMovie?.credits) ?? cinemeta?.director?.[0],
		lastWatched: isoDate(state.lastWatched),
		watchStatus,
		finished,
		progressPercent: movieProgressPercent(state),
		stremioUrl: webUrl('movie', item._id),
		stremioAppUrl: appUrl('movie', item._id),
		imdbUrl: imdbUrl(imdbId),
		seasons: [],
		mtime: item._mtime,
	};

	if (media.cast.length === 0) media.cast = cinemeta?.cast ?? [];
	return { media, warnings };
}

async function normalizeSeries(item: LibraryItem, sources: MetadataSources): Promise<NormalizeResult> {
	const warnings: NormalizeWarning[] = [];
	const imdbId = imdbIdFrom(item);
	let tmdbId = tmdbIdFrom(item._id);

	// Cinemeta first and unconditionally: its `videos` ordering is what the
	// watched bitfield is indexed against.
	const cinemeta = imdbId ? await sources.fetchCinemeta('series', imdbId) : null;
	const videos = orderedVideos(cinemeta);
	if (!cinemeta) {
		warnings.push({
			mediaId: item._id,
			message: t('warning.cinemeta'),
		});
	}

	let tmdbSeries: TmdbSeries | null = null;
	const tmdbSeasons = new Map<number, TmdbSeason>();
	if (sources.tmdb) {
		if (!tmdbId && imdbId) tmdbId = (await sources.tmdb.findByImdbId(imdbId)).seriesId;
		if (tmdbId) tmdbSeries = await sources.tmdb.seriesWithDescription(tmdbId);
		if (tmdbSeries && tmdbId) {
			const seasonNumbers = new Set(videos.map((video) => video.season ?? 0));
			for (const number of [...seasonNumbers].sort((a, b) => a - b)) {
				const season = await sources.tmdb.season(tmdbId, number);
				if (season) tmdbSeasons.set(number, season);
			}
		}
	}

	const episodeInputs: EpisodeInput[] = videos.map((video) => {
		const seasonNumber = video.season ?? 0;
		const number = episodeNumber(video) ?? 0;
		const tmdbEpisode = tmdbSeasons
			.get(seasonNumber)
			?.episodes.find((episode) => episode.episode_number === number);
		return {
			season: seasonNumber,
			number,
			videoId: video.id,
			title: tmdbEpisode?.name || video.name || video.title,
			airDate: isoDate(tmdbEpisode?.air_date ?? video.released ?? video.firstAired),
		};
	});

	const state = item.state ?? {};
	const progress = decodeSeriesProgress(state, episodeInputs);
	if (!progress.consistent && progress.reason) {
		warnings.push({ mediaId: item._id, message: progress.reason });
	}

	const seasons = groupIntoSeasons(progress.episodes, tmdbSeasons);
	const watchStatus = seriesWatchStatus(
		state,
		progress.episodes,
		sources.thresholds ?? DEFAULT_THRESHOLDS,
	);
	const finished = watchStatus === 'watched';
	const releaseDate = isoDate(tmdbSeries?.first_air_date || cinemeta?.released);
	const yearStart =
		yearOf(tmdbSeries?.first_air_date) ??
		yearOf(releaseDate) ??
		parseReleaseInfo(cinemeta?.year ?? cinemeta?.releaseInfo).start;
	const yearEnd =
		yearOf(tmdbSeries?.last_air_date) ?? parseReleaseInfo(cinemeta?.year ?? cinemeta?.releaseInfo).end;

	const media: NormalizedMedia = {
		id: item._id,
		imdbId: imdbId ?? tmdbSeries?.external_ids?.imdb_id ?? cinemeta?.imdb_id ?? undefined,
		tmdbId,
		type: 'series',
		title: tmdbSeries?.name ?? cinemeta?.name ?? item.name,
		originalTitle: tmdbSeries?.original_name,
		year: yearStart,
		yearStart,
		yearEnd,
		releaseDate,
		description: tmdbSeries?.overview || cinemeta?.description || undefined,
		cover: imageUrl(tmdbSeries?.poster_path) ?? cinemeta?.poster ?? item.poster ?? undefined,
		backdrop: imageUrl(tmdbSeries?.backdrop_path) ?? cinemeta?.background,
		durationMinutes: totalRuntime(tmdbSeries, tmdbSeasons, episodeInputs.length, cinemeta),
		genres: tmdbSeries?.genres?.map((genre) => genre.name) ?? cinemeta?.genre ?? cinemeta?.genres ?? [],
		cast: castNames(tmdbSeries?.credits) ?? [],
		director: cinemeta?.director?.[0],
		lastWatched: isoDate(state.lastWatched),
		watchStatus,
		finished,
		progressPercent: seriesProgressPercent(progress.episodes),
		stremioUrl: webUrl('series', item._id),
		stremioAppUrl: appUrl('series', item._id),
		stremioEpisodeUrl: state.video_id ? appEpisodeUrl('series', item._id, state.video_id) : undefined,
		imdbUrl: imdbUrl(imdbId),
		seasons,
		lastEpisode: progress.episodes.find((episode) => episode.current),
		mtime: item._mtime,
	};

	if (media.cast.length === 0) media.cast = cinemeta?.cast ?? [];
	return { media, warnings };
}

function groupIntoSeasons(episodes: EpisodeProgress[], tmdbSeasons: Map<number, TmdbSeason>): Season[] {
	const bySeason = new Map<number, EpisodeProgress[]>();
	for (const episode of episodes) {
		const list = bySeason.get(episode.season) ?? [];
		list.push(episode);
		bySeason.set(episode.season, list);
	}
	return [...bySeason.entries()]
		.sort(([a], [b]) => a - b)
		.map(([number, seasonEpisodes]) => ({
			number,
			title: seasonTitle(tmdbSeasons.get(number)?.name, number),
			episodes: seasonEpisodes.sort((a, b) => a.number - b.number),
		}));
}

/** TMDB names most seasons "Season 3" / "Sezon 3"; only a real subtitle is useful. */
function seasonTitle(name: string | undefined, number: number): string | undefined {
	if (!name) return undefined;
	if (new RegExp(`^(season|sezon|seizoen|staffel)\\s*${number}$`, 'i').test(name.trim())) return undefined;
	return name;
}

function totalRuntime(
	series: TmdbSeries | null,
	seasons: Map<number, TmdbSeason>,
	episodeCount: number,
	cinemeta: CinemetaMeta | null,
): number | undefined {
	let sum = 0;
	let counted = 0;
	for (const season of seasons.values()) {
		for (const episode of season.episodes) {
			if (typeof episode.runtime === 'number' && episode.runtime > 0) {
				sum += episode.runtime;
				counted += 1;
			}
		}
	}
	if (counted > 0 && counted >= episodeCount * 0.8) return sum;

	const perEpisode = series?.episode_run_time?.[0] ?? parseRuntimeMinutes(cinemeta?.runtime);
	if (perEpisode && episodeCount > 0) return perEpisode * episodeCount;
	return counted > 0 ? sum : undefined;
}
