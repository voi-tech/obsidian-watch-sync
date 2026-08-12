import { normalizePath, type Vault } from 'obsidian';
import { TemplateError } from './template';

type TemplateVault = Pick<Vault, 'getFileByPath' | 'cachedRead'>;

/** Empty selects the built-in template; a configured path must remain valid. */
export async function readTemplateSource(vault: TemplateVault, path: string): Promise<string> {
	if (!path) return '';
	const normalized = normalizePath(path);
	const file = vault.getFileByPath(normalized);
	if (!file || file.extension !== 'md') {
		throw new TemplateError(`The configured template "${normalized}" is not an existing Markdown note.`);
	}
	return vault.cachedRead(file);
}
