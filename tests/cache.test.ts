import { describe, expect, it } from 'vitest';
import { MetadataCache, ttlDaysFor } from '../src/meta/cache';

/** Minimal stand-in for Obsidian's DataAdapter, backed by a plain map. */
function fakeAdapter(initial: Record<string, string> = {}) {
	const files = new Map(Object.entries(initial));
	return {
		files,
		adapter: {
			async exists(path: string) {
				return files.has(path);
			},
			async read(path: string) {
				const content = files.get(path);
				if (content === undefined) throw new Error('missing');
				return content;
			},
			async write(path: string, content: string) {
				files.set(path, content);
			},
		} as never,
	};
}

const PATH = 'plugins/watch-sync/cache.json';

describe('MetadataCache', () => {
	it('round-trips a value', async () => {
		const { adapter, files } = fakeAdapter();
		const cache = new MetadataCache(adapter, PATH, '2:26.8.0');
		cache.set('a', { title: 'X' });
		await cache.save();

		const reloaded = new MetadataCache(adapter, PATH, '2:26.8.0');
		await reloaded.load();
		expect(reloaded.get('a', { ttlDays: 30 })).toEqual({ title: 'X' });
		expect(files.size).toBe(1);
	});

	it('loads persisted string-keyed entries with nullable and nested values', async () => {
		const entries = {
			'tmdb:movie:1': { value: { title: 'X', genres: ['Drama'] }, storedAt: Date.now(), mtime: '2026-01-01' },
			'cinemeta:tt2': { value: null, storedAt: Date.now() },
		};
		const { adapter } = fakeAdapter({ [PATH]: JSON.stringify({ version: '2:26.8.0', entries }) });
		const cache = new MetadataCache(adapter, PATH, '2:26.8.0');
		await cache.load();
		expect(cache.size).toBe(2);
		expect(cache.get('tmdb:movie:1', { ttlDays: 30, mtime: '2026-01-01' })).toEqual(entries['tmdb:movie:1'].value);
		expect(cache.get('tmdb:movie:1', { ttlDays: 30, mtime: '2026-02-01' })).toBeNull();
		expect(cache.get('cinemeta:tt2', { ttlDays: 30 })).toBeNull();
	});

	it('throws away everything when the derived shape changes', async () => {
		// The cache stores finished objects, so a code change that alters how they
		// are built is invisible until the entries are dropped. This is what makes
		// a fixed link format actually reach the plan.
		const { adapter } = fakeAdapter();
		const old = new MetadataCache(adapter, PATH, '1:26.8.0');
		old.set('a', { stremioUrl: 'https://web.stremio.com/#/detail/movie/tt1/tt1' });
		await old.save();

		const upgraded = new MetadataCache(adapter, PATH, '2:26.8.0');
		await upgraded.load();
		expect(upgraded.get('a', { ttlDays: 30 })).toBeNull();
		expect(upgraded.size).toBe(0);
	});

	it('throws away everything when the plugin version changes', async () => {
		const { adapter } = fakeAdapter();
		const old = new MetadataCache(adapter, PATH, '2:26.8.0');
		old.set('a', { title: 'X' });
		await old.save();

		const upgraded = new MetadataCache(adapter, PATH, '2:26.9.0');
		await upgraded.load();
		expect(upgraded.get('a', { ttlDays: 30 })).toBeNull();
	});

	it('invalidates an entry whose source item changed', async () => {
		const { adapter } = fakeAdapter();
		const cache = new MetadataCache(adapter, PATH, '2:26.8.0');
		cache.set('a', { title: 'X' }, '2026-01-01T00:00:00Z');

		expect(cache.get('a', { mtime: '2026-01-01T00:00:00Z', ttlDays: 30 })).toEqual({ title: 'X' });
		expect(cache.get('a', { mtime: '2026-02-01T00:00:00Z', ttlDays: 30 })).toBeNull();
	});

	it('expires an entry past its TTL', async () => {
		const { adapter } = fakeAdapter();
		const cache = new MetadataCache(adapter, PATH, '2:26.8.0');
		cache.set('a', { title: 'X' });
		expect(cache.get('a', { ttlDays: 0 })).toBeNull();
	});

	it('survives a corrupt file rather than failing the sync', async () => {
		const { adapter } = fakeAdapter({ [PATH]: 'not json at all' });
		const cache = new MetadataCache(adapter, PATH, '2:26.8.0');
		await expect(cache.load()).resolves.toBeUndefined();
		expect(cache.size).toBe(0);
	});

	it('rejects a structurally invalid cache instead of trusting malformed entries', async () => {
		const malformed = JSON.stringify({
			version: '2:26.8.0',
			entries: { a: { value: { title: 'X' }, storedAt: 'yesterday' } },
		});
		const { adapter } = fakeAdapter({ [PATH]: malformed });
		const cache = new MetadataCache(adapter, PATH, '2:26.8.0');
		await cache.load();
		expect(cache.size).toBe(0);
		expect(cache.get('a', { ttlDays: 30 })).toBeNull();
	});

	it('rejects a persisted entry with no value', async () => {
		const { adapter } = fakeAdapter({ [PATH]: JSON.stringify({
			version: '2:26.8.0', entries: { a: { storedAt: Date.now() } },
		}) });
		const cache = new MetadataCache(adapter, PATH, '2:26.8.0');
		await cache.load();
		expect(cache.size).toBe(0);
	});

	it('stays in memory when there is nowhere to write', async () => {
		const { adapter, files } = fakeAdapter();
		const cache = new MetadataCache(adapter, '', '2:26.8.0');
		cache.set('a', { title: 'X' });
		await cache.save();
		expect(files.size).toBe(0);
		expect(cache.get('a', { ttlDays: 30 })).toEqual({ title: 'X' });
	});

	it('holds finished titles far longer than ones still in progress', () => {
		expect(ttlDaysFor(true)).toBeGreaterThan(ttlDaysFor(false));
	});
});
