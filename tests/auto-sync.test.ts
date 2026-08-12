/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StremioSyncPlugin from '../src/main';
import { DEFAULT_DATA } from '../src/model/types';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('automatic sync timer lifecycle', () => {
	it('registers the active interval with Obsidian and replaces it without overlap', () => {
		const plugin = new StremioSyncPlugin({} as never, {} as never);
		plugin.data = structuredClone(DEFAULT_DATA);
		plugin.data.settings.autoSyncEnabled = true;
		plugin.data.settings.autoSyncIntervalMinutes = 15;
		vi.spyOn(plugin, 'sync').mockResolvedValue(undefined);
		const registered = () =>
			(plugin as unknown as { registeredIntervals: number[] }).registeredIntervals;

		plugin.restartAutoSync();
		expect(registered()).toHaveLength(1);
		expect(vi.getTimerCount()).toBe(1);

		plugin.restartAutoSync();
		expect(registered()).toHaveLength(2);
		expect(vi.getTimerCount()).toBe(1);

		plugin.onunload();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('clears an existing interval when background sync is disabled', () => {
		const plugin = new StremioSyncPlugin({} as never, {} as never);
		plugin.data = structuredClone(DEFAULT_DATA);
		plugin.data.settings.autoSyncEnabled = true;
		plugin.restartAutoSync();
		expect(vi.getTimerCount()).toBe(1);

		plugin.data.settings.autoSyncEnabled = false;
		plugin.restartAutoSync();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('does not schedule background sync before the layout-ready phase', () => {
		const plugin = new StremioSyncPlugin({} as never, {} as never);
		plugin.data = structuredClone(DEFAULT_DATA);
		plugin.data.settings.autoSyncEnabled = true;
		const lifecycle = plugin as unknown as { layoutReady: boolean };
		lifecycle.layoutReady = false;

		plugin.restartAutoSync();
		expect(vi.getTimerCount()).toBe(0);

		lifecycle.layoutReady = true;
		plugin.restartAutoSync();
		expect(vi.getTimerCount()).toBe(1);
	});
});

describe('metadata cache command', () => {
	it('reports a cache write failure without leaving an unhandled rejection', async () => {
		const plugin = new StremioSyncPlugin({} as never, {} as never);
		const cache = { clear: vi.fn(), save: vi.fn().mockRejectedValue(new Error('disk full')) };
		(plugin as unknown as { cache: typeof cache }).cache = cache;
		const report = vi.spyOn(plugin, 'reportError').mockImplementation(() => undefined);

		await expect(plugin.clearMetadataCache()).resolves.toBeUndefined();
		expect(cache.clear).toHaveBeenCalledTimes(1);
		expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: 'disk full' }));
	});
});
