# Testing

## Draft Workflow Tests

`tests/drafts.test.tsx` covers atomic staging, net intentions, session isolation, immutable mod data, Undo/Discard, locked apply snapshots, projected membership, newly Active protection, review acknowledgement and progress controls. Injected adapters test whole-group preflight, Workshop identity changes, offline/read failures, delayed responses, sequential execution, partial success/retry, removal-only execution without Steam and a removal target becoming subscribed before deletion. Native tests verify the final expected-Workshop-ID guard before any SDK call.

`tests/drafts.property.test.ts` compares generated staging sequences with an independent intention model, checks projected partitions and retained removals, and generates execution failures to verify that only the confirmed prefix leaves the queue. These tests never access real files or Steam. Electron draft tests exercise immediate row moves with no mutation IPC, multi-action review/progress, tag persistence, restart discard and retained failures. Existing subscription/deletion tests use the same new draft confirmation flow.

## Workspace State Tests

`tests/workspaceStore.test.tsx` checks Zustand store defaults, independent app sessions, read/action-only access, stable references, no-op notifications, per-panel search scopes, immediate Shift/Control selection, context snapshots, stale-row rejection and visible-order reconciliation. React server-rendering tests check the scoped provider and missing-provider guard.

`tests/workspaceStore.property.test.ts` generates panel-control action sequences against an independent model, consecutive selection/context operations and hidden-row reconciliation. These tests use fresh in-memory stores only, with no database, browser storage, IPC or Steam access. They run in `npm test`, the property command and the existing commit/CI quality gates. Electron tests additionally exercise filtering, selection and tag persistence after restarting the actual renderer.

## Runtime Schema Tests

`tests/schemas.test.ts` exercises Zod-backed database and IPC boundaries through their public validators. It covers optional metadata without coercion, opaque extension fields, prototype-like keys, unsupported-version refusal, all invoke channels and their supported arities, rejected extra arguments and the existing UTF-16 request-size limit. Constants tests reject unknown actions/channels and save options. Vault tests verify current-model initialization, semantic local-Steam reconciliation and fail-closed loading of older databases even when a current backup exists. Native Steam tests verify explicit-target preflight, Active changes between preflight and execution, and ownership/reconciliation of a late timed-out mutation. Workshop tests cover strict shared metadata normalization, bounded ordered mapping, single-flight discovery across caller timeouts, HTTP failures, byte-for-byte database preservation and a deleted target during an in-flight refresh. Window lifecycle tests cover the save handshake, renderer loss, retry and listener ownership. All run through `npm test` and the normal quality gate.

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

- Populated, empty, corrupt and newer-schema startup; disconnected disk recovery; a library with more than 2,000 records.
- All/title/author/description/tag search scopes, download-date sorting, exact Active game order and panel partitioning.
- Shift and Command/Control selection, last-click info, group tagging/removal/subscriptions and panel-boundary selection reset.
- Tag creation/renaming/colors/deletion, duplicate validation, persistence, bulk chooser creation/cancellation and focus restoration.
- Session-only mixed drafts, row moves and Undo/Discard without mutation IPC, confirmation/cancellation, hidden non-active cleanup, Active protection in rows/menu/IPC, configuration changes after review, offline Steam, game-running guards and partial failures/retry.
- Synchronization imports while retaining missing records and personal tags; metadata refresh without Steam/local files and recoverable HTTP errors.
- Selected library deletion acknowledgements, backups, subscribed-record protection and persistence after restart; no delete-all-library control.
- Settings browse/auto-detect/access checks, invalid paths, database/log shortcuts, Finder/browser targets and action errors.
- Pending-save shutdown, failed-save close prevention, retries and external database edits without overwrites.
- Broken-image fallbacks, tag search styling/contrast, action alignment, context-menu hover, tooltip portals, bold notifications and supported desktop window sizes.

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
- Explicit deletion removes only approved library records, rejects subscribed/stale selections atomically, and retains checkpoints without creating metadata archives.
- Tag action sequences agree with an independent set model. Edits preserve tag identity/extension fields; stale targets cannot partially modify a group.
- Multi-selection respects displayed order, Shift ranges and panel boundaries. Stale selections cannot recreate deleted records.
- Panels partition saved records, Active badges never appear in Library, and enabled mods follow the game's order rather than the library's order.
- Disconnected libraries retain uncertain presence. Confirmed subscription overrides win until folder observations catch up, and sibling paths are not mistaken for scanned folders.
- Native unsubscribe refuses Active/unverifiable mods, including a mod becoming Active between checks. It never implicitly changes the game's configuration.
- Public Workshop metadata uses exact string IDs, ignores unrelated items, preserves personal data and cannot write failed responses to the vault.
- IPC arguments reject malformed external values; logs redact sensitive data; tag text contrast and floating-control coordinates remain bounded.
- Persistence survives reopening, rejects stale revisions/external edits, keeps backups and checkpoints, and refuses future versions without overwriting files.

### Add A Property

Keep generators and assertions close to the owning behavior. Reuse `tests/helpers/properties.ts` for valid bounded domain records, budgets and disposable filesystem stores. Extend generators when a meaningful input dimension is missing; do not narrow them merely to make a real bug disappear.

Prefer independent invariants or a simpler reference model over duplicating the implementation. Combine related generated values so valid scenarios stay valid, and avoid broad filtering or discarded preconditions that hide cases. Include empty, duplicate and invalid inputs deliberately when they exercise the contract.

Pure transformations must not mutate inputs. Tests must never read the user's database or access real Steam/game folders, make real HTTP requests, initialize the Steam SDK or launch Electron. Inject HTTP/native doubles and use `temporaryVault`, which creates and cleans a separate directory for every generated filesystem case.

Property tests complement example tests and the Electron interaction suite. They cannot prove that dialogs render, focus works or the OS/native SDK behaves correctly on a real installation.
