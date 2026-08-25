# Changelog

All notable changes to Watch Sync are documented here. Releases use the `YY.M.PATCH` version format, which is compatible with Semantic Versioning.

## [Unreleased]

## [26.8.6] — 2026-08-25

### Added

- Nuvio as a second sync source, with TV sign-in, profile selection, and a configurable backend address.
- Selectable import scopes, so library, watch history, and playback progress can be imported independently.
- A release check that rejects a build whose manifest identity has drifted, and a test that rejects a translation key with no definition.

### Changed

- Renamed the plugin to **Watch Sync**; it is no longer tied to a single service.
- Changed the plugin id to `watch-sync`. Obsidian treats this as a new plugin: reinstall, reconnect the account, and choose the target folders again.
- Renamed the managed block markers to `%% watch-sync %%`. Blocks using the previous markers are still recognized and updated in place.
- Renamed every CSS class to the `watch-sync-` prefix. Custom snippets targeting the previous prefix need updating.
- Properties are now opt-in: name a frontmatter key under **Template keys and properties** for each value you want written.
- The shipped series file name pattern now uses `{{years}}`, which collapses a redundant `(2025-2025)` to `(2025)`. The previous `{{yearStart}}`/`{{yearEnd}}` keys still resolve in custom patterns and templates.
- Mobile is a supported platform rather than a beta. Automatic background sync remains desktop-only.
- Documented every external host and endpoint the plugin contacts.

### Fixed

- **Restore defaults** no longer disconnects a Nuvio account. The dialog promised to keep connected accounts, but only the Stremio and TMDB references survived.
- A Nuvio note is found again by its own source link. The link was written with a namespaced id but read back without one, so the certain match tier never fired; on a vault without the local index — a reinstall, or a second device — the sync created a duplicate note instead of updating the existing one.
- The template reference no longer documents `{{pad lastEpisode.number}}`, which resolved to nothing, and it now shows the current managed-block markers instead of the previous ones.
- **Show library summary** now reads the selected source. It always demanded a Stremio key, so it failed outright while Nuvio was the active source.

### Removed

- The Polish interface. The plugin ships in English only; the metadata language setting is unaffected.

## [26.8.5] — 2026-08-20

### Fixed

- Allow the preview modal to scroll to expanded conflict, skipped, and metadata-warning sections on mobile.
- Preserve Obsidian's native checkbox sizing and shape in the mobile preview list.

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

[Unreleased]: https://github.com/voi-tech/obsidian-watch-sync/compare/26.8.6...HEAD
[26.8.6]: https://github.com/voi-tech/obsidian-watch-sync/releases/tag/26.8.6
[26.8.5]: https://github.com/voi-tech/obsidian-watch-sync/releases/tag/26.8.5
[26.8.4]: https://github.com/voi-tech/obsidian-watch-sync/releases/tag/26.8.4
[26.8.3]: https://github.com/voi-tech/obsidian-watch-sync/releases/tag/26.8.3
[26.8.2]: https://github.com/voi-tech/obsidian-watch-sync/releases/tag/26.8.2
[26.8.1]: https://github.com/voi-tech/obsidian-watch-sync/releases/tag/26.8.1
[26.8.0]: https://github.com/voi-tech/obsidian-watch-sync/releases/tag/26.8.0
