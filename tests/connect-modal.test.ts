/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectModal } from '../src/ui/connect-modal';
import { installObsidianDom } from './stubs/dom';
import { createLinkCode, readLinkAuthKey } from '../src/stremio/link';

vi.mock('../src/stremio/link', () => ({
	createLinkCode: vi.fn(),
	readLinkAuthKey: vi.fn(),
}));

const create = vi.mocked(createLinkCode);
const read = vi.mocked(readLinkAuthKey);

beforeAll(() => installObsidianDom());

beforeEach(() => {
	vi.useFakeTimers();
	create.mockReset().mockResolvedValue({ code: 'RXDM', link: 'https://link.stremio.com/RXDM' });
	read.mockReset().mockResolvedValue(null);
});

afterEach(() => {
	vi.useRealTimers();
	document.body.empty();
});

async function settle(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

async function opened(onKey = vi.fn(async () => undefined)): Promise<{ modal: ConnectModal; onKey: typeof onKey }> {
	const modal = new ConnectModal({} as never, onKey);
	modal.open();
	await settle();
	return { modal, onKey };
}

describe('ConnectModal polling', () => {
	it('never overlaps pairing reads when a request is still in flight', async () => {
		let finish!: (value: string | null) => void;
		read.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
		const { modal } = await opened();

		await vi.advanceTimersByTimeAsync(6_000);
		expect(read).toHaveBeenCalledTimes(1);

		finish(null);
		await settle();
		await vi.advanceTimersByTimeAsync(2_000);
		expect(read).toHaveBeenCalledTimes(2);
		modal.close();
	});

	it('shows a transport error, stops polling, and offers retry', async () => {
		read.mockRejectedValueOnce(new Error('network unavailable'));
		const { modal } = await opened();

		await vi.advanceTimersByTimeAsync(2_000);
		await settle();

		expect(modal.contentEl.textContent).toContain('network unavailable');
		expect(modal.contentEl.textContent).toContain('Try again');
		expect(vi.getTimerCount()).toBe(0);
	});

	it('stores an approved key exactly once', async () => {
		read.mockResolvedValue('auth-key');
		const { modal, onKey } = await opened();

		await vi.advanceTimersByTimeAsync(10_000);
		await settle();

		expect(onKey).toHaveBeenCalledTimes(1);
		expect(onKey).toHaveBeenCalledWith('auth-key');
		expect(vi.getTimerCount()).toBe(0);
		modal.close();
	});

	it('clears its timer when closed', async () => {
		const { modal } = await opened();
		expect(vi.getTimerCount()).toBe(1);
		modal.close();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('opens the validated approval page without an opener', async () => {
		const open = vi.spyOn(window, 'open').mockImplementation(() => null);
		const { modal } = await opened();
		const button = Array.from(modal.contentEl.querySelectorAll('button')).find(
			(candidate) => candidate.textContent === 'Open the approval page',
		)!;
		button.click();
		expect(open).toHaveBeenCalledWith(
			'https://link.stremio.com/RXDM',
			'_blank',
			'noopener,noreferrer',
		);
		modal.close();
		open.mockRestore();
	});
});
