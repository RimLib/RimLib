<p align="center">
  <img src="assets/rimlib-github-avatar.png" width="160" alt="RimLib logo">
</p>

<h1 align="center">RimLib</h1>

<p align="center">
  <strong>Your Workshop subscriptions are not your mod library.</strong><br>
  Keep the mods you care about, organize them your way, and install only what you need.
</p>

RimLib is a local-first desktop app for building a persistent, tagged library of RimWorld
Workshop mods. A mod remains in your library—with its metadata, notes, and personal tags—even
after you unsubscribe from it.

This lets you use Steam subscriptions as your **currently installed set**, rather than as the
only place where you remember every mod you may want later. Unsubscribe to let Steam reclaim
the Workshop files, then find and resubscribe to the mod from RimLib whenever you need it again.

> [!IMPORTANT]
> RimLib never writes RimWorld's enabled-mod configuration or silently deletes saved library
> records. Active mods are protected from unsubscribe actions.

## Why RimLib?

The Steam Workshop makes subscribing easy, but it ties three different concerns together:

- remembering a mod;
- organizing a mod;
- keeping the mod downloaded on disk.

RimLib separates them. Your personal catalog lives in RimLib, while Steam remains responsible
for downloading and removing Workshop content.

|                              | RimLib Library         | Workshop / Subscribed                        |
| ---------------------------- | ---------------------- | -------------------------------------------- |
| Saved for later              | Yes                    | Yes, once imported                           |
| Personal tags and notes      | Preserved              | Preserved                                    |
| Workshop files on this PC    | Not currently detected | Detected, or a confirmed download is pending |
| Subscribe again              | One staged action      | —                                            |
| Unsubscribe to reclaim space | —                      | One staged action; Active mods are protected |

Folder presence and Steam subscription state are related but not identical. See
[Workshop detection](#workshop-detection) for the exact behavior.

## Features

- **Persistent mod library** — keep a saved mod after unsubscribing without losing its title,
  description, preview, notes, tags, or dates.
- **Flexible personal tags** — create color-coded tags, assign any number of them, and rename,
  recolor, or remove them independently of Steam.
- **Fast organization** — search across title, author, description and tags or narrow the search to
  one field, sort by download date, and work with multi-selections.
- **Clear installed/not-installed workflow** — move between the Library and Workshop panels by
  staging subscribe or unsubscribe actions.
- **Safe bulk cleanup** — stage every saved, non-active Workshop mod for unsubscribe, review the
  exact list, and apply it only after RimLib rechecks Steam and RimWorld state.
- **Active-mod protection** — enabled mods follow RimWorld's load order and cannot be
  unsubscribed while active or when their status cannot be verified.
- **Dependency visibility** — read requirements from installed mods' `About.xml`, show them in Mod
  Info, and warn when an Active mod requires a package that is not enabled for the current
  RimWorld version.
- **Local Workshop discovery** — scan one configured `294100` folder or discover RimWorld across
  Steam libraries without treating the Workshop manifest as the source of truth.
- **Metadata refresh** — update public Workshop titles, descriptions, previews, and other public
  details without an API key or a downloaded copy of the mod.
- **Data protection** — serialized atomic saves, revision checks, a previous-version backup, and
  persistent checkpoints before destructive operations.
- **Offline organization** — edit tags, notes, and saved library records even when Steam is not
  running. Only subscription changes require Steam.

## Typical workflow

1. **Sync Workshop folders** to discover installed mods and import the ones you want to keep.
2. **Add your own tags and notes** so the collection reflects how you actually play.
3. **Stage unsubscribes** for mods you do not currently need. RimLib blocks Active mods and asks
   you to review the draft before changing Steam subscriptions.
4. After Steam removes the local Workshop files, the saved records remain in the **Library**
   panel with all personal data intact.
5. **Subscribe again later** directly from the Library panel, then let Steam download the files.

Drafts are session-only. Tag and note edits are saved immediately, while Steam changes remain a
reviewable intention until you explicitly apply them. If an operation partially fails, confirmed
changes are retained and unresolved items stay available for retry.

## Safety by design

RimLib treats installed files, Steam subscriptions, and RimWorld's enabled-mod list as separate
observations. It rechecks the relevant source before performing a destructive action instead of
trusting cached metadata.

- It does **not** write `ModsConfig.xml`, enable or disable mods, or change load order.
- It does **not** remove an Active mod from Steam.
- It blocks unsubscribe actions if Active state or installed identity cannot be verified.
- It does **not** delete a library record merely because a mod disappears from disk.
- Removing a saved record is separate from unsubscribing and requires confirmation.
- Subscribed records cannot be removed from the library.
- Synchronization enriches and updates records; it never deletes omitted records.
- Failed saves and incomplete scans preserve the current displayed library.

## Getting started

RimLib is currently run from source. Packaged installers are not part of the repository yet.

### Requirements

- [Node.js](https://nodejs.org/) 24.21 or newer in the Node 24 release line
- npm 11
- macOS 13 (Ventura) or newer, Windows 10 or newer, or a maintained Linux distribution
- RimWorld installed through Steam
- Steam running and signed in for subscribe/unsubscribe actions

### Run the desktop app

```bash
nvm use
npm ci
npm run dev
```

The app discovers Workshop content automatically where possible. If your Steam library is in a
nonstandard location, open **Settings > Workshop mods folder (294100)** and select the directory.

### Renderer-only development

```bash
npm run dev:renderer
```

The browser preview uses separate browser storage. It cannot scan local Workshop folders, read
RimWorld's configuration, or perform Steam actions.

## Workshop detection

RimLib follows Steam's `libraryfolders.vdf` and scans numeric directories under:

```text
steamapps/workshop/content/294100/
```

You can instead configure one explicit `294100` directory in Settings. The override is used for
both synchronization and Active-mod identity lookup. An inaccessible override blocks the scan
and preserves existing status; an accessible but empty folder is a valid empty result.

The Workshop manifest is not treated as proof of subscription. A folder may remain after an
external unsubscribe, and a newly subscribed mod may not have downloaded yet. RimLib therefore
shows folder-derived panel membership, while actual subscribe/unsubscribe actions use Steam's
native subscription state. Confirmed in-app actions take precedence until the folders catch up.

**Sync Workshop folders** saves detected presence first, imports installed metadata, refreshes
available public details, and scans again to catch files that changed during a long sync. Local
metadata comes from each mod's `About/About.xml`; a metadata-network failure does not prevent the
local import.

## Active mods

RimLib reads RimWorld's saved enabled-mod configuration from the platform default:

- **macOS:** `~/Library/Application Support/RimWorld/Config/ModsConfig.xml`
- **Windows:** `%USERPROFILE%/AppData/LocalLow/Ludeon Studios/RimWorld by Ludeon Studios/Config/ModsConfig.xml`
- **Linux:** `~/.config/unity3d/Ludeon Studios/RimWorld by Ludeon Studios/Config/ModsConfig.xml`

Choose a different file in Settings when using custom profiles, Proton, or a nonstandard
installation. An unreadable configuration is treated as **unavailable**, not as an empty enabled
list, so unsafe unsubscribe actions remain blocked.

The configuration describes the game's saved enabled list, not the mods used by a particular
save file.

## Optional Firebase sync

RimLib stays local-only unless you enable **Settings > Firebase sync (beta)**. The optional sync
uses your own Firebase project and synchronizes portable mod metadata, notes, and personal tags.
Local paths, downloaded file sizes, Steam subscription state, app settings, and transient UI state
never go to Firestore. The local vault remains the working copy and continues to work offline.

To configure it:

1. Create a Firebase project, register a Web app, and copy its Project ID, Web API key, Auth
   domain, and App ID.
2. Enable the Email/Password provider under Firebase Authentication and create a user for
   yourself.
3. Create a Firestore database and publish rules that isolate each signed-in user's records:

   ```text
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{userId}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
       }
     }
   }
   ```

4. Enter the Web app values and user email in RimLib Settings, then choose **Save and sync**.

RimLib accepts only public Web app configuration; never provide a service-account JSON file or
private key. The password is sent to Firebase Authentication and is not saved in the RimLib vault
or logs. Firebase keeps the signed-in browser session on the device. A first device uploads to an
empty cloud, and a new empty device downloads from it. Simultaneous changes stop with a conflict
instead of silently overwriting either copy. Cloud deletions are tombstoned, and subscribed mods
retain the same deletion protection as local actions.

## Data and recovery

RimLib stores the library locally by default. The database contains saved mods, personal tags,
notes, settings, and this device's latest Steam observation. Temporary UI selection is not stored.
On macOS, the default vault location is:

```text
~/Library/Application Support/RimLib/mod-vault.json
```

On Windows it is `%APPDATA%/RimLib/mod-vault.json`, and on Linux it is
`~/.config/RimLib/mod-vault.json`. Explicit Electron data/session path overrides are preserved.
The browser preview uses the separate `rimlib:vault` and `rimlib:vault:backup` storage keys.
The app does not discover or migrate data from other locations or storage namespaces.

Database writes are serialized and atomic. RimLib keeps an adjacent `.bak` file and creates
persistent checkpoints in `backups/` before synchronization, subscription changes, and explicit
deletions. A corrupt main file is retained and recovered from its backup when possible. Unsupported
schema versions block editing rather than risking existing data.

Schema v3 stores portable records once under `library` and keeps machine-specific Workshop state
under `deviceState.steam`. A mod's `subscribed` flag is derived at runtime from `observedIds` plus
explicit pending `subscribe` or `unsubscribe` actions; it is not duplicated in each stored mod.

The app intentionally does not read v2 vaults. Migrate one before opening it with this version:

```bash
nvm use
npm run migrate:vault:v3 -- "/absolute/path/to/mod-vault.json"
```

The command validates a v2 vault, creates an exclusive `.v2-backup-…json` copy beside it, and
atomically replaces the original with v3. To keep the source untouched, pass
`--output "/absolute/path/to/mod-vault-v3.json"`.

Use **Settings > Open database folder** to open the actual vault location. Backups are not pruned
automatically, so an independent backup of the data directory is still recommended.

## Diagnostics

Every desktop launch creates a structured JSON-lines log. Use **Settings > Open logs** to find it.
Default locations are:

- **macOS:** `~/Library/Logs/RimLib/`
- **Windows:** `%APPDATA%/RimLib/logs/`
- **Linux:** `~/.config/RimLib/logs/`

Logs include startup information, scan results, IPC timing, persistence/recovery events, Steam
operations, renderer exceptions, and crash details. Credentials, account identifiers,
home-directory prefixes, notes, descriptions, raw vault objects, and environment dumps are
redacted or excluded. No logs are uploaded automatically; review them before sharing.

Logs rotate at 5 MiB and retain the newest 20 sessions for up to 14 days. Database files and
backups are never included in log retention.

## Development

RimLib uses Electron, React, TypeScript, Vite, Zustand, Tailwind CSS, daisyUI, and steamworks.js.
The renderer is isolated behind a validated preload bridge; filesystem, Steam, logging, and other
privileged operations remain in the Electron main process.

| Command                   | Purpose                                                       |
| ------------------------- | ------------------------------------------------------------- |
| `npm run dev`             | Run the Electron app in development mode                      |
| `npm run dev:renderer`    | Run the browser-only renderer preview                         |
| `npm run build`           | Type-check and create a production build                      |
| `npm test`                | Run unit and property-based tests                             |
| `npm run test:properties` | Run only generated invariant tests                            |
| `npm run test:e2e`        | Run isolated Playwright tests against the real Electron UI    |
| `npm run quality`         | Run the complete formatting, lint, type, test, and build gate |

The test suite uses temporary databases and fake Steam clients. It never touches the user's real
subscriptions, Workshop directories, or RimWorld configuration.

On headless Linux, run the Electron suite with a virtual display:

```bash
xvfb-run --auto-servernum npm run test:e2e
```

## Project documentation

- [Contributing](CONTRIBUTING.md) — toolchain, required checks, commit hooks, and change policy
- [Architecture](ARCHITECTURE.md) — process boundaries, state ownership, persistence, and safety
- [Testing](TESTING.md) — suite scope, generated invariants, run budgets, and failure replay

## Contributing

Contributions are welcome. Start by reading [CONTRIBUTING.md](CONTRIBUTING.md), keep changes
focused, and include regression coverage for behavioral fixes—especially anything involving
persistence, subscriptions, IPC, or Active-mod protection.

Before opening a pull request:

```bash
npm run format
npm run lint:fix
npm run quality
```

GitHub Actions runs the same quality gate on Linux, macOS, and Windows.

## Current scope

RimLib reports declared dependencies but does not automatically subscribe to, enable, or sort them.
It also does not provide automatic game sorting, save-specific mod lists, SteamCMD downloads, or
editing of RimWorld's enabled configuration. Its focus is a safe, persistent personal library and
clear movement between mods you keep installed and mods you keep for later.

## License

RimLib is available under the [MIT License](LICENSE).
