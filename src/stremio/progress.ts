import type { LibraryItemState } from '../model/schema';
import type { EpisodeProgress } from '../model/types';
import { t } from '../i18n';

// pako 1.0 is browser-safe but ships without TypeScript declarations.
// @ts-expect-error pako 1.0 has no bundled declaration file.
import pako from 'pako';

type PakoModule = { inflate(data: Uint8Array): Uint8Array };

const inflate = (data: Uint8Array): Uint8Array => (pako as unknown as PakoModule).inflate(data);

export interface EpisodeInput {
	season: number;
	number: number;
	videoId: string;
	title?: string;
	airDate?: string;
}

export interface SeriesProgress {
	episodes: EpisodeProgress[];
	/**
	 * False when the decoded bitfield disagrees with `state.video_id` — the one
	 * cross-check available for the episode ordering. The caller must not write
	 * checkboxes from an inconsistent field.
	 */
	consistent: boolean;
	reason?: string;
}

/**
 * Decodes `state.watched` against the canonical episode ordering.
 *
 * The serialized field is `{lastVideoId}:{length}:{base64(deflate(bits))}` and is
 * indexed purely by position, so `videoIds` must be exactly the list Stremio used
 * — Cinemeta's `videos`, seasons and episodes ascending, specials excluded.
 */
export function decodeSeriesProgress(state: LibraryItemState, episodes: EpisodeInput[]): SeriesProgress {
	const currentVideoId = state.video_id ?? undefined;
	const toProgress = (watched: (videoId: string) => boolean): EpisodeProgress[] =>
		episodes.map((episode) => ({
			season: episode.season,
			number: episode.number,
			videoId: episode.videoId,
			title: episode.title,
			airDate: episode.airDate,
			watched: watched(episode.videoId),
			current: episode.videoId === currentVideoId,
		}));

	if (!state.watched) {
		return { episodes: toProgress(() => false), consistent: true };
	}
	if (episodes.length === 0) {
		return { episodes: [], consistent: true };
	}

	const videoIds = episodes.map((episode) => episode.videoId);
	let watched: (videoId: string) => boolean;
	try {
		watched = decodeWatchedField(state.watched, videoIds);
	} catch (error) {
		return {
			episodes: toProgress(() => false),
			consistent: false,
			reason: t('progress.decode', { error: error instanceof Error ? error.message : String(error) }),
		};
	}

	const decoded = toProgress(watched);

	// `constructAndResize` already compensates when episodes were appended or the
	// list start shifted, so a single unwatched episode proves nothing. Only two
	// signals are strong enough to withhold a write:

	// 1. Stremio points at an episode the metadata does not contain at all — the
	//    episode list is incomplete and every index after the gap is suspect.
	const current = decoded.find((episode) => episode.current);
	if (currentVideoId && !current && looksLikeEpisodeId(currentVideoId)) {
		return {
			episodes: decoded,
			consistent: false,
			reason: t('progress.currentMissing', { id: currentVideoId }),
		};
	}

	// 2. Stremio recorded finished playbacks, yet the decoded field is empty.
	//    A correct field can never look like that.
	const watchedCount = decoded.filter((episode) => episode.watched).length;
	if (watchedCount === 0 && (state.timesWatched ?? 0) > 0) {
		return {
			episodes: decoded,
			consistent: false,
			reason: t('progress.bitfieldMismatch', { count: state.timesWatched ?? 0 }),
		};
	}

	return { episodes: decoded, consistent: true };
}

/**
 * Decodes Stremio's `{lastVideoId}:{length}:{base64(deflate(bits))}` field.
 * Bits are packed least-significant-bit first, matching the original Stremio
 * implementation. The field is shifted when the metadata list loses items at
 * the beginning, while newly appended items remain unwatched.
 */
function decodeWatchedField(serialized: string, videoIds: string[]): (videoId: string) => boolean {
	const components = serialized.split(':');
	if (components.length < 3) throw new Error('invalid components length');

	const encoded = components.pop() ?? '';
	const lastLengthText = components.pop() ?? '';
	const lastLength = Number.parseInt(lastLengthText, 10);
	if (!Number.isInteger(lastLength) || lastLength < 0) throw new Error('invalid bitfield length');

	const lastVideoId = components.join(':');
	const lastVideoIndex = videoIds.indexOf(lastVideoId);
	const offset = lastLength - 1 - lastVideoIndex;
	const values = new Uint8Array(Math.ceil(videoIds.length / 8));

	// An unknown last ID or a list that moved backwards cannot be aligned safely.
	if (lastVideoIndex === -1 || offset < 0) return (videoId) => getBit(values, videoIds.indexOf(videoId));

	const packed = inflate(decodeBase64(encoded));
	const firstSourceBit = Math.max(0, offset);
	const firstTargetBit = offset > 0 ? 0 : firstSourceBit;
	const lastTargetBit = offset > 0 ? Math.min(videoIds.length, lastLength - offset) : videoIds.length;
	for (let targetBit = firstTargetBit; targetBit < lastTargetBit; targetBit += 1) {
		const sourceBit = targetBit + (offset > 0 ? offset : 0);
		if (sourceBit < lastLength && getBit(packed, sourceBit)) setBit(values, targetBit);
	}

	return (videoId) => getBit(values, videoIds.indexOf(videoId));
}

function decodeBase64(encoded: string): Uint8Array {
	const binary = atob(encoded);
	const decoded = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) decoded[index] = binary.charCodeAt(index);
	return decoded;
}

function getBit(values: Uint8Array, index: number): boolean {
	if (index < 0) return false;
	return (values[index >> 3] & (1 << (index & 7))) !== 0;
}

function setBit(values: Uint8Array, index: number): void {
	if (index >= 0) values[index >> 3] |= 1 << (index & 7);
}

function looksLikeEpisodeId(videoId: string): boolean {
	return videoId.split(':').length >= 3;
}

/** Percentage of the current video, 0–100. */
export function currentVideoPercent(state: LibraryItemState): number {
	const duration = state.duration ?? 0;
	const offset = state.timeOffset ?? 0;
	if (duration <= 0) return 0;
	return Math.min(100, Math.max(0, Math.round((offset / duration) * 100)));
}

export function movieProgressPercent(state: LibraryItemState): number {
	if ((state.flaggedWatched ?? 0) > 0) return 100;
	return currentVideoPercent(state);
}

export function seriesProgressPercent(episodes: EpisodeProgress[]): number {
	if (episodes.length === 0) return 0;
	const watched = episodes.filter((episode) => episode.watched).length;
	return Math.round((watched / episodes.length) * 100);
}
