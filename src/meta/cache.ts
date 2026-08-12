import type { DataAdapter } from 'obsidian';
import { z } from 'zod';

interface CacheEntry<T> {
	value: T;
	storedAt: number;
	/** Stremio `_mtime` at the time of caching; a change invalidates the entry. */
	mtime?: string;
}

interface CacheFile {
	/** Identifies the shape of the cached values, not the file format. */
	version: string;
	entries: Record<string, CacheEntry<unknown>>;
}

const cacheFileSchema = z.object({
	version: z.string(),
	entries: z.record(
		z.object({
			value: z.unknown(),
			storedAt: z.number().finite(),
			mtime: z.string().optional(),
		}),
	),
});

/**
 * Bump whenever the derivation of a cached value changes — a renamed field, a
 * different link format, a new rule. The cache stores finished objects, so a
 * code change that alters them is invisible until the entries are thrown away.
 *
 * The plugin version is mixed in as well, so a release invalidates derived data
 * automatically and this constant only has to move during development.
 */
export const DERIVED_SCHEMA_VERSION = '2';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Metadata cache kept next to the plugin, not in the vault. Finished titles never
 * change again, so they are held far longer than shows still airing.
 */
export class MetadataCache {
	private entries: Record<string, CacheEntry<unknown>> = {};
	private dirty = false;

	constructor(
		private readonly adapter: DataAdapter,
		private readonly path: string,
		/** Everything cached is discarded when this changes. */
		private readonly version: string,
	) {}

	async load(): Promise<void> {
		if (!this.path) return;
		try {
			if (!(await this.adapter.exists(this.path))) return;
			const parsed = cacheFileSchema.safeParse(JSON.parse(await this.adapter.read(this.path)));
			if (parsed.success && parsed.data.version === this.version) {
				this.entries = Object.fromEntries(
					Object.entries(parsed.data.entries).map(([key, entry]) => [
						key,
						{ value: entry.value, storedAt: entry.storedAt, mtime: entry.mtime },
					]),
				);
			}
		} catch {
			// A corrupt cache is not worth failing a sync over; start empty.
			this.entries = {};
		}
	}

	async save(): Promise<void> {
		if (!this.dirty || !this.path) return;
		const file: CacheFile = { version: this.version, entries: this.entries };
		await this.adapter.write(this.path, JSON.stringify(file));
		this.dirty = false;
	}

	get<T>(key: string, options: { mtime?: string; ttlDays: number }): T | null {
		const entry = this.entries[key] as CacheEntry<T> | undefined;
		if (!entry) return null;
		if (options.mtime && entry.mtime && entry.mtime !== options.mtime) return null;
		// `>=` so a zero-day TTL means "always stale" rather than "never expires".
		if (Date.now() - entry.storedAt >= options.ttlDays * DAY_MS) return null;
		return entry.value;
	}

	set<T>(key: string, value: T, mtime?: string): void {
		this.entries[key] = { value, storedAt: Date.now(), mtime };
		this.dirty = true;
	}

	clear(): void {
		this.entries = {};
		this.dirty = true;
	}

	get size(): number {
		return Object.keys(this.entries).length;
	}
}

/** Finished titles are frozen; anything still in progress is refreshed weekly. */
export function ttlDaysFor(finished: boolean): number {
	return finished ? 90 : 7;
}
