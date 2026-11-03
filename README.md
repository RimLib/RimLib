<p align="center">
  <img src="assets/rimlib-github-avatar.png" width="160" alt="RimLib logo">
</p>

<h1 align="center">RimLib</h1>

<p align="center">
  <strong>Build a safe, understandable RimWorld load order.</strong><br>
  Keep the mods you care about, choose what is active, and install only what you need.
</p>

RimLib is a local-first desktop app for building a persistent, tagged library of RimWorld
Workshop mods and managing the game's active mod list. The center panel contains known inactive
mods whether or not they are subscribed, while the right panel mirrors the active order in
`ModsConfig.xml`, including RimWorld Core and active DLC.

Subscription, library membership and active state are deliberately independent. A mod remains in
your library—with its metadata, notes and personal tags—after you unsubscribe from it, and a
subscribed mod is not automatically enabled. RimLib stages subscription, activation and load-order
changes together so you can review their combined effect before anything external is changed.

> [!IMPORTANT]
> Double-clicking, manually reordering or auto-sorting only changes the current draft. RimLib writes
> the active list and contacts Steam only after you review and apply that draft. Core cannot be
> deactivated, and saved library records are never silently deleted. Steam availability and
> Workshop-folder metadata do not disable unsubscribe, removal, or inactive-cleanup controls while
> drafting; Apply performs the authoritative checks and keeps unresolved intentions pending when a
> check fails.

## Why RimLib?

RimLib separates three concepts that are easy to confuse:

- **Library** means RimLib remembers and organizes a mod.
- **Subscribed** means Steam owns its Workshop subscription and download.
- **Active** means its package ID is in RimWorld's ordered `ModsConfig.xml` list.

| Concern                    | Source of truth             | How RimLib changes it                  |
| -------------------------- | --------------------------- | -------------------------------------- |
| Saved metadata, tags/notes | RimLib's local vault        | Library actions and immediate edits    |
| Workshop subscription      | Steam                       | Subscribe/unsubscribe draft actions    |
| Active membership/order    | RimWorld's `ModsConfig.xml` | Activate/deactivate/sort draft actions |

Folder presence and Steam subscription state are related but not identical. See
[Workshop detection](#workshop-detection) for the exact behavior.

## Features

- **Persistent mod library** — keep a saved mod after unsubscribing without losing its title,
  description, preview, notes, tags, or dates.
- **Flexible personal tags** — create color-coded tags, assign any number of them, and rename,
  recolor, or remove them independently of Steam.
- **Fast organization** — search across title, author, description and tags or narrow the search to
  one field, sort by the latest installation, library-add or Steam-update time, and work with
  multi-selections.
- **Library/Active workspace** — see every inactive mod in **Library** at the center and the exact
  load order, including Core and DLC, in **Active** on the right. Active positions are plain
  right-aligned numbers, while official game content has its own blue shield **Core** marker and
  uses the matching installed RimWorld preview. A mod image's **Steam** or **Local** source marker
  sits in its top-right corner.
- **Fast draft activation** — double-click an inactive mod to stage activation or an active mod to
  stage deactivation; the projected row moves immediately without editing the game configuration.
  A newly deactivated mod is temporarily promoted to the top of Library without scrolling, making
  it easy to find or reactivate; changing Library search, scope or sort restores the selected
  ordering. Activating an unsubscribed Workshop mod also stages the subscription that must run
  first.
- **Direct load-order editing** — in Active's unfiltered **Load order** view, drag a row by its grip
  to place it before or after another mod. From any Active presentation, right-click a mod and
  choose **Move to position…** for an exact, arbitrary-distance move. Every successful manual move
  appends its own chronological draft line without automatically scrolling the list.
- **RimSort-inspired ordering** — propose a deterministic order from `About.xml` load rules,
  version-specific rules and dependencies, with bootstrap/game packages kept ahead of ordinary
  mods. When dependencies are missing, choose whether to add the available Library matches before
  sorting. Auto-sort ignores pending user reordering, replaces those earlier reorder lines with
  the concrete moves required by its own proposal, and lets later manual moves append after them.
  The resulting activation, subscription and order changes remain one reviewable draft.
- **Subscription actions where they belong** — subscribe or unsubscribe from an inactive mod's
  context menu or from Mod Info; the header can stage an unsubscribe for every subscribed inactive
  Workshop mod at once.
- **Guarded configuration writes** — apply only against the reviewed `ModsConfig.xml` baseline,
  require RimWorld to be closed, preserve non-active XML and create a recovery backup first.
- **RimSort-compatible mod-list files** — load a strict RimWorld `ModsConfigData` XML file into a
  previewed session draft, or export the current projected Active order to a standalone XML file.
  Missing package IDs and duplicate physical copies are reported before an import is staged.
- **Run the applied configuration** — when the draft queue is empty, the footer offers **Run
  RimWorld** and asks Steam to launch app `294100`. Pending membership, subscription, removal or
  load-order work keeps the launch action out of the way until it is applied or discarded.
- **Dependency visibility** — read requirements from installed mods' `About.xml`, show them in Mod
  Info, and warn when an Active mod requires a package that is not enabled for the current
  RimWorld version. **Auto-fix dependencies** stages every available missing dependency for
  activation, including a required subscription when necessary.
- **Local Workshop discovery** — scan one configured `294100` folder or discover RimWorld across
  Steam libraries without treating the Workshop manifest as the source of truth.
- **Metadata refresh** — update public Workshop titles, descriptions, previews, and other public
  details without an API key or a downloaded copy of the mod.
- **Data protection** — serialized atomic saves, revision checks, a previous-version backup, and
  persistent checkpoints before destructive operations.
- **Offline organization** — edit tags and notes, or prepare subscribe, unsubscribe, removal, and
  full inactive-cleanup drafts even when Steam is not running or Workshop folders are unavailable.
  Steam and destructive-target safety are checked when the draft is applied.

## Typical workflow

1. **Sync Workshop folders** to discover installed mods and import the ones you want to keep.
2. **Add your own tags and notes** so the collection reflects how you actually play.
3. **Double-click rows** to stage moves between **Library** and **Active**. If a Workshop mod is not
   subscribed, RimLib adds both subscription and activation to the draft. Core remains active; DLC
   and installed local mods are represented alongside Workshop mods.
4. Arrange Active manually by dragging rows in the unfiltered **Load order** view, or right-click a
   mod and choose **Move to position…** to enter its exact final load-order position from any Active
   presentation. For an automatic proposal, choose **Auto-sort**. If Active mods have missing
   dependencies, RimLib first lists them in a decision dialog. You can add every unambiguous
   Library match and sort, sort the current list without adding them, or cancel. The status reports
   unavailable or overridden rules; a dependency cycle or duplicate package ID blocks the proposal
   and reports the reason. Each manual move becomes a separate chronological draft operation.
   Choosing Auto-sort removes earlier reorder operations and records its concrete position moves;
   subsequent manual moves are appended after them. Activation and deactivation drafts preserve
   those order intentions: each move keeps the membership context in which it was staged, while
   newly activated mods join the projection without rewriting earlier relationships.
5. Use an inactive row's context menu or its **Mod Info** action to stage Steam subscribe or
   unsubscribe work when needed. Removing an inactive subscribed Workshop mod stages its
   unsubscribe and library removal together. While removal is pending, **Add back** in
   Mod Info cancels only that removal; its pending unsubscribe deliberately remains for independent
   review. To clean up the whole inactive collection, choose **Unsubscribe inactive** in the header;
   search and sorting do not limit its scope.
6. Open the draft review, inspect membership, order and subscription changes, then choose **Apply**.
7. Once the footer reports no pending changes, choose **Run RimWorld** to launch the applied
   configuration through Steam.

Drafts are saved locally on this device and restored after RimLib restarts. Tag and note edits are
saved immediately, while Steam, active-membership and active-order changes remain reviewable
intentions until you explicitly apply them. Restoring a draft never contacts Steam or changes
`ModsConfig.xml`; stale targets and configuration baselines are checked again at Apply time. Merely
seeing a manually rearranged or Auto-sort-proposed order in Active does not change
`ModsConfig.xml`. Subscriptions needed by the draft run first, the active configuration is written
next exactly once with the final projected order, regardless of how many reorder lines are shown,
and unsubscribes/removals run last. A successful configuration write or **Discard** clears the
saved reorder history; a failed write retains it for review and retry. If another operation
partially fails, confirmed changes are removed from the saved draft and unresolved items stay
available for retry.

The Run action never applies or discards work on your behalf. It appears only for a clean draft and
uses Steam's fixed RimWorld launch URI, so Steam remains responsible for locating and starting the
platform-appropriate game build.

Import and export use the desktop app's native file dialogs and the standard RimWorld
`ModsConfigData` XML shape. Loading requires a clean draft and first shows the exported game
version, unavailable package IDs, mods that would leave Active, and any deterministic choice among
duplicate physical copies. The `_steam` suffix used by RimSort is understood as a Workshop-copy
hint. Continuing stages the resolved, available order as ordinary device-local activation,
deactivation, subscription and reorder work; it does not download or invent missing packages, and
`ModsConfig.xml` is unchanged until the draft is reviewed and applied.

Export writes the current projected Active order—including unapplied membership and ordering
changes—and the current RimWorld version. The result is a standalone XML document with the known
official expansions, not a direct edit of the game's configuration. Package IDs are written in
RimSort's lowercase form. A `_steam` suffix is added only when the exported row selects a Workshop
copy and the current filesystem scan contains another physical copy of that package; stale saved
library records do not count as duplicates. Import and export remain available when installed-mod
folders cannot be scanned; in that case saved records and Active placeholders are used, and export
omits optional `_steam` duplicate-copy hints that cannot be verified. If a previously read
`ModsConfig.xml` becomes unavailable, its last in-memory order and version can still be used to
prepare or export a list; applying changes remains blocked until the live file can be read and
verified again. The renderer-only browser preview cannot open or save these local files.

## Safety by design

RimLib treats installed files, Steam subscriptions, and RimWorld's enabled-mod list as separate
observations. It rechecks the relevant source before performing a destructive action instead of
trusting cached metadata.

- It writes only the `activeMods` element of `ModsConfig.xml`, and only after draft confirmation.
- It refuses the write if Core is missing, package IDs are invalid/duplicated, RimWorld is running,
  or the active order changed after the draft baseline was captured.
- It resolves a configured `ModsConfig.xml` symlink to its canonical target, refuses hard-linked
  live configurations, and writes `ModsConfig.xml.rimlib.bak` beside that target before an atomic
  compare-and-write.
- Mod-list import accepts only bounded UTF-8 `ModsConfigData` XML with one Core entry, unique valid
  package IDs and no DTD or entity declarations. Standalone exports use guarded atomic replacement
  and refuse the live `ModsConfig.xml`, including symlink and hard-link aliases.
- It does **not** remove an active mod from Steam; deactivation must be in the same reviewed draft
  and is applied before unsubscribe.
- At Apply time, it blocks destructive actions if active state, installed identity or game process
  state cannot be verified; the unresolved actions remain in the draft for correction or retry.
- It does **not** delete a library record merely because a mod disappears from disk.
- Removing a saved record requires confirmation. For an inactive subscribed Workshop mod, RimLib
  adds unsubscribe and removal to the same draft, then applies them in that order.
- Direct deletion still refuses subscribed records; the confirmed compound draft must complete its
  unsubscribe before the guarded removal can run.
- Synchronization enriches and updates records; it never deletes omitted records.
- Failed saves and incomplete scans preserve the current displayed library.

## Getting started

RimLib is currently run from source. Packaged installers are not part of the repository yet.

### Requirements

- [Node.js](https://nodejs.org/) 24.21 or newer in the Node 24 release line
- npm 11
- macOS 13 (Ventura) or newer, Windows 10 or newer, or a maintained Linux distribution
- RimWorld installed through Steam
- Steam running and signed in when applying subscribe/unsubscribe draft actions
- RimWorld closed and a writable `ModsConfig.xml` for applying active-list changes

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

The browser preview uses separate browser storage. It cannot scan local Workshop folders, read or
change RimWorld's configuration, or perform Steam actions.

## Workshop detection

RimLib follows Steam's `libraryfolders.vdf` and scans numeric directories under:

```text
steamapps/workshop/content/294100/
```

You can instead configure one explicit `294100` directory in Settings. The override is used for
both synchronization and Active-mod identity lookup. An inaccessible override blocks the scan
and preserves existing status; an accessible but empty folder is a valid empty result.

The Workshop manifest is not treated as proof of subscription. A folder may remain after an
external unsubscribe, and a newly subscribed mod may not have downloaded yet. Active/inactive
panel membership comes from `ModsConfig.xml`, not folder or subscription state. Folder discovery
supplies installed metadata, while actual subscribe/unsubscribe actions use Steam's native
subscription state. Confirmed in-app actions take precedence until the folders catch up.

The **Sync Workshop** split button offers two modes. **Light refresh** checks for added and removed
folders and requests public metadata only for newly discovered or previously unenriched mods.
That targeted request supplies fields that are not stored in `About.xml`, including the Workshop
thumbnail. **Full refresh** keeps the previous behavior: it refreshes public metadata for every
installed Workshop mod. Both modes save detected presence first and scan again to catch files that
changed during the operation.

Local metadata comes from each mod's `About/About.xml`; the fast startup scan can therefore show a
new mod briefly before its online thumbnail arrives. RimLib automatically follows that discovery
with one targeted light metadata attempt for the new row. Completed attempts are remembered on the
device, including private or deleted items, so later light refreshes do not repeatedly request them;
use **Full refresh** for an explicit retry. A metadata-network failure does not prevent the local
import. Partial metadata responses, invalid remote items and incomplete installed metadata finish
as a visible warning instead of a silent success. RimLib preserves existing fields where refreshes
fail and records the affected Workshop IDs and causes in the structured application log.

## Library and Active

RimLib reads RimWorld's saved enabled-mod configuration from the platform default:

- **macOS:** `~/Library/Application Support/RimWorld/Config/ModsConfig.xml`
- **Windows:** `%USERPROFILE%/AppData/LocalLow/Ludeon Studios/RimWorld by Ludeon Studios/Config/ModsConfig.xml`
- **Linux:** `~/.config/unity3d/Ludeon Studios/RimWorld by Ludeon Studios/Config/ModsConfig.xml`

Choose a different file in Settings when using custom profiles, Proton, or a nonstandard
installation. An unreadable configuration is treated as **unavailable**, not as an empty enabled
list, so activation and sorting remain blocked. Unsubscribe, library removal, and inactive cleanup
can still be staged, but confirmation refuses any destructive target whose active state cannot be
verified and retains those pending actions.

The **Active** panel follows the configuration's package order exactly. The **Library** panel
contains every other known mod, regardless of its Steam subscription. Core and DLC are read
from the same installed metadata as ordinary local and Workshop mods; Core is mandatory and cannot
be moved to Library. Each official row is identified by an exact known package ID, carries a
blue shield **Core** marker without tag styling, and uses that installed package's own
`About/Preview.png` artwork. The order position appears as a plain number at the right edge of the
row rather than as a status tag. Active's
**Load order** view replaces the old “Active first” sort, because every row on the right is already
active.

When Active is showing **Load order** with no search applied, each row has a drag grip for moving it
before or after another visible row. Dragging is intentionally unavailable in filtered or alternate
presentation sorts, where the visual row order is not the canonical game order. For an exact or
long-distance move, right-click a mod in any Active presentation and choose **Move to position…**;
the entered one-based number is its final position in the complete Active load order, not its row
in the current presentation. This position dialog is also the precise alternative to pointer-based
dragging. Neither manual method requests an automatic reveal scroll.

After the initial active configuration is available, RimLib selects the first Active row and shows
it in Mod Info. This startup selection does not request a virtual-list reveal or move either panel;
automatic scrolling is reserved for a mod newly staged into Active.

RimLib reads the small `ModsConfig.xml` active order separately from the much larger installed-mod
inventory. Active rows therefore appear as soon as the configuration is available, using saved
metadata or package placeholders, while a compact status in the panel reports the background
`About.xml` enrichment. Configuration loading and detail loading use separate small indicators, so
an enrichment scan never makes the populated panel look empty or blocks the whole interface.

On a cold launch, RimLib must first read and validate the local vault because it contains the
Library and configured paths. Once that required step completes, installed `About.xml` enrichment
runs in the background. The optional Firebase client is loaded only when Firebase sync is enabled,
and RimLib does not probe Steam during startup or while a subscription draft is being prepared;
Steam availability is checked once when that draft is applied.

Installed metadata is cached by the effective Workshop/library location, and concurrent callers
share one in-flight scan instead of rereading thousands of `About.xml` files. RimLib does not poll
the active configuration or Workshop folders after initialization. Use **Light refresh** to pick up
folder additions/removals and enrich only new mods, or **Full refresh** to re-fetch every mod's
public metadata. Either choice also forces an installed-metadata scan so newly discovered files do
not remain hidden behind an older cache.
Once configuration is ready, activation and deactivation remain available even while details load.
Auto-sort waits for the installed identity and ordering metadata needed to build a valid proposal.
Unsubscribe, removal, and full inactive-cleanup controls do not use Steam, Workshop-folder, or
installed-metadata availability as button-level gates. Apply reloads the relevant sources and
validates Steam, target identity, active state, and the saved library before any destructive work;
failure is reported without discarding the unresolved draft.

**Newest first** and **Oldest first** compare each mod's latest valid library-add, local-install or
Steam-update timestamp. Invalid or absent values are ignored, and a public metadata refresh time is
not treated as an install/update event, so refreshing a description cannot make an old mod appear
new. Equal timestamps fall back to a deterministic mod-ID order.

The Library-only **Not subscribed first** option groups mods without a current Workshop
subscription before subscribed mods. Each group remains newest-first, with the same deterministic
tie-breaking as the date sorts. This option is intentionally absent from Active, where every row's
primary ordering concern is its RimWorld load position.

Both panels offer **Invalid first** to surface entries without a usable package identity and
non-official active placeholders whose installed metadata is unavailable. In **Active**, mods with
any validation error come first while preserving the game's load order within each group. Active
validation checks the projected draft list for missing dependencies, declared RimWorld-version
support, `loadBefore`/`loadAfter` and dependency order, the standard bootstrap section, duplicate
package IDs and ordering cycles. Full build strings are compared by major/minor (`1.6.4633` matches
`v1.6`); an empty supported-version list remains unknown instead of becoming a false error.
Library entries retain newest-first order within their groups.

The bottom of Active shows **Total**, **Invalid**, **Removed** and **New** status chips. Invalid
filters Active to uniquely affected rows, New filters Active to pending activations, and Removed
filters Library to pending deactivations. New and Removed are device-local draft counts that survive
a restart; they ignore subscription, load-order and library-removal actions and clear after Apply
or Discard. Clicking the selected chip returns both panels to Total while retaining each panel's
explicit text search and sort. Version/order details appear on the row and in Mod Info. Diagnostics
are not Apply blockers:
dependency repair and Auto-sort still create ordinary reversible draft actions, while a version
mismatch intentionally has no automatic repair.

When an Active mod has missing direct dependencies, **Auto-fix dependencies** resolves their
normalized package IDs against the complete, unfiltered Library. RimLib validates the whole set
before changing the draft: unavailable or ambiguous packages produce an actionable error and stage
nothing. Available dependencies are staged for activation together, and an unsubscribed Workshop
dependency receives a subscription intention in the same atomic draft. Confirmation still runs
subscriptions before writing the active configuration. RimLib clears a hiding Active search when
needed, selects and scrolls to the first added dependency, and shows its own dependency state in Mod
Info. This explicit reveal is confined to a mod newly added to Active; startup selection and
ordinary selection never move either list. The compact staging notice remains visible only while
those activation intentions remain in the draft.

Double-clicking a row stages activation or deactivation and moves the projected row immediately.
It does not edit the file. Applying the reviewed draft re-reads `ModsConfig.xml`, verifies that its
normalized package order still matches the baseline shown during drafting, checks that RimWorld is
closed, validates unique package IDs and Core, and writes only the `activeMods` element. RimLib
first saves the previous file as `ModsConfig.xml.rimlib.bak` and uses an atomic guarded write. If
another program changed the configuration, the apply stops instead of overwriting it.

### How auto-sort works

**Auto-sort** proposes a new order for the active panel; it never writes immediately. Before
building that proposal, RimLib checks the projected Active list for missing dependencies. A modal
lists which dependencies have one available Library match and which are unavailable or ambiguous.
Available matches are followed transitively, so requirements of a dependency being added are shown
in the same review. The user may stage every available match for activation (plus subscription when
required) and sort the expanded list, sort only the current list, or cancel without changing the
draft.

The sorter is inspired by RimSort's dependency-aware approach and uses metadata available locally:

1. Package IDs are normalized case-insensitively. Duplicate active package IDs stop the sort so an
   ambiguous mod is never chosen silently. Rows without a usable package ID stay anchored in their
   current positions and produce a warning.
2. RimLib reads `loadBefore` and `loadAfter` from each installed mod's `About.xml`. A matching
   `...ByVersion` group replaces the corresponding base list for the current RimWorld version;
   `forceLoadBefore` and `forceLoadAfter` are always added. Explicit rules become directed ordering
   constraints.
3. Declared dependencies add inferred “dependency before dependent” constraints, with matching
   version-specific dependency groups replacing the base dependency list. When an explicit rule
   requires the reverse, the explicit rule wins and RimLib reports the conflict.
4. Recognized bootstrap/game packages—Prepatcher, Harmony, Visual Exceptions, Core and official
   DLC—plus anything that must precede them form an early tier. Other active mods follow.
5. Each tier is topologically sorted. RimLib prefers Prepatcher, Harmony, Visual Exceptions, Core,
   then Royalty, Ideology, Biotech, Anomaly and Odyssey. It adds each preference only when no
   metadata path requires the reverse, so explicit rules and dependencies win without creating a
   synthetic cycle. Early-tier prerequisite ties use package ID; ordinary-mod ties use normalized
   title, package ID and then original position.

References to inactive or unavailable packages that were not added are ignored and included in the
staging notice's warning count. Any dependency/rule cycle blocks the proposal and reports the
involved package IDs, leaving the current order intact. A successful order is stored as a
load-order draft alongside any dependency activations; non-fatal warnings remain summarized by the
status notice, and the draft must still pass the guarded apply described above. Changing a panel's
display-sort dropdown is presentation-only; Auto-sort and the two manual move controls are the
operations that stage a game load order. Each successful drag or exact-position move appends a
separate chronological review line. Auto-sort removes every earlier reorder line and replaces them
with the replayable position moves needed to reach its dependency-aware order; manual moves made
afterward append after those lines. Each order line has its own Undo control. Membership drafts do
not erase order lines: each move replays against its captured membership context, so hiding,
restoring or adding an Active mod does not rewrite unrelated position intentions. Review can
therefore explain the actions that produced the projected order while Apply still performs one
guarded `ModsConfig.xml` write for the final order. A successful write or **Discard** clears this
history, while a failed write leaves it available for correction or retry.

This is deliberately a local, deterministic subset of RimSort-style sorting. RimLib does not yet
consume RimSort's community rules database or attempt to resolve incompatibilities automatically.
The configuration describes the game's saved enabled list, not the mods used by a particular save
file.

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

Active-list recovery is separate from vault recovery. Before a confirmed active-list write, RimLib
copies the complete previous RimWorld configuration to `ModsConfig.xml.rimlib.bak` beside the
selected configuration file. The writer then replaces only `activeMods`; it does not prune these
configuration backups automatically.

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

Logs include startup information, scan results, per-item Workshop metadata warnings, IPC timing,
persistence/recovery events, Steam operations, renderer exceptions, and crash details. Credentials, account identifiers,
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
persistence, subscriptions, active-list writes, sorting or IPC.

Before opening a pull request:

```bash
npm run format
npm run lint:fix
npm run quality
```

GitHub Actions runs the same quality gate on Linux, macOS, and Windows.

## Current scope

RimLib's sorter uses the active mods' local `About.xml` rules and dependencies; it does not download
or reproduce RimSort's community-maintained rules. It reports missing targets and conflicting
constraints. Mod Info can stage locally known missing dependencies—and their existing Workshop
subscriptions—but RimLib does not search for or download dependencies absent from Library, or
decide mod incompatibilities. Save-specific mod lists, SteamCMD downloads and packaged installers
are also outside the current scope.

## License

RimLib is available under the [MIT License](LICENSE).
