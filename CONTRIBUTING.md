# Contributing

Thank you for helping improve Watch Sync. Changes should preserve the plugin's core safety rule: ambiguous or invalid input must stop or skip an operation instead of risking hand-written note content.

## Before opening an issue

- Check existing issues and the troubleshooting section in `README.md`.
- Reproduce the problem with the latest release.
- Remove auth keys, sessions, personal titles, private note text, vault paths, `data.json`, and `cache.json`.

## Local development

Requirements:

- Node.js 20 or later;
- npm;
- Obsidian 1.13.0 or later for manual testing.

```bash
npm ci
npm run dev
```

For local Obsidian testing, place or symlink the repository at `<vault>/.obsidian/plugins/watch-sync/`, then reload the plugin after each build.

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

Versions follow `YY.M.PATCH`, which stays valid SemVer: two-digit year, month without a leading zero, patch from `0`.

### 1. Repository readiness

- [ ] Review the complete diff and remove unrelated files.
- [ ] Confirm `data.json`, `cache.json`, `main.js`, `main.js.map`, secrets, personal paths, and private titles are not committed.
- [ ] Confirm `manifest.json` carries the new version, the correct `minAppVersion`, and `isDesktopOnly: false`.
- [ ] Confirm `package.json` matches that version and `versions.json` maps it to the same `minAppVersion`.
- [ ] Move the changelog entries out of **Unreleased** into the new version, with its date and compare links.
- [ ] Review `README.md`, `LICENSE`, `SECURITY.md`, and this file.
- [ ] Confirm the README still carries TMDB's approved logo and attribution.

### 2. Automated gate

```bash
npm ci
npm run check
npm audit --omit=dev --audit-level=moderate
```

- [ ] ESLint completes with no errors and no warnings.
- [ ] The typecheck and the full test suite pass.
- [ ] The production build succeeds and the mobile-bundle scan finds no desktop-only dependency.
- [ ] `scripts/check-release.mjs` finds non-empty `main.js`, `manifest.json`, and `styles.css`, agreeing versions, the expected plugin identity, and no `main.js.map`.
- [ ] The production dependency audit reports nothing at moderate or higher.
- [ ] GitHub Actions passes on Node.js 20, 22, and 24.

### 3. Manual smoke test

- [ ] Back up the movie and series folders, or record aggregate checksums.
- [ ] Load the production build in a desktop vault and confirm there are no console errors.
- [ ] Check the settings page: source, account status, folders, templates, property names, and the template reference.
- [ ] Run **Show library summary** and sanity-check the counts.
- [ ] Run a preview with **Ask before writing** enabled, inspect every section, and close it without applying.
- [ ] Confirm the note checksums are identical before and after that preview.
- [ ] Apply a small selection and verify the result in Reading view.
- [ ] Repeat the connect → preview → apply path for the other sync source.
- [ ] Load the same build on iOS or Android and confirm the preview scrolls, the controls are usable, and automatic sync is unavailable.

### 4. Publish

- [ ] On the clean default branch, create the exact tag, for example `git tag 26.8.6`.
- [ ] Push it: `git push origin 26.8.6`.
- [ ] The tag workflow builds, attests, and publishes the GitHub Release with exactly `main.js`, `manifest.json`, and `styles.css`. A tag carrying a prerelease suffix publishes as a prerelease instead.
- [ ] Confirm the public release URL works without authentication.

Never replace the assets of an already published release; ship a new patch instead.

### 5. Community directory submission

- [ ] Fork `obsidianmd/obsidian-releases`.
- [ ] Add `watch-sync` to `community-plugins.json` with the canonical repository, author, and description.
- [ ] Open the submission pull request using Obsidian's current template and complete the official review checklist.
- [ ] Answer review feedback with a new patch release when code or manifest changes are needed.
- [ ] After acceptance, update the installation wording in `README.md`, which still describes directory availability as pending.
