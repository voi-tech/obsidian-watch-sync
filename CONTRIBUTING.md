# Contributing

Thank you for helping improve Stremio Sync. Changes should preserve the plugin's core safety rule: ambiguous or invalid input must stop or skip an operation instead of risking hand-written note content.

## Before opening an issue

- Check existing issues and the troubleshooting section in `README.md`.
- Reproduce the problem with the latest release.
- Remove auth keys, personal titles, private note text, vault paths, `data.json`, and `cache.json`.

## Local development

Requirements:

- Node.js 20 or later;
- npm;
- Obsidian 1.13.0 or later for manual testing.

```bash
npm ci
npm run dev
```

For local Obsidian testing, place or symlink the repository at `<vault>/.obsidian/plugins/stremio-sync/`, then reload the plugin after each build.

## Required checks

Run the complete gate before opening a pull request:

```bash
npm run check
npm audit --omit=dev --audit-level=moderate
```

Add regression tests for behavior changes. Do not weaken content-preservation, matching, preview, configuration validation, or pairing tests to make a change pass.

## Pull requests

- Keep each pull request focused.
- Explain the user-visible behavior and safety implications.
- Update `README.md` and `CHANGELOG.md` when appropriate.
- Do not commit `main.js`, source maps, runtime data, secrets, or personal vault fixtures.
- Confirm that preview-only testing did not change movie or series notes.

## Release process

Maintainers should use the repository release process. In summary:

1. update the changelog and run all automated and desktop smoke checks;
2. confirm `package.json`, `manifest.json`, and `versions.json` agree;
3. create and push a tag exactly matching `manifest.json`;
4. review the generated draft GitHub Release;
5. publish only `main.js`, `manifest.json`, and `styles.css` as release assets.

The workflow creates a draft release only. Publishing and Community Plugins submission remain manual decisions. Version 26.8.1 does not migrate plugin data from 26.8.0; do not describe a clean install as a migration or include personal vault fixtures in a release.
