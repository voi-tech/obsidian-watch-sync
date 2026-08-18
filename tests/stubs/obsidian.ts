/**
 * The published `obsidian` package is types-only, so Vitest gets this stub in its
 * place. Only the surface the tested modules actually touch is implemented.
 */
import { vi } from 'vitest';

export interface RequestUrlParam {
	url: string;
	method?: string;
	contentType?: string;
	body?: string;
	headers?: Record<string, string>;
	throw?: boolean;
}

export interface RequestUrlResponse {
	status: number;
	json: unknown;
	text: string;
}

export const requestUrl = vi.fn<(param: RequestUrlParam) => Promise<RequestUrlResponse>>();

let currentLanguage = 'en';

export function getLanguage(): string {
	return currentLanguage;
}

export function __setLanguage(language: string): void {
	currentLanguage = language;
}

export const Platform = {
	isMobileApp: false,
};

export function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/(^\/|\/$)/g, '');
}

export class Notice {
	constructor(readonly message: string) {}
}

export class TFile {
	constructor(
		public path: string,
		public basename: string,
		public extension = 'md',
	) {}
}

export class TFolder {
	children: unknown[] = [];
	constructor(public path: string) {}
}

export class Plugin {
	registeredIntervals: number[] = [];

	registerInterval(id: number): number {
		this.registeredIntervals.push(id);
		return id;
	}
}
export class PluginSettingTab {}
export class SecretComponent {}
export class AbstractInputSuggest {}

/**
 * Enough of `Modal` and `Setting` for the preview modal to render into jsdom.
 * Only what the plugin touches is implemented.
 */
export class Modal {
	containerEl: HTMLElement;
	modalEl: HTMLElement;
	titleEl: HTMLElement;
	contentEl: HTMLElement;
	title = '';

	constructor(readonly app: unknown) {
		const doc = window.document;
		this.containerEl = doc.createElement('div');
		this.modalEl = doc.createElement('div');
		this.titleEl = doc.createElement('div');
		this.contentEl = doc.createElement('div');
		this.modalEl.append(this.titleEl, this.contentEl);
		this.containerEl.append(this.modalEl);
		doc.body.append(this.containerEl);
	}

	setTitle(title: string): this {
		this.title = title;
		this.titleEl.textContent = title;
		return this;
	}

	open(): void {
		this.onOpen();
	}

	close(): void {
		this.onClose();
	}

	onOpen(): void {}
	onClose(): void {}
}

export class FuzzySuggestModal<T> extends Modal {
	setPlaceholder(): this {
		return this;
	}

	getItems(): T[] {
		return [];
	}
}

export class ButtonComponent {
	buttonEl: HTMLButtonElement;
	disabled = false;

	constructor(containerEl: HTMLElement) {
		this.buttonEl = window.document.createElement('button');
		containerEl.append(this.buttonEl);
	}

	setButtonText(text: string): this {
		this.buttonEl.textContent = text;
		return this;
	}

	setCta(): this {
		this.buttonEl.classList.add('mod-cta');
		return this;
	}

	setDisabled(disabled: boolean): this {
		this.disabled = disabled;
		this.buttonEl.disabled = disabled;
		return this;
	}

	onClick(handler: () => void): this {
		this.buttonEl.addEventListener('click', handler);
		return this;
	}
}

export class Setting {
	settingEl: HTMLElement;
	controlEl: HTMLElement;
	descEl: HTMLElement;
	components: unknown[] = [];

	constructor(containerEl: HTMLElement) {
		const doc = window.document;
		this.settingEl = doc.createElement('div');
		this.settingEl.className = 'setting-item';
		this.descEl = doc.createElement('div');
		this.descEl.className = 'setting-item-description';
		this.controlEl = doc.createElement('div');
		this.controlEl.className = 'setting-item-control';
		this.settingEl.append(this.descEl, this.controlEl);
		containerEl.append(this.settingEl);
	}

	setName(name: string): this {
		this.settingEl.setAttribute('data-name', name);
		return this;
	}

	setDesc(desc: string): this {
		this.descEl.textContent = desc;
		return this;
	}

	setClass(cls: string): this {
		this.settingEl.classList.add(cls);
		return this;
	}

	addButton(cb: (button: ButtonComponent) => unknown): this {
		const button = new ButtonComponent(this.controlEl);
		this.components.push(button);
		cb(button);
		return this;
	}
}
