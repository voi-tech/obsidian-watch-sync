/**
 * Bounded concurrency. A first sync normalizes a couple of hundred titles, each
 * costing several HTTP round trips; doing that strictly one at a time is minutes
 * of waiting, and doing it all at once would hammer TMDB.
 */
export interface Limiter {
	run<T>(task: () => Promise<T>): Promise<T>;
}

export function createLimiter(max: number): Limiter {
	const limit = Math.max(1, Math.floor(max));
	let active = 0;
	const waiting: (() => void)[] = [];

	const release = (): void => {
		active -= 1;
		waiting.shift()?.();
	};

	return {
		async run<T>(task: () => Promise<T>): Promise<T> {
			if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
			active += 1;
			try {
				return await task();
			} finally {
				release();
			}
		},
	};
}

/**
 * Maps with bounded concurrency, preserving input order so a plan built from the
 * result is deterministic. `onSettled` fires once per completed item, in
 * completion order, for progress reporting.
 */
export async function mapWithLimit<T, R>(
	items: readonly T[],
	max: number,
	map: (item: T, index: number) => Promise<R>,
	onSettled?: (done: number, total: number) => void,
): Promise<R[]> {
	const limiter = createLimiter(max);
	let done = 0;
	return Promise.all(
		items.map((item, index) =>
			limiter.run(async () => {
				try {
					return await map(item, index);
				} finally {
					done += 1;
					onSettled?.(done, items.length);
				}
			}),
		),
	);
}
