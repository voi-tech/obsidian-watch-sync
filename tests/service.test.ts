import { describe, expect, it } from 'vitest';
import { MetadataCache } from '../src/meta/cache';
import { DEFAULT_DATA } from '../src/model/types';
import { SyncService } from '../src/sync/service';
import type { ApplicableOperation } from '../src/sync/operations';
import { FakeVault } from './fake-gateway';

const PATH = 'plugins/stremio-sync/cache.json';

function fakeAdapter() {
	const files = new Map<string, string>();
	return {
		files,
		adapter: {
			async exists(path: string) {
				return files.has(path);
			},
			async read(path: string) {
				const value = files.get(path);
				if (value === undefined) throw new Error('missing');
				return value;
			},
			async write(path: string, value: string) {
				files.set(path, value);
			},
		} as never,
	};
}

function operation(apply: () => Promise<void>): ApplicableOperation {
	return {
		kind: 'create-file',
		mediaId: 'tt1',
		title: 'Arrival',
		path: 'Movies/Arrival.md',
		summary: () => 'Create the note',
		describe: () => 'Create the note — Movies/Arrival.md',
		apply,
	};
}

function serviceWithCache() {
	const { adapter, files } = fakeAdapter();
	const cache = new MetadataCache(adapter, PATH, '2:26.8.1');
	cache.set('norm:tt1', { title: 'Arrival' });
	const data = structuredClone(DEFAULT_DATA);
	data.settings.movieFolder = 'Movies';
	data.settings.seriesFolder = 'Series';
	const service = new SyncService({} as never, data, new FakeVault(), cache);
	return { files, service };
}

describe('sync cache durability', () => {
	it('persists derived metadata only after a complete successful apply', async () => {
		const { files, service } = serviceWithCache();

		await expect(
			service.apply({ create: [operation(async () => undefined)], adopt: [], update: [], conflicts: [], skipped: [] }),
		).resolves.toMatchObject({ errors: [] });
		expect(files.has(PATH)).toBe(true);
	});

	it('does not persist cache entries from a partial or failed apply', async () => {
		const partial = serviceWithCache();
		await partial.service.apply(
			{ create: [operation(async () => undefined)], adopt: [], update: [], conflicts: [], skipped: [] },
			{ deselected: 1 },
		);
		expect(partial.files.has(PATH)).toBe(false);

		const failed = serviceWithCache();
		const result = await failed.service.apply({
			create: [operation(async () => Promise.reject(new Error('write failed')))],
			adopt: [],
			update: [],
			conflicts: [],
			skipped: [],
		});
		expect(result.errors).toHaveLength(1);
		expect(failed.files.has(PATH)).toBe(false);
	});
});
