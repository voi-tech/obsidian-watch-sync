import { requestUrl } from 'obsidian';
import { z } from 'zod';
import { StremioApiError } from './api';

/**
 * Stremio's own pairing flow — the one its TV apps use.
 *
 * The plugin asks for a short code, the user approves it while already signed in
 * on stremio.com, and the auth key comes back over the wire. No password ever
 * reaches the plugin, and nobody has to dig through a browser console.
 */
const LINK_API = 'https://link.stremio.com/api';

const createSchema = z.object({
	code: z.string(),
	link: z.string(),
	qrcode: z.string().optional(),
});

const readSchema = z.object({
	result: z.object({ authKey: z.string() }).nullable(),
	error: z.object({ code: z.number().optional(), message: z.string().optional() }).nullable().optional(),
});

export interface LinkCode {
	code: string;
	/** Redirects to `stremio.com/login?code=…`. */
	link: string;
}

function isAllowedApprovalUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return (
			url.protocol === 'https:' &&
			(url.hostname === 'stremio.com' || url.hostname.endsWith('.stremio.com'))
		);
	} catch {
		return false;
	}
}

export async function createLinkCode(): Promise<LinkCode> {
	let response;
	try {
		response = await requestUrl({ url: `${LINK_API}/create`, method: 'GET', throw: false });
	} catch (error) {
		throw new StremioApiError(
			`Could not reach Stremio's pairing service: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (response.status !== 200) {
		throw new StremioApiError(`Stremio's pairing service returned HTTP ${response.status}.`);
	}
	const parsed = createSchema.safeParse(response.json);
	if (!parsed.success || !isAllowedApprovalUrl(parsed.data.link)) {
		throw new StremioApiError('Stremio\'s pairing service answered in an unexpected shape.', 'shape');
	}
	return { code: parsed.data.code, link: parsed.data.link };
}

/**
 * Polls for the key. `null` means the user has not approved the code yet — the
 * service answers "invalid or expired" for both pending and dead codes, so
 * waiting is the caller's job.
 */
export async function readLinkAuthKey(code: string): Promise<string | null> {
	let response;
	try {
		response = await requestUrl({
			url: `${LINK_API}/read?code=${encodeURIComponent(code)}`,
			method: 'GET',
			throw: false,
		});
	} catch (error) {
		throw new StremioApiError(
			`Could not reach Stremio's pairing service: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (response.status !== 200) {
		throw new StremioApiError(`Stremio's pairing service returned HTTP ${response.status}.`);
	}
	const parsed = readSchema.safeParse(response.json);
	if (!parsed.success) {
		throw new StremioApiError('Stremio\'s pairing service answered in an unexpected shape.', 'shape');
	}
	return parsed.data.result?.authKey ?? null;
}
