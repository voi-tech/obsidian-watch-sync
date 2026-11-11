import { requestUrl } from 'obsidian';
import { z } from 'zod';

const discoverySchema = z.object({
	version: z.literal(1),
	service: z.literal('nuvio'),
	backend_url: z.url(),
	publishable_key: z.string().min(1),
	capabilities: z.object({ tv_login: z.boolean().optional() }).default({}),
});
const anonymousSessionSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1) });
const challengeSchema = z.object({ code: z.string().min(1), qr_content: z.url().optional(), web_url: z.url().optional(), poll_interval_seconds: z.number().positive().optional() });
const sessionSchema = z.object({
	access_token: z.string().min(1),
	refresh_token: z.string().min(1).optional(),
	expires_in: z.number().positive().optional(),
	expires_at: z.number().positive().optional(),
});
const profileSchema = z.object({ id: z.string().min(1), profile_index: z.number().int().nonnegative(), name: z.string().min(1) });
const libraryEntrySchema = z.object({ content_id: z.string().min(1), content_type: z.string().min(1), name: z.string().default(''), poster: z.string().nullable().optional(), description: z.string().nullable().optional(), release_info: z.string().nullable().optional(), genres: z.array(z.string()).default([]) });
const progressEntrySchema = z.object({ content_id: z.string().min(1), content_type: z.string().min(1), video_id: z.string().default(''), position: z.number().nonnegative().default(0), duration: z.number().nonnegative().default(0), last_watched: z.number().nonnegative().default(0), season: z.number().int().nullable().optional(), episode: z.number().int().nullable().optional() });
const watchedEntrySchema = z.object({ content_id: z.string().min(1), content_type: z.string().min(1), watched_at: z.number().nonnegative().optional(), video_id: z.string().optional() }).loose();

export interface NuvioBackend { backendUrl: string; publishableKey: string; supportsTvLogin: boolean; }
export interface NuvioSession { accessToken: string; refreshToken: string; expiresAt: number; }
export interface NuvioProfile { id: string; index: number; name: string; }
export interface NuvioTvLogin { code: string; loginUrl: string; pollIntervalMs: number; callerAccessToken: string; }
export interface NuvioSnapshot { library: z.infer<typeof libraryEntrySchema>[]; progress: z.infer<typeof progressEntrySchema>[]; watched: z.infer<typeof watchedEntrySchema>[]; }

export class NuvioApiError extends Error {}

function httpsUrl(value: string): string {
	const url = new URL(value.trim());
	if (url.protocol !== 'https:') throw new NuvioApiError('Nuvio backend must use HTTPS.');
	return url.origin;
}

async function request(url: string, options: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: unknown } = {}): Promise<unknown> {
	let response;
	try {
		response = await requestUrl({ url, method: options.method ?? 'GET', contentType: 'application/json', headers: options.headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), throw: false });
	} catch {
		throw new NuvioApiError('Could not reach Nuvio.');
	}
	if (response.status < 200 || response.status >= 300) throw new NuvioApiError(`Nuvio returned HTTP ${response.status}.`);
	return response.json;
}

function headers(backend: NuvioBackend, accessToken?: string): Record<string, string> {
	return { apikey: backend.publishableKey, ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) };
}

function sessionFromResponse(data: z.infer<typeof sessionSchema>, fallbackRefreshToken?: string): NuvioSession {
	const expiresAt = data.expires_at === undefined
		? Date.now() + (data.expires_in ?? 3600) * 1000
		: data.expires_at * 1000;
	const refreshToken = data.refresh_token ?? fallbackRefreshToken;
	if (!refreshToken) throw new NuvioApiError('Nuvio did not return a refresh token.');
	return { accessToken: data.access_token, refreshToken, expiresAt };
}

export async function discoverNuvioBackend(rawBackendUrl: string): Promise<NuvioBackend> {
	const requestedUrl = httpsUrl(rawBackendUrl);
	const parsed = discoverySchema.safeParse(await request(`${requestedUrl}/.well-known/nuvio`));
	if (!parsed.success) throw new NuvioApiError('Nuvio discovery returned an unsupported configuration.');
	const backendUrl = httpsUrl(parsed.data.backend_url);
	return { backendUrl, publishableKey: parsed.data.publishable_key, supportsTvLogin: parsed.data.capabilities.tv_login === true };
}

async function anonymousCaller(backend: NuvioBackend): Promise<string> {
	const parsed = anonymousSessionSchema.safeParse(await request(`${backend.backendUrl}/auth/v1/signup`, { method: 'POST', headers: headers(backend, backend.publishableKey), body: { data: { tv_client: 'obsidian' } } }));
	if (!parsed.success) throw new NuvioApiError('Nuvio did not create a TV login session.');
	return parsed.data.access_token;
}

export async function beginNuvioTvLogin(backend: NuvioBackend, nonce: string, deviceName: string): Promise<NuvioTvLogin> {
	if (!backend.supportsTvLogin) throw new NuvioApiError('This Nuvio backend does not support TV sign-in.');
	const callerAccessToken = await anonymousCaller(backend);
	const response = await request(`${backend.backendUrl}/rest/v1/rpc/start_tv_login_session`, { method: 'POST', headers: headers(backend, callerAccessToken), body: { p_device_nonce: nonce, p_device_name: deviceName, p_redirect_base_url: 'https://nuvio.tv/tv-login' } });
	const parsed = z.array(challengeSchema).nonempty().safeParse(response);
	if (!parsed.success) throw new NuvioApiError('Nuvio returned an invalid TV sign-in challenge.');
	const challenge = parsed.data[0];
	const loginUrl = challenge.qr_content ?? challenge.web_url;
	if (!loginUrl) throw new NuvioApiError('Nuvio TV sign-in challenge has no approval link.');
	return { code: challenge.code, loginUrl, pollIntervalMs: Math.max(1_000, (challenge.poll_interval_seconds ?? 3) * 1_000), callerAccessToken };
}

export async function exchangeNuvioTvLogin(backend: NuvioBackend, callerAccessToken: string, code: string, nonce: string): Promise<NuvioSession> {
	const parsed = sessionSchema.safeParse(await request(`${backend.backendUrl}/functions/v1/tv-logins-exchange`, { method: 'POST', headers: headers(backend, callerAccessToken), body: { code, device_nonce: nonce } }));
	if (!parsed.success) throw new NuvioApiError('Nuvio TV sign-in did not return a valid session.');
	return sessionFromResponse(parsed.data);
}

/** Returns true while the access token remains valid beyond the refresh safety window. */
export function isNuvioSessionValid(session: NuvioSession, now = Date.now(), refreshLeewayMs = 60_000): boolean {
	return Boolean(session.accessToken && session.refreshToken && Number.isFinite(session.expiresAt) && session.expiresAt > now + Math.max(0, refreshLeewayMs));
}

/** Refreshes a Nuvio/Supabase session without exposing the session values to logs or UI. */
export async function refreshNuvioSession(backend: NuvioBackend, refreshToken: string): Promise<NuvioSession> {
	if (!refreshToken.trim()) throw new NuvioApiError('Nuvio session has no refresh token.');
	const parsed = sessionSchema.safeParse(await request(`${backend.backendUrl}/auth/v1/token?grant_type=refresh_token`, {
		method: 'POST',
		headers: headers(backend, backend.publishableKey),
		body: { refresh_token: refreshToken },
	}));
	if (!parsed.success) throw new NuvioApiError('Nuvio session refresh returned an invalid session.');
	return sessionFromResponse(parsed.data, refreshToken);
}

/** Returns the current session or refreshes it when it is near expiry. */
export async function ensureNuvioSession(backend: NuvioBackend, session: NuvioSession, now = Date.now(), refreshLeewayMs = 60_000): Promise<NuvioSession> {
	if (isNuvioSessionValid(session, now, refreshLeewayMs)) return session;
	return refreshNuvioSession(backend, session.refreshToken);
}

export async function pollNuvioTvLogin(backend: NuvioBackend, callerAccessToken: string, code: string, nonce: string): Promise<'pending' | 'approved' | 'expired'> {
	const parsed = z.array(z.object({ status: z.string() })).nonempty().safeParse(await request(`${backend.backendUrl}/rest/v1/rpc/poll_tv_login_session`, { method: 'POST', headers: headers(backend, callerAccessToken), body: { p_code: code, p_device_nonce: nonce } }));
	if (!parsed.success) throw new NuvioApiError('Nuvio returned an invalid TV sign-in status.');
	const status = parsed.data[0].status.toLowerCase();
	if (status === 'approved' || status === 'authenticated') return 'approved';
	if (status === 'expired' || status === 'cancelled') return 'expired';
	return 'pending';
}

export async function fetchNuvioProfiles(backend: NuvioBackend, accessToken: string): Promise<NuvioProfile[]> {
	const parsed = z.array(profileSchema).safeParse(await request(`${backend.backendUrl}/rest/v1/rpc/sync_pull_profiles`, { method: 'POST', headers: headers(backend, accessToken), body: {} }));
	if (!parsed.success) throw new NuvioApiError('Nuvio returned invalid profiles.');
	return parsed.data.map((profile) => ({ id: profile.id, index: profile.profile_index, name: profile.name }));
}

export function resolveNuvioProfileIndex(profiles: readonly NuvioProfile[], profileId: string): number {
	const profile = profiles.find((candidate) => candidate.id === profileId.trim());
	if (!profile) throw new NuvioApiError('The selected Nuvio profile is no longer available. Refresh profiles and select it again.');
	return profile.index;
}

export async function fetchNuvioSnapshot(backend: NuvioBackend, accessToken: string, profileIndex: number): Promise<NuvioSnapshot> {
	const pull = (rpc: string, body: Record<string, number>) => request(`${backend.backendUrl}/rest/v1/rpc/${rpc}`, { method: 'POST', headers: headers(backend, accessToken), body });
	const libraryPageSize = 500;
	const watchedPageSize = 500;
	const fetchLibrary = async (): Promise<z.infer<typeof libraryEntrySchema>[]> => {
		const entries: z.infer<typeof libraryEntrySchema>[] = [];
		let offset = 0;
		while (true) {
			const parsed = z.array(libraryEntrySchema).safeParse(await pull('sync_pull_library', { p_profile_id: profileIndex, p_limit: libraryPageSize, p_offset: offset }));
			if (!parsed.success) throw new NuvioApiError('Nuvio returned an invalid library page.');
			if (parsed.data.length === 0) break;
			entries.push(...parsed.data);
			if (parsed.data.length < libraryPageSize) break;
			offset += parsed.data.length;
		}
		return entries;
	};
	const fetchWatched = async (): Promise<z.infer<typeof watchedEntrySchema>[]> => {
		const entries: z.infer<typeof watchedEntrySchema>[] = [];
		let page = 1;
		while (true) {
			const parsed = z.array(watchedEntrySchema).safeParse(await pull('sync_pull_watched_items', { p_profile_id: profileIndex, p_page: page, p_page_size: watchedPageSize }));
			if (!parsed.success) throw new NuvioApiError('Nuvio returned an invalid watched-items page.');
			if (parsed.data.length === 0) break;
			entries.push(...parsed.data);
			if (parsed.data.length < watchedPageSize) break;
			page += 1;
		}
		return entries;
	};
	const [libraryRaw, progressRaw, watchedRaw] = await Promise.all([
		fetchLibrary(),
		pull('sync_pull_watch_progress', { p_profile_id: profileIndex }),
		fetchWatched(),
	]);
	const library = z.array(libraryEntrySchema).safeParse(libraryRaw);
	const progress = z.array(progressEntrySchema).safeParse(progressRaw);
	const watched = z.array(watchedEntrySchema).safeParse(watchedRaw);
	if (!library.success || !progress.success || !watched.success) throw new NuvioApiError('Nuvio returned an unsupported media snapshot.');
	return { library: library.data, progress: progress.data, watched: watched.data };
}
