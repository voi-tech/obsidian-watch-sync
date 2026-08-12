import { beforeEach, describe, expect, it } from 'vitest';
import { createLinkCode, readLinkAuthKey } from '../src/stremio/link';
import { StremioApiError } from '../src/stremio/api';
import { lastRequestedUrl, mockedRequestUrl, replyOnce } from './helpers';

describe('Stremio pairing', () => {
	beforeEach(() => {
		mockedRequestUrl.mockReset();
	});

	it('reads the code out of the real response shape', async () => {
		// Verbatim from https://link.stremio.com/api/create.
		replyOnce({
			success: true,
			code: 'RXDM',
			link: 'https://link.stremio.com/RXDM',
			qrcode: 'https://link.stremio.com/qr?data=…',
			result: { success: true, code: 'RXDM', link: 'https://link.stremio.com/RXDM' },
			error: null,
		});

		await expect(createLinkCode()).resolves.toEqual({
			code: 'RXDM',
			link: 'https://link.stremio.com/RXDM',
		});
		expect(lastRequestedUrl()).toBe('https://link.stremio.com/api/create');
	});

	it('reports a service failure rather than hanging on a missing code', async () => {
		replyOnce({}, 503);
		await expect(createLinkCode()).rejects.toBeInstanceOf(StremioApiError);
	});

	it('reports an unexpected shape', async () => {
		replyOnce({ nothing: 'useful' });
		await expect(createLinkCode()).rejects.toMatchObject({ kind: 'shape' });
	});

	it('rejects an approval link outside the Stremio HTTPS origin', async () => {
		replyOnce({ code: 'RXDM', link: 'https://example.com/steal/RXDM' });
		await expect(createLinkCode()).rejects.toMatchObject({ kind: 'shape' });
	});

	it('rejects a non-HTTPS Stremio approval link', async () => {
		replyOnce({ code: 'RXDM', link: 'http://link.stremio.com/RXDM' });
		await expect(createLinkCode()).rejects.toMatchObject({ kind: 'shape' });
	});

	it('returns the key once the code is approved', async () => {
		replyOnce({ result: { authKey: 'secret-key' }, error: null });
		await expect(readLinkAuthKey('RXDM')).resolves.toBe('secret-key');
		expect(lastRequestedUrl()).toBe('https://link.stremio.com/api/read?code=RXDM');
	});

	it('treats "invalid or expired" as still waiting', async () => {
		// The service answers the same way for a pending code and a dead one, so
		// polling has to keep going rather than give up on the first refusal.
		replyOnce({ result: null, error: { code: 101, message: 'Invalid or expired token' } });
		await expect(readLinkAuthKey('RXDM')).resolves.toBeNull();
	});

	it('reports a transport failure so the connection dialog can offer retry', async () => {
		replyOnce({}, 500);
		await expect(readLinkAuthKey('RXDM')).rejects.toBeInstanceOf(StremioApiError);
	});

	it('escapes the code in the query', async () => {
		replyOnce({ result: null });
		await readLinkAuthKey('A B&C');
		expect(lastRequestedUrl()).toBe('https://link.stremio.com/api/read?code=A%20B%26C');
	});
});
