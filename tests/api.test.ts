import { beforeEach, describe, expect, it } from 'vitest';
import { datastoreGetSchema, libraryItemSchema } from '../src/model/schema';
import { fetchLibrary, selectRelevant, StremioApiError, type SelectionOptions } from '../src/stremio/api';
import { DEFAULT_THRESHOLDS } from '../src/stremio/watch-status';

const selection = (overrides: Partial<SelectionOptions> = {}): SelectionOptions => ({
	...DEFAULT_THRESHOLDS,
	includeUnwatchedLibrary: true,
	skipSampledTitles: true,
	...overrides,
});
import { lastRequestedUrl, mockedRequestUrl, replyOnce as reply } from './helpers';
import { allItems, channel, doctorStrange, hijack, lordOfTheRings, mrNobody } from './fixtures/library';

describe('schema', () => {
	it('accepts a real library item', () => {
		expect(libraryItemSchema.parse(hijack)).toMatchObject({ _id: 'tt19854762', type: 'series' });
	});

	it('tolerates a missing state object', () => {
		const parsed = libraryItemSchema.parse({ _id: 'tt1', name: 'X', type: 'movie' });
		expect(parsed.state).toEqual({});
	});

	it('tolerates a null result array', () => {
		expect(datastoreGetSchema.parse({ result: null }).result).toBeNull();
	});

	it('rejects a response missing the result key', () => {
		expect(datastoreGetSchema.safeParse({ items: [] }).success).toBe(false);
	});

	it('rejects an item without an id', () => {
		expect(libraryItemSchema.safeParse({ name: 'X', type: 'movie' }).success).toBe(false);
	});
});

describe('selectRelevant', () => {
	it('drops unsupported types', () => {
		expect(selectRelevant(allItems, selection())).not.toContain(channel);
	});

	it('keeps a watched item even though it is removed and temporary', () => {
		expect(selectRelevant(allItems, selection())).toContain(doctorStrange);
		expect(selectRelevant(allItems, selection({ includeUnwatchedLibrary: false }))).toContain(doctorStrange);
	});

	it('keeps never-played library entries only when asked to', () => {
		expect(selectRelevant(allItems, selection())).toContain(lordOfTheRings);
		expect(selectRelevant(allItems, selection({ includeUnwatchedLibrary: false }))).not.toContain(lordOfTheRings);
	});

	it('keeps tmdb-prefixed ids', () => {
		expect(selectRelevant(allItems, selection())).toContain(mrNobody);
	});

	it('counts real partial progress as played', () => {
		const partial = { ...lordOfTheRings, state: { ...lordOfTheRings.state, timeOffset: 20 * 60_000 } };
		expect(selectRelevant([partial], selection({ includeUnwatchedLibrary: false }))).toHaveLength(1);
	});

	it('does not count two minutes of playback as having watched anything', () => {
		const glanced = { ...lordOfTheRings, state: { ...lordOfTheRings.state, timeOffset: 2 * 60_000 } };
		expect(selectRelevant([glanced], selection({ includeUnwatchedLibrary: false }))).toHaveLength(0);
	});
});

describe('fetchLibrary', () => {
	beforeEach(() => {
		mockedRequestUrl.mockReset();
	});

	it('returns the parsed library', async () => {
		reply({ result: [hijack] });
		await expect(fetchLibrary('key')).resolves.toHaveLength(1);
		expect(lastRequestedUrl()).toBe('https://api.strem.io/api/datastoreGet');
	});

	it('treats an error envelope on HTTP 200 as an auth failure', async () => {
		reply({ error: { message: 'User not found or session expired', code: 1 } });
		await expect(fetchLibrary('stale')).rejects.toMatchObject({
			kind: 'auth',
			name: 'StremioApiError',
		});
	});

	it('reports a non-auth API error without blaming the key', async () => {
		reply({ error: { message: 'Internal server error', code: 500 } });
		await expect(fetchLibrary('key')).rejects.toMatchObject({ kind: 'network' });
	});

	it('flags an unexpected response shape instead of silently returning nothing', async () => {
		reply({ result: [{ name: 'no id here' }] });
		const error = await fetchLibrary('key').catch((e: unknown) => e);
		expect(error).toBeInstanceOf(StremioApiError);
		expect((error as StremioApiError).kind).toBe('shape');
	});

	it('surfaces HTTP failures', async () => {
		reply({}, 503);
		await expect(fetchLibrary('key')).rejects.toThrow(/HTTP 503/);
	});
});
