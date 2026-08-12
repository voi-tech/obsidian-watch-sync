import type { App } from 'obsidian';

/**
 * Thin wrapper over Obsidian's vault-specific SecretStorage (1.11.4+).
 * `data.json` only ever holds the secret id, never the value itself.
 */
export function readSecret(app: App, secretId: string): string | null {
	if (!secretId) return null;
	try {
		const value = app.secretStorage.getSecret(secretId);
		return value && value.length > 0 ? value : null;
	} catch {
		return null;
	}
}

export class MissingSecretError extends Error {
	constructor(what: string) {
		super(what);
		this.name = 'MissingSecretError';
	}
}

export function requireSecret(app: App, secretId: string, label: string): string {
	const value = readSecret(app, secretId);
	if (!value) {
		throw new MissingSecretError(
			`Missing secret "${label}". Open the Stremio Sync settings and store it in Obsidian SecretStorage.`,
		);
	}
	return value;
}
