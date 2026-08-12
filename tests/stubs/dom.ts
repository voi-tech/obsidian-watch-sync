/**
 * Obsidian adds a handful of convenience methods to `HTMLElement` and expects
 * plugin code to use them. jsdom does not have them, so the UI tests install
 * them here — close enough to the real behaviour for the rendering the preview
 * modal does.
 */

interface DomElementInfo {
	cls?: string | string[];
	text?: string;
	type?: string;
	placeholder?: string;
	href?: string;
	attr?: Record<string, string>;
}

function applyInfo(el: HTMLElement, info?: DomElementInfo): void {
	if (!info) return;
	if (info.cls) el.className = Array.isArray(info.cls) ? info.cls.join(' ') : info.cls;
	if (info.text !== undefined) el.textContent = info.text;
	if (info.type) el.setAttribute('type', info.type);
	if (info.placeholder) el.setAttribute('placeholder', info.placeholder);
	if (info.href) el.setAttribute('href', info.href);
	for (const [key, value] of Object.entries(info.attr ?? {})) el.setAttribute(key, value);
}

export function installObsidianDom(): void {
	const proto = HTMLElement.prototype as HTMLElement & Record<string, unknown>;

	proto.createEl = function <K extends keyof HTMLElementTagNameMap>(
		this: HTMLElement,
		tag: K,
		info?: DomElementInfo,
	): HTMLElementTagNameMap[K] {
		const el = this.ownerDocument.createElement(tag);
		applyInfo(el, info);
		this.appendChild(el);
		return el;
	};

	proto.createDiv = function (this: HTMLElement, info?: DomElementInfo): HTMLDivElement {
		const el = this.ownerDocument.createElement('div');
		applyInfo(el, info);
		this.appendChild(el);
		return el;
	};

	proto.createSpan = function (this: HTMLElement, info?: DomElementInfo): HTMLSpanElement {
		const el = this.ownerDocument.createElement('span');
		applyInfo(el, info);
		this.appendChild(el);
		return el;
	};

	proto.setText = function (this: HTMLElement, text: string): void {
		this.textContent = text;
	};

	proto.addClass = function (this: HTMLElement, ...classes: string[]): void {
		this.classList.add(...classes);
	};

	proto.removeClass = function (this: HTMLElement, ...classes: string[]): void {
		this.classList.remove(...classes);
	};

	proto.toggleClass = function (this: HTMLElement, classes: string | string[], value: boolean): void {
		for (const name of Array.isArray(classes) ? classes : [classes]) this.classList.toggle(name, value);
	};

	proto.hasClass = function (this: HTMLElement, name: string): boolean {
		return this.classList.contains(name);
	};

	proto.empty = function (this: HTMLElement): void {
		while (this.firstChild) this.removeChild(this.firstChild);
	};
}
