import type { LibraryItem } from '../../src/model/schema';

/**
 * Shapes taken verbatim from a real Stremio 5 library so the tests exercise the
 * quirks that actually occur — `tmdb:` ids, `removed`/`temp` items that were in
 * fact watched, and never-played library entries.
 */

export const lordOfTheRings: LibraryItem = {
	_id: 'tt0167260',
	name: 'Władca Pierścieni: Powrót króla',
	type: 'movie',
	poster: 'https://image.tmdb.org/t/p/w600_and_h900_bestv2/rCzpDGLbOoPwLjy3OAm5NUPOTrC.jpg',
	posterShape: 'poster',
	removed: false,
	temp: false,
	_ctime: '2025-12-16T13:56:22.504Z',
	_mtime: '2025-12-16T13:56:22.504Z',
	state: {
		lastWatched: '2025-12-16T13:56:22.504Z',
		timeWatched: 0,
		timeOffset: 0,
		overallTimeWatched: 0,
		timesWatched: 0,
		flaggedWatched: 0,
		duration: 0,
		video_id: null,
		watched: null,
		noNotif: false,
	},
};

export const hijack: LibraryItem = {
	_id: 'tt19854762',
	name: 'Hijack',
	type: 'series',
	poster: 'https://images.metahub.space/poster/small/tt19854762/img',
	posterShape: 'poster',
	removed: false,
	temp: false,
	_ctime: '2025-12-16T13:39:15.766Z',
	_mtime: '2026-05-11T09:43:39.993Z',
	state: {
		lastWatched: '2026-05-11T09:43:39.050Z',
		timeWatched: 2967014,
		timeOffset: 0,
		overallTimeWatched: 39801236,
		timesWatched: 8,
		flaggedWatched: 1,
		duration: 3017952,
		video_id: 'tt19854762:2:8',
		watched: 'tt19854762:2:8:15:eJxrqAcAAYEBAA==',
		noNotif: false,
	},
};

/** Played to the end but never added to the library — must not be filtered out. */
export const doctorStrange: LibraryItem = {
	_id: 'tt9419884',
	name: 'Doctor Strange in the Multiverse of Madness',
	type: 'movie',
	poster: 'https://images.metahub.space/poster/small/tt9419884/img',
	posterShape: 'poster',
	removed: true,
	temp: true,
	_ctime: '2026-01-15T15:09:01.643Z',
	_mtime: '2026-01-15T17:07:22.276Z',
	state: {
		lastWatched: '2026-01-15T17:07:21.809Z',
		timeWatched: 7064000,
		timeOffset: 0,
		overallTimeWatched: 7064000,
		timesWatched: 1,
		flaggedWatched: 1,
		duration: 7633312,
		video_id: 'tt9419884',
		watched: 'undefined:1:eJwDAAAAAAE=',
		noNotif: false,
	},
};

/** Library id in TMDB form; the IMDb id only appears inside `state.video_id`. */
export const mrNobody: LibraryItem = {
	_id: 'tmdb:31011',
	name: 'Mr. Nobody',
	type: 'movie',
	poster: 'https://image.tmdb.org/t/p/w500/qNkIONc4Rgmzo23ph7qWp9QfVnW.jpg',
	posterShape: 'poster',
	removed: false,
	temp: false,
	_ctime: '2025-11-15T10:45:32.490Z',
	_mtime: '2025-11-15T10:45:32.490Z',
	state: {
		lastWatched: '2025-11-15T10:45:32.490Z',
		timeWatched: 0,
		timeOffset: 0,
		overallTimeWatched: 0,
		timesWatched: 0,
		flaggedWatched: 0,
		duration: 0,
		video_id: 'tt0485947',
		watched: null,
		noNotif: false,
	},
};

/** Unsupported type — Stremio also stores channels and "other". */
export const channel: LibraryItem = {
	_id: 'yt_id:UCabc',
	name: 'Jakiś kanał',
	type: 'channel',
	removed: false,
	temp: false,
	state: {},
};

export const allItems = [lordOfTheRings, hijack, doctorStrange, mrNobody, channel];
