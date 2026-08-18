# Changelog

All notable changes to Stremio Sync are documented here. Releases use the `YY.M.PATCH` version format, which is compatible with Semantic Versioning.

## [Unreleased]

## [26.8.4] — 2026-08-18

### Added

- Experimental mobile beta for iOS and Android, installable through BRAT; use a test vault or current backup.
- Mobile bundle guard that rejects Node, Electron, Buffer, and the previous desktop-oriented bitfield dependency.

### Changed

- Replace the watched-bitfield dependency with a browser-safe decoder.
- Disable automatic synchronization on mobile; manual synchronization remains available.
- Make pairing resume after returning from the browser and make preview controls touch-friendly.

## [26.8.3] — 2026-08-07

### Fixed

- Improve the settings layout for Obsidian 1.13+ Desktop so long controls, paths, code blocks, and actions stay within the available width.
- Fix template-reference filtering so non-matching entries and empty groups are hidden.

## [26.8.2] — 2026-08-07

### Fixed

- Render the template reference in a full-width vertical container instead of a horizontal settings row.
- Add a visible **Restore defaults** button to the reset section.

## [26.8.1] — 2026-08-07

### Changed

- Require Obsidian 1.13.0 or later and use its declarative settings API.
- Start with a clean plugin data contract; settings and sync state from 26.8.0 are not migrated.
- Defer cache loading and background synchronization until Obsidian is ready.
- Clarify that SecretStorage is local and vault-specific, and document network, privacy, and release boundaries.

### Fixed

- Remove legacy settings migration paths that no longer belong to the clean-start release.

## [26.8.0] — 2026-08-02

### Added

- Initial public release.
- One-way Stremio library and watch-progress synchronization for movie and series notes.
- Selectable previews, conservative note matching, conflict reporting, and atomic note edits.
- Configurable properties, Handlebars templates, managed blocks, and existing-body modes.
- Optional TMDB metadata with Cinemeta fallback.
- Runtime validation and migration for settings, sync state, and metadata cache.
- Secure Stremio pairing with retry and approved-link validation.
- Automated lint, typecheck, tests, production build, release-asset checks, and draft-release workflow.

[Unreleased]: https://github.com/voi-tech/obsidian-stremio-sync/compare/26.8.4...HEAD
[26.8.4]: https://github.com/voi-tech/obsidian-stremio-sync/releases/tag/26.8.4
[26.8.3]: https://github.com/voi-tech/obsidian-stremio-sync/releases/tag/26.8.3
[26.8.2]: https://github.com/voi-tech/obsidian-stremio-sync/releases/tag/26.8.2
[26.8.1]: https://github.com/voi-tech/obsidian-stremio-sync/releases/tag/26.8.1
[26.8.0]: https://github.com/voi-tech/obsidian-stremio-sync/releases/tag/26.8.0
