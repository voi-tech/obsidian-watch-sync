import { requestUrl } from 'obsidian';
import type { Mock } from 'vitest';

/**
 * `tsc` resolves `obsidian` to the real (types-only) package while Vitest swaps in
 * the stub, so the mock surface has to be reasserted for the type checker.
 */
export const mockedRequestUrl = requestUrl as unknown as Mock;

type RequestCall = [{ url: string; headers?: Record<string, string>; body?: string }];

function requestCalls(): RequestCall[] {
	return mockedRequestUrl.mock.calls as unknown as RequestCall[];
}

export function replyOnce(json: unknown, status = 200): void {
	mockedRequestUrl.mockResolvedValueOnce({ status, json, text: JSON.stringify(json) });
}

export function lastRequestedUrl(index = 0): string {
	return requestCalls()[index][0].url;
}

export function requestedUrls(): string[] {
	return requestCalls().map((call) => call[0].url);
}

export function requestedHeaders(index = 0): Record<string, string> | undefined {
	const headers: unknown = requestCalls()[index]?.[0].headers;
	if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return undefined;
	return Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

export function requestedBody(index = 0): string | undefined {
	return requestCalls()[index]?.[0].body;
}
