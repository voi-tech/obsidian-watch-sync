# Watch Sync

Watch Sync is an Obsidian plugin for Obsidian 1.13.0+ that imports your Stremio or Nuvio library, watch history, and playback progress into movie and series notes. It previews every proposed change, preserves hand-written content by default, and never sends vault data back to the source service.

## Features

- Imports movie and series notes from a Stremio or a Nuvio account.
- Updates watched episode checkboxes and appends newly available seasons.
- Writes configurable Obsidian properties for release date, last watched date, runtime, poster, source link, and more.
- Uses customizable Handlebars templates, with built-in templates available out of the box.
- Matches existing notes conservatively and reports ambiguous matches as conflicts.
- Shows a selectable preview before the first sync and, by default, before every manual sync.
- Reads metadata from Cinemeta and optionally enriches it with TMDB.
- Keeps an optional managed block current without replacing the rest of a note.
- Runs on desktop and mobile.
- Stores no telemetry and performs no background sync unless you explicitly enable it.

## Requirements

- Obsidian 1.13.0 or later, on desktop or mobile.
- A Stremio account or a Nuvio account with an existing library.
- Optional: a TMDB API key for localized and richer metadata.

## Installation

### Community plugins

After Watch Sync is accepted into the Obsidian Community plugins directory:

1. Open **Settings → Community plugins**.
2. Select **Browse**, search for **Watch Sync**, and install it.
3. Enable **Watch Sync**.

Until then, use the manual installation method.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the matching GitHub Release.
2. Create `<vault>/.obsidian/plugins/watch-sync/`.
3. Copy all three files into that folder.
4. Reload Obsidian, then enable **Watch Sync** under **Community plugins**.

Do not download source archives as plugin releases. The three files above are the complete runtime package.

## Choose a sync source

Open **Settings → Watch Sync** and pick a source under **Sync source**. One source is active at a time, and the choice decides which account settings appear.

Then choose what to import:

| Scope | Imports |
|---|---|
| **Library** | Saved movies and series |
| **Watch history** | Titles marked watched |
| **Playback progress** | The latest unfinished playback position |

### Stremio

1. Next to **Stremio account**, select **Connect**.
2. Open the displayed HTTPS link and approve the pairing code while signed in to Stremio.
3. Return to Obsidian. The plugin stores the received key through Obsidian `SecretStorage`, which keeps values locally and scoped to the vault; your Stremio password never reaches the plugin.

If pairing fails, the dialog displays the network error and a **Try again** button.

### Nuvio

1. Next to **Nuvio account**, select **Connect**.
2. Open the Nuvio sign-in page and approve the request. Nothing has to be copied or typed back into Obsidian.
3. Return to Obsidian, then pick which **Nuvio profile** to import. Only that profile is read.

The session is stored through Obsidian `SecretStorage`; your Nuvio password never reaches the plugin. The backend address is configurable for self-hosted deployments and is discovered over HTTPS only.

Finally, select separate target folders for movie and series notes.

## Safe first sync

1. Run **Watch Sync: show library summary** to review how titles are classified.
2. Keep **Ask before writing** enabled.
3. Run **Watch Sync: sync now**.
4. Review the preview by title and target path. Uncheck any operation you do not want to apply.
5. Resolve conflicts before syncing again; conflicts are skipped and never guessed.

The first sync always shows a preview. Unselected operations return on a later run, and the sync watermark is not advanced past them.

## Matching existing notes

The plugin tries these match tiers in order:

1. the configured source-link property containing the same item id;
2. the plugin's local index;
3. an exact title or original-title alias;
4. a `Title (Year)` filename;
5. the same filename at the end of a prefixed name.

Two candidates at the same tier produce a conflict. Watch Sync does not rename or delete notes and does not choose an ambiguous match.

When an existing note is adopted for the first time, only missing managed properties are filled. Once the source-link property identifies the note, later syncs can update those managed properties.

## Properties

No property is written until you name it. Open **Template keys and properties** in settings and set a frontmatter key next to any template value you want stored; leave a field empty to keep that value out of frontmatter.

Commonly used values:

| Template key | Suggested property | Value |
|---|---|---|
| `released` | `released` | Premiere date in `YYYY-MM-DD` format |
| `watched` | `end` | Latest recorded playback date |
| `duration` | `duration` | Minutes; total episode runtime for a series |
| `cover` | `cover` | TMDB or Cinemeta poster URL |
| `link` | `source` | Source link and the strongest future match key |

Duplicate non-empty property names are rejected because two fields cannot safely own the same frontmatter key. Unrelated properties are not changed.

## Templates

Movie and series templates use Handlebars. Obsidian date placeholders such as `{{date:YYYY-MM-DD}}` are also supported, and both built-in templates work without configuration. The settings page lists every available key with an example value; select a key to copy it.

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
| **Keep the managed block up to date** | Also refreshes content between `%% watch-sync %%` and `%% /watch-sync %%` |
| **Rewrite from the template** | Replaces the complete body with freshly rendered template output |

Blocks written by earlier versions using the `%% stremio %%` markers are still recognized and updated in place.

Frontmatter is merged separately in every mode. Body edits use Obsidian's atomic file processing API. A rewrite is always shown as its own selectable preview operation.

## Watch status and scope

Neither source exposes a reliable title-level "really watched" flag for every case. Watch Sync therefore classifies items as watched, in progress, sampled, or unwatched. By default, briefly sampled titles are excluded.

- **Treat as sampled below** controls the playback duration treated as a sample.
- **Treat as watched above** can promote a nearly completed title; it never overrides the source's own watched result.
- **Include titles you never played** optionally includes untouched library entries.

For series, completion requires every already-aired episode to be watched. On Stremio, per-episode state comes from the watched bitfield; on Nuvio it comes from per-episode watch records.

## Commands

| Command | Effect |
|---|---|
| **Sync now** | Fetches, plans, and applies changes |
| **Preview changes (writes nothing)** | Opens the preview and never writes |
| **Show library summary** | Read-only classification report |
| **Clear the metadata cache** | Discards cached Cinemeta and TMDB responses |

## Limitations

- Automatic background sync is desktop-only. Mobile syncs manually.
- Do not run a sync simultaneously on a desktop and a mobile device against the same vault.
- One-way synchronization: source → Obsidian.
- No note deletion or renaming.
- No automatic resolution of ambiguous matches.
- No per-episode playback positions beyond the watch state each source exposes.
- Nuvio may not expose every repeat watch as a separate event.
- Neither account API is formally documented, and either may change.

## Privacy and local data

Watch Sync has no telemetry, analytics, advertising, or external plugin service.

Locally stored data:

- Account keys, Nuvio sessions, and TMDB keys are stored locally in vault-specific Obsidian `SecretStorage`.
- `data.json` stores non-secret settings, sync state, the match index, and a short local event log. Secret values are not serialized; only SecretStorage identifiers may be present.
- `cache.json` stores disposable metadata responses next to the plugin. A damaged or incompatible cache is discarded in full.
- Your movie and series notes remain ordinary Markdown files in your vault.

### Network requests

Requests are limited to the services needed for synchronization. Nothing is contacted for a source you have not connected.

| Host | Purpose |
|---|---|
| `https://api.strem.io/api` | Stremio library and watch state |
| `https://link.stremio.com/api`, approved HTTPS pages on `stremio.com` | Stremio account pairing |
| `https://api.nuvio.tv` (configurable) | Nuvio discovery (`/.well-known/nuvio`), sign-in (`/auth/v1/*`, `/functions/v1/tv-logins-exchange`), library and progress (`/rest/v1/rpc/*`) |
| `https://v3-cinemeta.strem.io/meta` | Fallback metadata |
| `https://api.themoviedb.org/3`, `https://image.tmdb.org` | Optional TMDB metadata and images |
| Stremio, Nuvio, IMDb, and TMDB web links | Opened only by an explicit user action |

The plugin never uploads note contents to these services.

## Upgrading to 26.8.6

Version 26.8.6 changes the plugin id from `stremio-sync` to `watch-sync`, so Obsidian treats it as a new plugin in a new folder. Settings and sync state are not carried over: install the new version, reconnect the account, and choose the target folders again. Your movie and series notes are ordinary Markdown files and are never deleted or renamed by this change. Managed blocks written with the old markers are still recognized.

If you installed an earlier version manually or through BRAT, remove `<vault>/.obsidian/plugins/stremio-sync/` after the new version works.

## Troubleshooting

### Synchronization is blocked

Open the plugin settings and check the displayed issue. Sync is intentionally blocked when no source is selected, no data type is selected for import, the account secret is missing, no Nuvio profile is chosen, a target folder does not exist, a selected template is missing, property names are duplicated, or the completion tag is invalid.

### Pairing fails

Select **Try again** in the dialog. For Stremio, confirm that the approval link uses HTTPS and belongs to `stremio.com`. For Nuvio, confirm that the backend address is reachable over HTTPS.

### A title is missing

Run **Show library summary**. The title may be classified as sampled or unwatched. Also inspect the preview's **Skipped**, **Conflicts**, and **Metadata warnings** sections.

### An existing note is not matched

Add its source web link to the configured source-link property. This is safer than relying on aliases or filenames.

### A template stopped working

Verify that the configured path still points to a Markdown note. Clear the field only if you want to return to the built-in template.

For reproducible bugs, open a [GitHub issue](https://github.com/voi-tech/obsidian-watch-sync/issues) and include the plugin version, Obsidian version, operating system, the exact error, and minimal redacted steps. Do not include auth keys, private note contents, or `data.json`.

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

`npm run check` runs ESLint, TypeScript, the test suite, a production build, a mobile-bundle compatibility scan, and release-asset validation. Production artifacts are `main.js`, `manifest.json`, and `styles.css`; source maps and runtime data are not committed.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution and release process.

## Credits and trademarks

<a href="https://www.themoviedb.org"><img src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_long_2-9665a76b1ae401a510ec1e0ca40ddcb3b0cfe45f1d51b77a308fea0845885648.svg" alt="The Movie Database (TMDB)" width="220"></a>

This product uses the TMDB API but is not endorsed or certified by TMDB.

Watch Sync is an independent community project. It is not affiliated with, endorsed by, or sponsored by Stremio, Nuvio, TMDB, Obsidian, or their respective owners. Stremio, Nuvio, TMDB, Obsidian, and related marks belong to their respective owners.

The plugin uses [pako](https://github.com/nodeca/pako) to decode Stremio episode-progress data and [Handlebars](https://handlebarsjs.com/) for note templates.

## License

[MIT](LICENSE)
