import { requestUrl } from 'obsidian';
import {
	apiErrorSchema,
	datastoreGetSchema,
	datastoreMetaSchema,
	type LibraryItem,
} from '../model/schema';
import { shouldSync, titleWatchStatus, type WatchThresholds } from './watch-status';
import { t } from '../i18n';

const API_BASE = 'https://api.strem.io/api';

export class StremioApiError extends Error {
	constructor(
		message: string,
		readonly kind: 'auth' | 'network' | 'shape' = 'network',
	) {
		super(message);
		this.name = 'StremioApiError';
	}
}

async function post(path: string, body: Record<string, unknown>): Promise<unknown> {
	let json: unknown;
	try {
		const response = await requestUrl({
			url: `${API_BASE}/${path}`,
			method: 'POST',
			contentType: 'application/json',
			body: JSON.stringify(body),
			throw: false,
		});
		if (response.status >= 400) {
			throw new StremioApiError(t('api.http', { status: response.status }));
		}
		json = response.json;
	} catch (error) {
		if (error instanceof StremioApiError) throw error;
		throw new StremioApiError(t('api.reach', { error: error instanceof Error ? error.message : String(error) }));
	}

	// Stremio answers 200 with an `error` envelope for expired or invalid keys.
	const asError = apiErrorSchema.safeParse(json);
	if (asError.success) {
		const message = asError.data.error.message ?? 'unknown error';
		const isAuth = /session|auth|user not found|login/i.test(message);
		throw new StremioApiError(
			isAuth
				? t('api.auth', { message })
				: t('api.error', { message }),
			isAuth ? 'auth' : 'network',
		);
	}
	return json;
}

/** Full library. ~200 items ≈ 120 KB, so a single call is cheaper than paging. */
export async function fetchLibrary(authKey: string): Promise<LibraryItem[]> {
	const json = await post('datastoreGet', { authKey, collection: 'libraryItem', all: true });
	const parsed = datastoreGetSchema.safeParse(json);
	if (!parsed.success) {
			throw new StremioApiError(
				t('api.shape', { message: parsed.error.issues[0]?.message ?? 'unknown validation error' }),
				'shape',
			);
	}
	return parsed.data.result ?? [];
}

/** Cheap `[id, mtime]` listing used to decide whether a full fetch is needed. */
export async function fetchLibraryMeta(authKey: string): Promise<{ id: string; mtime: string }[]> {
	const json = await post('datastoreMeta', { authKey, collection: 'libraryItem' });
	const parsed = datastoreMetaSchema.safeParse(json);
	if (!parsed.success) {
			throw new StremioApiError(
				t('api.shape', { message: parsed.error.issues[0]?.message ?? 'unknown validation error' }),
				'shape',
			);
	}
	return (parsed.data.result ?? []).map(([id, mtime]) => ({ id, mtime }));
}

export function isSupportedType(item: LibraryItem): boolean {
	return item.type === 'movie' || item.type === 'series';
}

export interface SelectionOptions extends WatchThresholds {
	includeUnwatchedLibrary: boolean;
	skipSampledTitles: boolean;
}

/**
 * Items actually worth a note.
 *
 * `removed`/`temp` cannot be used as a rejection filter on their own: a film
 * played without being added to the library ends up `removed: true, temp: true`
 * while still carrying `flaggedWatched: 1`. Dropping those would lose real
 * viewing history. What separates a real watch from a title merely opened to see
 * what it is lives in `watch-status.ts`.
 */
export function selectRelevant(items: LibraryItem[], options: SelectionOptions): LibraryItem[] {
	return items.filter((item) => {
		if (!isSupportedType(item)) return false;
		return shouldSync(titleWatchStatus(item, options), {
			includeUnwatchedLibrary: options.includeUnwatchedLibrary,
			skipSampled: options.skipSampledTitles,
			inLibrary: item.removed !== true,
		});
	});
}
