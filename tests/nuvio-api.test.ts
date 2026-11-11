import { beforeEach, describe, expect, it } from 'vitest';
import {
	beginNuvioTvLogin,
	discoverNuvioBackend,
	exchangeNuvioTvLogin,
	ensureNuvioSession,
	fetchNuvioProfiles,
	fetchNuvioSnapshot,
	isNuvioSessionValid,
	refreshNuvioSession,
	resolveNuvioProfileIndex,
} from '../src/nuvio/api';
import { lastRequestedUrl, mockedRequestUrl, replyOnce as reply, requestedBody, requestedHeaders, requestedUrls } from './helpers';

const BACKEND = 'https://api.example.test';
const backend = { backendUrl: BACKEND, publishableKey: 'public-key', supportsTvLogin: true };

describe('Nuvio API', () => {
	beforeEach(() => mockedRequestUrl.mockReset());

	it('discovers only a valid HTTPS Nuvio backend configuration', async () => {
		reply({ version: 1, service: 'nuvio', backend_url: BACKEND, publishable_key: 'public-key', capabilities: { tv_login: true } });
		await expect(discoverNuvioBackend(BACKEND)).resolves.toEqual(backend);
		expect(lastRequestedUrl()).toBe(`${BACKEND}/.well-known/nuvio`);
	});

	it('defaults omitted discovery capabilities without accepting null', async () => {
		const config = { version: 1, service: 'nuvio', backend_url: BACKEND, publishable_key: 'public-key' };
		reply(config);
		await expect(discoverNuvioBackend(BACKEND)).resolves.toEqual({ ...backend, supportsTvLogin: false });
		reply({ ...config, capabilities: null });
		await expect(discoverNuvioBackend(BACKEND)).rejects.toThrow('unsupported configuration');
	});

	it('preserves snapshot defaults and unknown watched fields', async () => {
		reply([{ content_id: 'tt1', content_type: 'movie', poster: null }]);
		reply([{ content_id: 'tt1', content_type: 'movie', season: null, episode: null }]);
		reply([{ content_id: 'tt1', content_type: 'movie', extra: 'retained' }]);
		await expect(fetchNuvioSnapshot(backend, 'user-access', 2)).resolves.toEqual({
			library: [{ content_id: 'tt1', content_type: 'movie', poster: null, name: '', genres: [] }],
			progress: [{ content_id: 'tt1', content_type: 'movie', season: null, episode: null, video_id: '', position: 0, duration: 0, last_watched: 0 }],
			watched: [{ content_id: 'tt1', content_type: 'movie', extra: 'retained' }],
		});
	});

	it('rejects an empty TV challenge before reading its first element', async () => {
		reply({ access_token: 'anonymous-access', refresh_token: 'anonymous-refresh' });
		reply([]);
		await expect(beginNuvioTvLogin(backend, 'nonce', 'Obsidian')).rejects.toThrow('invalid TV sign-in challenge');
	});

	it('rejects profile indices outside the safe integer range', async () => {
		reply([{ id: 'uuid-1', profile_index: Number.MAX_SAFE_INTEGER + 1, name: 'Main' }]);
		await expect(fetchNuvioProfiles(backend, 'user-access')).rejects.toThrow('invalid profiles');
	});

	it('starts the native TV sign-in with an anonymous caller session, never user credentials', async () => {
		reply({ access_token: 'anonymous-access', refresh_token: 'anonymous-refresh' });
		reply([{ code: 'ABCD', qr_content: 'https://nuvio.tv/tv-login?code=ABCD', poll_interval_seconds: 3 }]);

		await expect(beginNuvioTvLogin(backend, 'nonce', 'Obsidian')).resolves.toMatchObject({
			code: 'ABCD',
			loginUrl: 'https://nuvio.tv/tv-login?code=ABCD',
			pollIntervalMs: 3000,
		});
		expect(lastRequestedUrl(0)).toBe(`${BACKEND}/auth/v1/signup`);
		expect(requestedHeaders(0)).toMatchObject({ Authorization: 'Bearer public-key' });
		expect(lastRequestedUrl(1)).toBe(`${BACKEND}/rest/v1/rpc/start_tv_login_session`);
		expect(requestedHeaders(1)).toMatchObject({ Authorization: 'Bearer anonymous-access' });
		expect(requestedBody(1)).toContain('https://nuvio.tv/tv-login');
	});

	it('exchanges an approved TV code for the renewable user session', async () => {
		reply({ access_token: 'user-access', refresh_token: 'user-refresh', expires_in: 3600 });
		const session = await exchangeNuvioTvLogin(backend, 'anonymous-access', 'ABCD', 'nonce');
		expect(session.accessToken).toBe('user-access');
		expect(session.refreshToken).toBe('user-refresh');
		expect(session.expiresAt).toEqual(expect.any(Number));
		expect(lastRequestedUrl()).toBe(`${BACKEND}/functions/v1/tv-logins-exchange`);
	});

	it('refreshes an expiring session through the official Supabase auth endpoint', async () => {
		reply({ access_token: 'refreshed-access', expires_in: 3600 });
		const session = await refreshNuvioSession(backend, 'old-refresh');
		expect(session.accessToken).toBe('refreshed-access');
		expect(session.refreshToken).toBe('old-refresh');
		expect(session.expiresAt).toEqual(expect.any(Number));
		expect(lastRequestedUrl()).toBe(`${BACKEND}/auth/v1/token?grant_type=refresh_token`);
		expect(requestedHeaders()).toMatchObject({ apikey: 'public-key', Authorization: 'Bearer public-key' });
		expect(requestedBody()).toBe(JSON.stringify({ refresh_token: 'old-refresh' }));
	});

	it('validates sessions with a refresh safety window and refreshes only when needed', async () => {
		const now = 1_000_000;
		const valid = { accessToken: 'access', refreshToken: 'refresh', expiresAt: now + 120_000 };
		expect(isNuvioSessionValid(valid, now)).toBe(true);
		expect(isNuvioSessionValid(valid, now, 120_000)).toBe(false);
		await expect(ensureNuvioSession(backend, valid, now)).resolves.toBe(valid);
		expect(mockedRequestUrl).not.toHaveBeenCalled();

		reply({ access_token: 'refreshed-access', refresh_token: 'refreshed-refresh', expires_in: 3600 });
		const expired = { accessToken: 'expired-access', refreshToken: 'refresh', expiresAt: now - 1 };
		await expect(ensureNuvioSession(backend, expired, now)).resolves.toMatchObject({ accessToken: 'refreshed-access', refreshToken: 'refreshed-refresh' });
	});

	it('loads profiles with a bearer user session', async () => {
		reply([{ id: 'uuid-1', profile_index: 2, name: 'Kids' }]);
		await expect(fetchNuvioProfiles(backend, 'user-access')).resolves.toEqual([{ id: 'uuid-1', index: 2, name: 'Kids' }]);
		expect(lastRequestedUrl()).toBe(`${BACKEND}/rest/v1/rpc/sync_pull_profiles`);
	});

	it('resolves a persisted profile UUID to the current Nuvio profile index', () => {
		expect(resolveNuvioProfileIndex([{ id: 'uuid-1', index: 4, name: 'Main' }], 'uuid-1')).toBe(4);
		expect(() => resolveNuvioProfileIndex([], 'uuid-1')).toThrow('selected Nuvio profile is no longer available');
	});

	it('reads only the selected profile snapshot and never calls a write RPC', async () => {
		reply([{ content_id: 'tt1', content_type: 'movie', name: 'Arrival' }]);
		reply([{ content_id: 'tt1', content_type: 'movie', video_id: 'tt1', position: 60, duration: 120, last_watched: 1 }]);
		reply([{ content_id: 'tt1', content_type: 'movie', watched_at: 2 }]);
		await expect(fetchNuvioSnapshot(backend, 'user-access', 2)).resolves.toMatchObject({ library: [{ content_id: 'tt1' }], progress: [{ content_id: 'tt1' }], watched: [{ content_id: 'tt1' }] });
		expect(requestedUrls()).toEqual([
			`${BACKEND}/rest/v1/rpc/sync_pull_library`,
			`${BACKEND}/rest/v1/rpc/sync_pull_watch_progress`,
			`${BACKEND}/rest/v1/rpc/sync_pull_watched_items`,
		]);
	});

	it('fetches every library page and stops after an explicit empty page', async () => {
		const firstPage = Array.from({ length: 500 }, (_, index) => ({ content_id: `movie-${index}`, content_type: 'movie', name: `Movie ${index}` }));
		const secondPage = Array.from({ length: 500 }, (_, index) => ({ content_id: `movie-${index + 500}`, content_type: 'movie', name: `Movie ${index + 500}` }));
		reply(firstPage);
		reply([{ content_id: 'progress-1', content_type: 'movie', video_id: 'progress-1', position: 1, duration: 2, last_watched: 1 }]);
		reply([{ content_id: 'watched-1', content_type: 'movie', watched_at: 2 }]);
		reply(secondPage);
		reply([]);

		const snapshot = await fetchNuvioSnapshot(backend, 'user-access', 2);
		expect(snapshot.library).toHaveLength(1000);
		expect(snapshot.library.at(-1)?.content_id).toBe('movie-999');
		const libraryRequestIndexes = requestedUrls().flatMap((url, index) => url.endsWith('/sync_pull_library') ? [index] : []);
		expect(libraryRequestIndexes).toHaveLength(3);
		expect(requestedBody(libraryRequestIndexes[1])).toContain('"p_offset":500');
	});

	it('fetches watched items page by page instead of using an unbounded page size', async () => {
		const firstPage = Array.from({ length: 500 }, (_, index) => ({ content_id: `watched-${index}`, content_type: 'movie', watched_at: index + 1 }));
		reply([{ content_id: 'library-1', content_type: 'movie', name: 'Library item' }]);
		reply([{ content_id: 'progress-1', content_type: 'movie', video_id: 'progress-1', position: 1, duration: 2, last_watched: 1 }]);
		reply(firstPage);
		reply([{ content_id: 'watched-500', content_type: 'movie', watched_at: 501 }]);

		const snapshot = await fetchNuvioSnapshot(backend, 'user-access', 2);
		expect(snapshot.watched).toHaveLength(501);
		expect(snapshot.watched.at(-1)?.content_id).toBe('watched-500');
		const watchedRequestIndexes = requestedUrls().flatMap((url, index) => url.endsWith('/sync_pull_watched_items') ? [index] : []);
		expect(watchedRequestIndexes).toHaveLength(2);
		expect(requestedBody(watchedRequestIndexes[0])).toContain('"p_page":1');
		expect(requestedBody(watchedRequestIndexes[1])).toContain('"p_page":2');
		expect(requestedBody(watchedRequestIndexes[0])).toContain('"p_page_size":500');
	});
});
