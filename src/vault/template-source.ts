import { normalizePath, type Vault } from 'obsidian';
import { TemplateError } from './template';
import { t } from '../i18n';

type TemplateVault = Pick<Vault, 'getFileByPath' | 'cachedRead'>;

/** Empty selects the built-in template; a configured path must remain valid. */
export async function readTemplateSource(vault: TemplateVault, path: string): Promise<string> {
	if (!path) return '';
	const normalized = normalizePath(path);
	const file = vault.getFileByPath(normalized);
	if (!file || file.extension !== 'md') {
		throw new TemplateError(t('template.invalid', { path: normalized }));
	}
	return vault.cachedRead(file);
}
