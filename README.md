# Stremio Sync

Stremio Sync is a desktop-only Obsidian plugin for Obsidian 1.13.0+ that imports your Stremio library and watch progress into movie and series notes. It previews every proposed change, preserves hand-written content by default, and never sends vault data back to Stremio.

## Features

- Creates movie and series notes from your Stremio library.
- Updates watched episode checkboxes and appends newly available seasons.
- Adds configurable Obsidian properties for release date, last watched date, runtime, poster, and Stremio link.
- Uses customizable Handlebars templates, with built-in templates available out of the box.
- Matches existing notes conservatively and reports ambiguous matches as conflicts.
- Shows a selectable preview before the first sync and, by default, before every manual sync.
- Reads metadata from Cinemeta and optionally enriches it with TMDB.
- Keeps an optional managed block current without replacing the rest of a note.
- Stores no telemetry and performs no background sync unless you explicitly enable it.

## Requirements

- Obsidian 1.13.0 or later.
- Desktop Obsidian. Mobile is not supported.
- A Stremio account with an existing library.
- Optional: a TMDB API key for localized and richer metadata.

## Installation

### Community plugins

After Stremio Sync is accepted into the Obsidian Community plugins directory:

1. Open **Settings → Community plugins**.
2. Select **Browse**, search for **Stremio Sync**, and install it.
3. Enable **Stremio Sync**.

Until then, use the manual installation method.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the matching GitHub Release.
2. Create `<vault>/.obsidian/plugins/stremio-sync/`.
3. Copy all three files into that folder.
4. Reload Obsidian, then enable **Stremio Sync** under **Community plugins**.

Do not download source archives as plugin releases. The three files above are the complete runtime package.

## Connect Stremio

1. Open **Settings → Stremio Sync**.
2. Under **Setup**, select **Connect**.
3. Open the displayed HTTPS link and approve the pairing code while signed in to Stremio.
4. Return to Obsidian. The plugin stores the received key through Obsidian `SecretStorage`, which keeps values locally and scoped to the vault; your Stremio password never reaches the plugin.
5. Select separate target folders for movie and series notes.

If pairing fails, the dialog displays the network error and a **Try again** button. You can also enter an existing Stremio auth key manually in the settings.

## Safe first sync

1. Run **Stremio Sync: show library summary** to review how titles are classified.
2. Keep **Ask before writing** enabled.
3. Run **Stremio Sync: sync now**.
4. Review the preview by title and target path. Uncheck any operation you do not want to apply.
5. Resolve conflicts before syncing again; conflicts are skipped and never guessed.

The first sync always shows a preview. Unselected operations return on a later run, and the sync watermark is not advanced past them.

## Matching existing notes

The plugin tries these match tiers in order:

1. the configured Stremio link property containing the same Stremio ID;
2. the plugin's local index;
3. an exact title or original-title alias;
4. a `Title (Year)` filename;
5. the same filename at the end of a prefixed name.

Two candidates at the same tier produce a conflict. Stremio Sync does not rename or delete notes and does not choose an ambiguous match.

When an existing note is adopted for the first time, only missing managed properties are filled. Once the Stremio link property identifies the note, later syncs can update those managed properties.

## Properties

Each property name is configurable. Clear a name to stop writing that property.

| Setting | Default | Value |
|---|---|---|
| Release date | `released` | Premiere date in `YYYY-MM-DD` format |
| Last watched | `end` | Last time Stremio recorded playback |
| Runtime | `duration` | Minutes; total episode runtime for a series |
| Poster | `cover` | TMDB or Cinemeta poster URL |
| Stremio link | `source` | Web link and the strongest future match key |

Duplicate non-empty property names are rejected because two fields cannot safely own the same frontmatter key. Unrelated properties are not changed.

## Templates

Movie and series templates use Handlebars. Obsidian date placeholders such as `{{date:YYYY-MM-DD}}` are also supported. The settings tab includes the complete field reference and both built-in templates.

Common examples:

```markdown
# {{title}}

{{#if cover}}![poster]({{cover}}){{/if}}

Genres: {{join genres " · "}}

{{> seasons}}
```

Leaving a template field empty deliberately selects the built-in template. If a configured template note is moved or deleted, synchronization stops with an error instead of silently changing the output format.

### Existing note body modes

| Mode | Behavior below frontmatter |
|---|---|
| **Leave alone** (default) | Updates episode checkboxes and appends missing seasons only |
| **Keep the managed block up to date** | Also refreshes content between `%% stremio %%` and `%% /stremio %%` |
| **Rewrite from the template** | Replaces the complete body with freshly rendered template output |

Frontmatter is merged separately in every mode. Body edits use Obsidian's atomic file processing API. A rewrite is always shown as its own selectable preview operation.

## Watch status and scope

Stremio does not expose a reliable title-level “really watched” flag for every case. Stremio Sync therefore classifies items as watched, in progress, sampled, or unwatched. By default, briefly sampled titles are excluded.

- **Sampled below** controls the playback duration treated as a sample.
- **Counts as watched above** can promote a nearly completed title; it never overrides Stremio's own watched result.
- **Include titles you never played** optionally includes untouched library entries.

For series, completion requires every already-aired episode to be watched. Per-episode state comes from Stremio's watched bitfield.

## Limitations

- Desktop only.
- One-way synchronization: Stremio → Obsidian.
- No note deletion or renaming.
- No automatic resolution of ambiguous matches.
- No per-episode playback positions beyond the watched state exposed by Stremio.
- Stremio's account API is not formally documented and may change.
- Background synchronization is optional and disabled by default.

## Privacy and local data

Stremio Sync has no telemetry, analytics, advertising, or external plugin service.

Locally stored data:

- Stremio and TMDB keys are stored locally in vault-specific Obsidian `SecretStorage`.
- `data.json` stores non-secret settings, sync state, the match index, and the last report. Secret values are not serialized; only SecretStorage identifiers may be present.
- `cache.json` stores disposable metadata responses next to the plugin. A damaged or incompatible cache is discarded in full.
- Your movie and series notes remain ordinary Markdown files in your vault.

Network requests are limited to the services needed for synchronization:

- `https://api.strem.io/api` — Stremio library and watch state;
- `https://link.stremio.com/api` and approved HTTPS pages on `stremio.com` — account pairing;
- `https://v3-cinemeta.strem.io/meta` — fallback metadata;
- `https://api.themoviedb.org/3` and `https://image.tmdb.org` — optional TMDB metadata and images;
- Stremio, IMDb, and TMDB web links opened by an explicit user action.

The plugin never uploads note contents to these services.

## Upgrade from 26.8.0

Version 26.8.1 intentionally starts with a new plugin-data contract. Settings, the local match index, the last report, the watermark, and the old cache from 26.8.0 are not migrated. Obsidian `SecretStorage` entries are not deleted, but the plugin no longer assumes old setting data is compatible, so reconnect the account if the new settings page does not show the existing secret reference. Movie and series notes are ordinary Markdown files and are never deleted or renamed by this reset.

## Troubleshooting

### Synchronization is blocked

Open the plugin settings and check the displayed issue. Sync is intentionally blocked when the Stremio secret is missing, a target folder does not exist, a selected template is missing, property names are duplicated, or the completion tag is invalid.

### Pairing fails

Select **Try again** in the pairing dialog. Confirm that the approval link uses HTTPS and belongs to `stremio.com`. If the problem persists, enter an existing auth key manually.

### A title is missing

Run **Show library summary**. The title may be classified as sampled or unwatched. Also inspect the preview's **Skipped**, **Conflicts**, and **Metadata warnings** sections.

### An existing note is not matched

Add its Stremio web link to the configured Stremio link property. This is safer than relying on aliases or filenames.

### A template stopped working

Verify that the configured path still points to a Markdown note. Clear the field only if you want to return to the built-in template.

For reproducible bugs, open a [GitHub issue](https://github.com/voi-tech/obsidian-stremio-sync/issues) and include the plugin version, Obsidian version, operating system, the exact error, and minimal redacted steps. Do not include auth keys, private note contents, or `data.json`.

Security issues should follow [SECURITY.md](SECURITY.md).

## Versioning

Releases use `YY.M.PATCH`, which remains valid SemVer:

- `YY` — two-digit year;
- `M` — month without a leading zero;
- `PATCH` — release number within that month, starting at `0`.

Example: `26.8.0` is the first August 2026 release. Compatibility history is recorded in `versions.json`.

## Development

Requires Node.js 20 or later.

```bash
npm install
npm run dev
npm run check
```

`npm run check` runs ESLint, TypeScript, the test suite, a production build, and release-asset validation. Production artifacts are `main.js`, `manifest.json`, and `styles.css`; source maps and runtime data are not committed.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution and release process.

## Credits and trademarks

<a href="https://www.themoviedb.org"><img src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_long_2-9665a76b1ae401a510ec1e0ca40ddcb3b0cfe45f1d51b77a308fea0845885648.svg" alt="The Movie Database (TMDB)" width="220"></a>

This product uses the TMDB API but is not endorsed or certified by TMDB.

Stremio Sync is an independent community project. It is not affiliated with, endorsed by, or sponsored by Stremio, TMDB, Obsidian, or their respective owners. Stremio, TMDB, Obsidian, and related marks belong to their respective owners.

The plugin uses [`stremio-watched-bitfield`](https://www.npmjs.com/package/stremio-watched-bitfield) to decode Stremio episode progress and [Handlebars](https://handlebarsjs.com/) for note templates.

## License

[MIT](LICENSE)
