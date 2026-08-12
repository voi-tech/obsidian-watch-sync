import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	resolve: {
		alias: {
			obsidian: fileURLToPath(new URL('./tests/stubs/obsidian.ts', import.meta.url)),
		},
	},
	test: {
		// Node by default; the UI tests opt into jsdom with a docblock.
		environment: 'node',
		include: ['tests/**/*.test.ts'],
	},
});
