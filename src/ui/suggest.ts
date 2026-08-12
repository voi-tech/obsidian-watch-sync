import { AbstractInputSuggest, TFile, TFolder, type App } from 'obsidian';

const LIMIT = 50;

export class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(
		app: App,
		private readonly inputEl: HTMLInputElement,
		private readonly onPick: (path: string) => void,
	) {
		super(app, inputEl);
	}

	getSuggestions(query: string): TFolder[] {
		const lower = query.toLowerCase();
		return this.app.vault
			.getAllLoadedFiles()
			.filter((file): file is TFolder => file instanceof TFolder)
			.filter((folder) => folder.path.toLowerCase().includes(lower))
			.slice(0, LIMIT);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path || '/');
	}

	override selectSuggestion(folder: TFolder): void {
		this.inputEl.value = folder.path;
		this.onPick(folder.path);
		this.close();
	}
}

/** Same idea for template notes: any Markdown file in the vault. */
export class NoteSuggest extends AbstractInputSuggest<TFile> {
	constructor(
		app: App,
		private readonly inputEl: HTMLInputElement,
		private readonly onPick: (path: string) => void,
	) {
		super(app, inputEl);
	}

	getSuggestions(query: string): TFile[] {
		const lower = query.toLowerCase();
		return this.app.vault
			.getMarkdownFiles()
			.filter((file) => file.path.toLowerCase().includes(lower))
			.slice(0, LIMIT);
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.setText(file.path);
	}

	override selectSuggestion(file: TFile): void {
		this.inputEl.value = file.path;
		this.onPick(file.path);
		this.close();
	}
}
