# Testing

## Draft Workflow Tests

`tests/drafts.test.tsx` covers atomic staging, independent subscription/activity intentions, compound subscribe-and-activate and unsubscribe-and-remove drafts, category-specific removal undo that retains unsubscribe, Core protection, versioned snapshot/hydration, immutable mod data, Undo/Discard, projected active-order and baseline ownership, chronological replayable reorder operations, order retention across activity staging and undo, per-order Undo, Auto-sort replacement followed by manual appends, locked apply snapshots, projected active/inactive membership, review acknowledgement and progress controls. It verifies that applying any number of reorder lines writes the final order once, that failure retains their history, and that successful configuration application or Discard clears it. It also verifies that the footer offers Run only for a zero-count draft, including the order-only and applying cases, and that Steam, Workshop-folder and installed-metadata errors do not gate unsubscribe staging. Injected adapters verify the apply sequence—subscribe, configure, unsubscribe, remove—plus whole-group preflight, Workshop identity changes, stale active baselines, offline/read failures with unresolved intentions retained, delayed responses, partial success/retry, removal-only execution without Steam and a removal target becoming subscribed before deletion. Native tests verify the final expected-Workshop-ID guard before any SDK call and the fixed Steam game-launch URI.

`tests/drafts.property.test.ts` compares generated staging sequences with an independent multi-category intention model, checks projected partitions and retained removals, verifies snapshot round trips, and generates execution failures to verify that only the confirmed prefix leaves the queue. These tests never access real files or Steam. `tests/activeMods.test.tsx` checks that saved, installed and placeholder entries form one universe, that Core/DLC appear in configuration order, that official previews keep their package identity, that inactive membership is independent of subscription, and that dependency repair rejects unavailable or ambiguous package matches. Electron draft tests exercise immediate double-click row moves with no mutation IPC, compound subscribe-before-activate review/application, dependency auto-fix success and error paths, tag persistence, pending-draft restoration and retained failures. Subscription, activity, ordering and deletion use the same draft confirmation flow.

## Workspace State Tests

`tests/workspaceStore.test.tsx` checks Zustand store defaults, independent app sessions, read/action-only access, stable references, no-op notifications, per-panel search scopes, atomic cross-panel status-filter routing, immediate Shift/Control selection, context snapshots, stale-row rejection and visible-order reconciliation. React server-rendering tests check the scoped provider and missing-provider guard.

`tests/workspaceStore.property.test.ts` generates panel-control action sequences against an independent model, consecutive selection/context operations and hidden-row reconciliation. These tests use fresh in-memory stores only, with no database, browser storage, IPC or Steam access. They run in `npm test`, the property command and the existing commit/CI quality gates. Electron tests additionally exercise filtering, selection and tag persistence after restarting the actual renderer.

## Runtime Schema Tests

`tests/schemas.test.ts` exercises Zod-backed database and IPC boundaries through their public validators. It covers ordering metadata, optional metadata without coercion, opaque extension fields, prototype-like keys, unsupported-version refusal, all invoke channels—including the independent active-configuration and installed-inventory reads—and their supported arities, rejected extra arguments and the existing UTF-16 request-size limit. Constants tests reject unknown actions/channels and save options. Vault tests verify current-model initialization, semantic local-Steam reconciliation and fail-closed loading of older databases even when a current backup exists. Native Steam tests verify explicit-target preflight, active changes between preflight and execution, and ownership/reconciliation of a late timed-out mutation. Workshop tests cover strict shared metadata normalization, bounded ordered mapping, cached/single-flight installed discovery across caller timeouts and forced refreshes, HTTP failures, byte-for-byte database preservation and a deleted target during an in-flight refresh. Window lifecycle tests cover the save handshake, renderer loss, retry and listener ownership. All run through `npm test` and the normal quality gate.

`tests/aboutRules.test.ts` verifies case-insensitive parsing/deduplication of base, version-keyed and forced `loadBefore`/`loadAfter` data, invalid-entry rejection and persistence through Workshop import. `tests/modSort.test.ts` covers explicit constraints, inferred dependencies, explicit-over-inferred precedence, bootstrap/game tiers, deterministic ties, anchored unknown rows, missing-target warnings and structured duplicate/cycle failures. `tests/activeValidation.test.ts` verifies normalized version compatibility, unknown-version safety, draft-projectable missing dependencies, versioned/forced order rules, dependency precedence, bootstrap placement, unconstrained peers, unique invalid counts, duplicates, cycles and input immutability. `tests/rimWorldConfig.test.ts` uses a temporary configuration to verify bounded UTF-8 reads, preservation of unrelated XML, Core/ID validation, normalized stale-baseline checks, RimWorld-closed enforcement, canonical writes through configured symlinks, hard-link refusal at preload and publish boundaries, `.rimlib.bak` creation and guarded atomic-write races.

`tests/modListFiles.test.ts` covers RimWorld `ModsConfigData` parsing and canonical lowercase rendering, UTF-8 and size/entry bounds, strict structure, DTD/entity refusal, version/Core/package/expansion validation, extension handling, atomic compare-and-swap writes and protection against exporting over the live configuration through direct, symlink or hard-link aliases. `tests/modListExport.test.ts` verifies that `_steam` is emitted only for a selected installed Workshop copy with another real filesystem copy, never for stale saved rows or repeated observations. `tests/modListImport.test.tsx` covers ordered inventory resolution, `_steam` hints and deterministic duplicate-copy choices, version and missing-package previews, explicit partial-import confirmation and malformed preload-result rejection. Draft tests cover atomic imported-list staging against the current Active baseline, and IPC schema tests independently reject malformed export requests.

`tests/librarySort.test.tsx` and `tests/library.property.test.ts` verify that newest/oldest ordering uses the latest valid add, local-install or Steam-update timestamp in both panels, ignores metadata-refresh time, remains deterministic for ties and does not accidentally substitute Active load order. They also verify Library-only not-subscribed-first grouping and its stable newest-first order inside both subscription groups. `tests/activeOrder.test.ts` covers immutable relative before/after moves, validated one-based exact positions, canonical-order-preserving blocks, no-ops and rejection of unknown or ambiguous IDs. Auto-sort dependency-plan tests cover unique available matches, transitive dependency chains, duplicate/ambiguous packages and unavailable dependencies before the modal stages anything.

Property mutation checks retain the prototypes of generated records when taking comparison snapshots; null-prototype inputs remain in the corpus rather than being excluded to accommodate `structuredClone`.

## Electron Interaction Tests

[Playwright's Electron support](https://playwright.dev/docs/api/class-electron) tests the actual built desktop app, including the main process, preload, renderer, IPC validation and persistent vault. Tests live in `tests/e2e/*.spec.ts`. They are part of `npm run quality`, the staged pre-commit gate and all three OS CI jobs.

```bash
npm install
npm run test:e2e
npm run test:e2e -- --grep 'Active unsubscribe'
npm run test:e2e -- --list
npx playwright show-report
```

Only Electron is launched; `npx playwright install` is unnecessary. Electron's binary must be installed. On headless Linux, install system libraries with `npx playwright install-deps chromium`, then run `xvfb-run --auto-servernum npm run test:e2e`. On macOS/Windows, run from a desktop session. Playwright's Electron integration is experimental, so review compatibility when upgrading Electron or Playwright together.

The script builds production assets under `.e2e-build/app`, then compiles a test-only main-process entry with native adapter substitutions. It never modifies the normal `out` build or adds a production test switch. The real persistence, subscription coordinator, XML readers and UI run unchanged. Steam availability/client calls, OS folder/file dialogs, shell actions and external metadata responses are test doubles. Neither Steam nor RimWorld needs to be installed or running.

Each test has its own token-marked temporary directory, seeded database, backups, Workshop folders, `ModsConfig.xml`, session data and logs. Paths are checked before access, including symlink escapes. The test launcher fails closed without the owned fixture. Main-process public metadata responses are synthetic; renderer network requests are blocked. No user's database, Steam subscription, real mod folder or game config is touched. Confirmed subscription actions intentionally do not alter fixture folders, exercising pending status overrides. Cleanup awaits process exit before removing the fixture.

Critical interaction coverage includes:

- Populated, empty, corrupt and newer-schema startup; disconnected disk recovery; initial first-Active selection without a reveal scroll; and a library with more than 2,000 records that remains at scroll position zero after startup selection settles.
- All/title/author/description/tag search scopes, latest-install/update newest/oldest sorting, Library-only not-subscribed-first grouping, metadata-invalid-first sorting in **Library**, all-diagnostic invalid-first sorting in **Active**, toggleable Total/Invalid/New/Removed footer filters with cross-panel Removed behavior and draft-reset counts, version/dependency/order row diagnostics, Active **Load order** sorting, exact game order and panel partitioning including Core/DLC.
- A newly staged deactivation is temporarily promoted above the current Library sort without scrolling; changing Library search/scope/sort restores ordinary ordering, and reactivation removes stale priority.
- Config-first Active rendering during a delayed installed-inventory scan, activity-draft and Library-priority rebasing across an unambiguous placeholder replacement, separate compact configuration/detail/explicit-refresh loading indicators, manual metadata retry, absence of focus/timer polling and the forced post-sync refresh path.
- Shift and Command/Control selection, last-click info, group tagging/removal/subscriptions and panel-boundary selection reset.
- Tag creation/renaming/colors/deletion, duplicate validation, persistence, bulk chooser creation/cancellation and focus restoration.
- Native XML dialog cancellation; import preview, missing-package confirmation and session-draft staging without an immediate configuration write; and export of the projected Active order before and after Apply.
- Session-only mixed drafts, double-click activation/deactivation, auto-sort's missing-dependency decision modal, add-and-sort versus sort-current paths, unfiltered Load-order drag/drop, Active-only exact-position context moves from alternate presentations, chronological per-move reorder review lines, manual-to-Auto-sort history replacement and Auto-sort-to-manual appends, one shared final staged order and one configuration write only after Apply, retained history on write failure, cleared history on success/Discard, clean-draft-only Steam launch with membership/order gating and exact URI recording, no reveal scrolling after manual moves, warning counts and blocking failures, dependency repair focus/one-shot Active-only virtual-list reveal and draft-aware notice removal, row moves and Undo/Discard without mutation IPC, confirmation/cancellation, inactive-only subscription actions and full-list inactive cleanup, Core protection in rows/menu/IPC, configuration changes after review, unsubscribe/removal/cleanup staging without Steam or Workshop metadata gates, no startup/status probe, Apply-time safety errors with the draft retained, game-running guards, configuration backup and partial failures/retry.
- Full synchronization imports while retaining missing records and personal tags; light refresh targets only new/unattempted IDs, hydrates their thumbnails and retains removed records; startup performs the same one-shot targeted enrichment without a click and does not retry it after reopening; visible partial-metadata warnings, affected-ID `WARN` log records, metadata refresh without Steam/local files and recoverable HTTP errors.
- Selected library deletion acknowledgements, backups, inactive subscribed removal through one compound draft, Mod Info add-back that cancels only removal while retaining unsubscribe, direct subscribed-record protection and persistence after restart; no delete-all-library control.
- Settings browse/auto-detect/access checks, invalid paths, database/log shortcuts, Finder/browser targets and action errors.
- Pending-save shutdown, failed-save close prevention, retries and external database edits without overwrites.
- Official Core/DLC icon markers and local previews, top-right Steam/local image markers, broken-image fallbacks, plain right-aligned load positions, expandable Mod Info descriptions, transparent bordered/icon-led pending indicators, aligned idle/loading header status, compact action alignment, tag search styling/contrast, context-menu hover, tooltip portals, error/warning notifications and supported desktop window sizes.

Tests use awaited locator assertions and condition polling, not arbitrary sleeps, force-clicks or automatic retries. The fixture fails a test on any uncaught renderer error. Tests run serially to avoid native window/focus interference. Every launch records a trace; failures attach screenshots, fixture-only session logs and native-call records. Results live in `test-results/` and the HTML report in `playwright-report/`, both ignored by Git. CI retains diagnostics for seven days. Review logs before sharing them.

These tests do not validate the actual Steam SDK, native permission/file dialogs, real CDN images, installation/update packaging or real filesystem latency. Those require separately authorized manual/packaged tests; fake external services must never be presented as evidence of live Steam reliability.

## Property-Based Tests

[Fast-check](https://fast-check.dev/docs/introduction/) supplements the existing Node test suite. It generates bounded inputs, shrinks failures into smaller counterexamples and reports the seed and shrink path needed to reproduce them. It is a development-only dependency; it is not part of the application runtime.

### Run

```bash
npm run test:properties
npm test
npm run quality
```

Every top-level `tests/*.property.test.ts` file is automatically included in `npm test`, the commit quality gate and the existing cross-platform CI workflow. The separate property command runs only those files. Both test commands forward Node test-runner arguments:

```bash
npm run test:properties -- --test-name-pattern='^property: vault normalization'
```

Pure/HTTP-double properties default to 200 cases per property. Tests that write temporary databases default to 25 cases to keep the full commit gate practical. Each tag/selection sequence can contain up to 40 actions. Vault generators include empty libraries, mixed local/Workshop records, personal assignments, Unicode/whitespace, large Workshop IDs and JSON extension fields in current records.

### Replay And Stress

Failures include the exact seed, path and minimized counterexample. Select the failing test by its unique name and set `FC_SEED` and `FC_PATH` to the values from that failure. For example, replacing the sample seed/path below with the reported values:

```bash
FC_SEED=123 FC_PATH='0:1:0' npm run test:properties -- \
  --test-name-pattern='^property: vault normalization'
```

`FC_PATH` requires a seed. Use it with one selected property, not the whole suite, because shrink paths belong to a particular property. Leave both variables unset for fresh generated cases; normal failures remain reproducible through their reported seed/path.

Increase the case budget for a focused stress run:

```bash
FC_NUM_RUNS=2000 npm run test:properties -- \
  --test-name-pattern='^property: bulk tag operations'
```

`FC_NUM_RUNS` overrides both default budgets. Environment overrides reject invalid integers rather than silently falling back. Avoid running a huge filesystem budget accidentally; target the property under investigation. Promote a discovered bug to a small explicit regression test alongside its property.

### Protected Invariants

- Normalization is idempotent, unknown JSON fields survive, and unsupported versions/duplicate identifiers are refused.
- Sync and ordinary saves retain omitted records and tags. Metadata enrichment preserves personal assignments, notes and original dates.
- Explicit deletion removes only approved inactive library records, rejects stale, active or unverifiable selections before checkpointing, requires subscribed records to complete their staged unsubscribe first, and retains checkpoints without creating metadata archives.
- Tag action sequences agree with an independent set model. Edits preserve tag identity/extension fields; stale targets cannot partially modify a group.
- Multi-selection respects displayed order, Shift ranges and panel boundaries. Stale selections cannot recreate deleted records.
- Active/inactive panels partition the complete known-mod universe independently of subscription; Core/DLC and configured placeholders follow the game's exact order.
- A delayed installed-metadata scan cannot delay the configuration-backed active rows, replace a newer active order, show a false empty state or hide the panel's accessible loading status. Configuration-ready activation/deactivation stays available, auto-sort waits for trustworthy ordering metadata, and unsubscribe/removal/cleanup intentions remain stageable regardless of Steam, folder or installed-metadata availability.
- Activation/deactivation, manual reorder and auto-sort change only the saved device-local draft until confirmation. Restart restoration is side-effect free, preserves the verified baseline and chronological membership snapshots, and never writes `ModsConfig.xml`. Manual relative/exact moves preserve projected membership, append one chronological operation per successful move and never trigger reveal scrolling; each operation retains its staging-time membership context, including while activity edits are staged, canceled or undone. Auto-sort ignores pending user ordering, replaces it with concrete replayable move lines, and later manual moves append after them. Every order line can be undone independently without removing a dormant unrelated move. The operation history always projects one final order and produces at most one guarded configuration write; failed writes retain it while successful writes and Discard clear it. Unsubscribed Workshop activation atomically includes subscription, Auto-sort can stage available missing dependencies before ordering the expanded membership, dependency fixes validate the full Library-resolved set before staging, Core cannot be deactivated, and a proposed order must match the projected membership.
- Newest/oldest ordering is monotonic over the latest valid `addedAt`, `downloadedAt` or `steamUpdatedAt` value, ignores metadata refresh timestamps and uses deterministic ties. Library-only not-subscribed-first groups projected unsubscribed rows before subscribed rows without becoming an Active option.
- Applicable explicit `About.xml` rules and inferred dependencies are respected deterministically. Missing targets warn; duplicate package IDs and cycles produce no proposal.
- Disconnected libraries retain uncertain presence. They do not disable subscription or removal draft controls; confirmation rechecks authoritative state and retains unresolved actions on failure. Confirmed subscription overrides win until folder observations catch up, and sibling paths are not mistaken for scanned folders.
- Native unsubscribe refuses active/unverifiable mods, including a mod becoming active between checks. A reviewed deactivation is written before its paired unsubscribe.
- Active configuration writes require Core exactly once, valid unique package IDs, a matching expected baseline and a closed game. They preserve unrelated XML, back up the source and refuse concurrent edits.
- Public Workshop metadata uses exact string IDs, ignores unrelated items, preserves personal data and cannot write failed responses to the vault.
- IPC arguments reject malformed external values; logs redact sensitive data; tag text contrast and floating-control coordinates remain bounded.
- Persistence survives reopening, rejects stale revisions/external edits, keeps vault checkpoints and configuration backups, and refuses future versions without overwriting files.

### Add A Property

Keep generators and assertions close to the owning behavior. Reuse `tests/helpers/properties.ts` for valid bounded domain records, budgets and disposable filesystem stores. Extend generators when a meaningful input dimension is missing; do not narrow them merely to make a real bug disappear.

Prefer independent invariants or a simpler reference model over duplicating the implementation. Combine related generated values so valid scenarios stay valid, and avoid broad filtering or discarded preconditions that hide cases. Include empty, duplicate and invalid inputs deliberately when they exercise the contract.

Pure transformations must not mutate inputs. Tests must never read the user's database or access real Steam/game folders, make real HTTP requests, initialize the Steam SDK or launch Electron. Inject HTTP/native doubles and use `temporaryVault`, which creates and cleans a separate directory for every generated filesystem case.

Property tests complement example tests and the Electron interaction suite. They cannot prove that dialogs render, focus works or the OS/native SDK behaves correctly on a real installation.
