import { Notice } from 'obsidian';
import { BUILTIN_MOVIE_TEMPLATE, BUILTIN_SERIES_TEMPLATE } from '../vault/template';
import { TEMPLATE_FIELD_GROUPS, TEMPLATE_SNIPPETS } from '../vault/template-reference';

/**
 * The collapsed template documentation shown in settings.
 *
 * Each entry leads with what you type and what it turns into — `{{title}} →
 * Severance` — because that pairing is the whole question someone has when they
 * open this list. The prose sits underneath, quieter. A filter box is here
 * because three dozen fields is more than anyone wants to read through.
 */
export function renderTemplateReference(containerEl: HTMLElement): void {
	const fieldCount = TEMPLATE_FIELD_GROUPS.reduce((sum, group) => sum + group.fields.length, 0);

	const fields = details(containerEl, `Template fields (${fieldCount})`);
	fields.createEl('p', {
		text: 'Write a field in double braces. One with no value renders as nothing.',
		cls: 'stremio-sync-note',
	});

	const search = fields.createEl('input', {
		type: 'search',
		placeholder: 'Filter fields…',
		cls: 'stremio-sync-ref-search',
	});

	const groups = TEMPLATE_FIELD_GROUPS.map((group) => {
		const groupEl = fields.createDiv({ cls: 'stremio-sync-ref-group' });
		groupEl.createEl('h5', { text: group.title, cls: 'stremio-sync-ref-heading' });
		return {
			el: groupEl,
			entries: group.fields.map((field) => ({
				el: renderEntry(groupEl, `{{${field.name}}}`, field.example, field.description),
				haystack: `${field.name} ${field.description} ${field.example ?? ''}`.toLowerCase(),
			})),
		};
	});

	search.addEventListener('input', () => {
		const query = search.value.trim().toLowerCase();
		for (const group of groups) {
			let visible = 0;
			for (const entry of group.entries) {
				const show = !query || entry.haystack.includes(query);
				entry.el.hidden = !show;
				if (show) visible += 1;
			}
			group.el.hidden = visible === 0;
		}
	});

	const helpers = details(containerEl, `Helpers and blocks (${TEMPLATE_SNIPPETS.length})`);
	for (const snippet of TEMPLATE_SNIPPETS) {
		renderEntry(helpers, snippet.syntax, undefined, snippet.description);
	}

	renderBuiltinTemplate(containerEl, 'Built-in movie template', BUILTIN_MOVIE_TEMPLATE);
	renderBuiltinTemplate(containerEl, 'Built-in series template', BUILTIN_SERIES_TEMPLATE);
}

/** `{{field}} → example` on top, the explanation underneath. */
function renderEntry(
	containerEl: HTMLElement,
	syntax: string,
	example: string | undefined,
	description: string,
): HTMLElement {
	const entry = containerEl.createDiv({ cls: 'stremio-sync-ref-entry' });

	const line = entry.createDiv({ cls: 'stremio-sync-ref-syntax' });
	line.createEl('code', { text: syntax });
	if (example) {
		line.createSpan({ text: '→', cls: 'stremio-sync-ref-arrow' });
		line.createEl('code', { text: example, cls: 'stremio-sync-ref-example' });
	}

	entry.createDiv({ text: description, cls: 'stremio-sync-ref-desc' });
	return entry;
}

function renderBuiltinTemplate(containerEl: HTMLElement, title: string, template: string): void {
	const body = details(containerEl, title);
	body.createEl('p', {
		text: 'Used when no template file is set above. Copy it as a starting point for your own.',
		cls: 'stremio-sync-note',
	});

	const wrapper = body.createDiv({ cls: 'stremio-sync-codeblock' });
	wrapper.createEl('pre').createEl('code', { text: template });
	const actions = wrapper.createDiv({ cls: 'stremio-sync-codeblock-actions' });
	const button = actions.createEl('button', { text: 'Copy the template' });
	button.addEventListener('click', () => void copyToClipboard(template, button));
}

async function copyToClipboard(text: string, button: HTMLButtonElement): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
		const original = button.textContent;
		button.textContent = 'Copied';
		window.setTimeout(() => {
			button.textContent = original;
		}, 1500);
	} catch {
		new Notice('Stremio Sync: could not reach the clipboard.');
	}
}

function details(containerEl: HTMLElement, summary: string): HTMLElement {
	const element = containerEl.createEl('details', { cls: 'stremio-sync-details' });
	element.createEl('summary', { text: summary });
	return element.createDiv({ cls: 'stremio-sync-details-body' });
}
