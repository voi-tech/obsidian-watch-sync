import { FuzzySuggestModal, TFile, TFolder, type App, type FuzzyMatch } from 'obsidian';

/**
 * Fuzzy pickers over the vault. Typing a path by hand still works in the
 * settings fields, but a plugin should not require the user to remember where
 * their own notes live.
 */

export class FolderPickerModal extends FuzzySuggestModal<TFolder> {
	constructor(
		app: App,
		private readonly onPick: (path: string) => void,
	) {
		super(app);
		this.setPlaceholder('Pick a folder…');
	}

	getItems(): TFolder[] {
		return this.app.vault
			.getAllLoadedFiles()
			.filter((file): file is TFolder => file instanceof TFolder)
			.sort((a, b) => a.path.localeCompare(b.path));
	}

	getItemText(folder: TFolder): string {
		// The vault root has an empty path and would otherwise be invisible.
		return folder.path || '/';
	}

	override renderSuggestion(match: FuzzyMatch<TFolder>, el: HTMLElement): void {
		const folder = match.item;
		const noteCount = folder.children.filter((child) => child instanceof TFile).length;
		el.createDiv({ text: folder.path || '/' });
		el.createDiv({
			text: `${noteCount} ${noteCount === 1 ? 'file' : 'files'}`,
			cls: 'stremio-sync-picker-meta',
		});
	}

	onChooseItem(folder: TFolder): void {
		this.onPick(folder.path);
	}
}

export class NotePickerModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly onPick: (path: string) => void,
	) {
		super(app);
		this.setPlaceholder('Pick a template note…');
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles().sort((a, b) => a.path.localeCompare(b.path));
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	override renderSuggestion(match: FuzzyMatch<TFile>, el: HTMLElement): void {
		const file = match.item;
		el.createDiv({ text: file.basename });
		el.createDiv({ text: file.parent?.path || '/', cls: 'stremio-sync-picker-meta' });
	}

	onChooseItem(file: TFile): void {
		this.onPick(file.path);
	}
}
