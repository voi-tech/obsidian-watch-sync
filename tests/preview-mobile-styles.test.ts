import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

describe('mobile preview styles', () => {
	it('keeps expanded problem sections reachable by scrolling the modal content', () => {
		const modalContentRules =
			styles.match(/\.watch-sync-preview \.modal-content \{([^}]*)\}/)?.[1] ?? '';
		expect(modalContentRules).toContain('overflow-y: auto;');
	});

	it('does not apply touch-target sizing to native checkboxes', () => {
		const mobileRules = styles.match(/@media \(max-width: 600px\) \{([\s\S]*)\n\}/)?.[1] ?? '';
		expect(mobileRules).not.toMatch(/\.watch-sync-preview input,/);
	});
});
