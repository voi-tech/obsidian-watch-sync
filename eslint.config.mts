import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig(
	globalIgnores([
		"node_modules",
		"coverage",
		"dist",
		"esbuild.config.mjs",
		"scripts/*.mjs",
		"main.js",
		"package.json",
		"package-lock.json",
		"versions.json",
	]),
	{
		languageOptions: {
			globals: { ...globals.browser },
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.mts", "manifest.json", "vitest.config.ts"],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: [".json"],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		files: ["src/**/*.ts"],
		rules: {
			"obsidianmd/ui/sentence-case": [
				"warn",
				{
					brands: ["Stremio", "Stremio Sync", "Obsidian", "TMDB", "Cinemeta", "English"],
					acronyms: ["API", "IMDb"],
					enforceCamelCaseLower: true,
				},
			],
		},
	},
	{
		files: ["tests/**/*.ts"],
		rules: {
			"obsidianmd/no-global-this": "off",
			"obsidianmd/no-tfile-tfolder-cast": "off",
			"obsidianmd/prefer-create-el": "off",
			"obsidianmd/prefer-window-timers": "off",
		},
	},
);
