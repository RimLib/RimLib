# Architecture

## Ownership

```text
renderer components -> workflow hooks -> ModStoreApi
                                            |
                                    isolated preload bridge
                                            |
                                  validated Electron IPC
                                            |
                      application services -> platform adapters
                                            |
                                         VaultStore

shared domain types, validation and pure transformations
are available to both sides without platform dependencies
```

- `src/shared`: current mod/tag records, stored database validation/normalization, tag transformations, package matching, subscription safety helpers and the IPC contract. Tag creation/editing validates the latest vault and selected targets atomically, preserving unknown tag fields. Shared modules must not import React, Electron, Node or either process's implementation.
- `src/main`: filesystem, OS dialogs, logging, public Workshop HTTP requests, Steam SDK access and serialized application operations. `index.ts` composes these services and owns the native window lifecycle. The IPC handler checks the sender and main frame, validates arguments and applies the Steam availability gate before an action.
- `src/preload`: exposes only `ModStoreApi` and diagnostics through `contextBridge`. Its invocation wrapper uses the shared channel/argument/result contract; no generic IPC transport is exposed to the renderer. Electron's untyped response assertion is confined to this adapter.
- `src/renderer/src/components`: store-connected feature components, pure presentation views, dialogs and shared controls. Connected panels select shared session state directly; their exported views remain stateless and easy to test. Components never import privileged APIs.
- `src/renderer/src/hooks`: orchestration, persistence scheduling, background status, selection and dialog workflows. `useSettingsDialog` owns path selection/access tests, `useTagDialogs` owns tag mutations/dialog transitions, and `useWorkshopActions` owns synchronization. `useDraftChanges` executes confirmed drafts and reports into the draft store, delegating the mutation sequence to `services/draftActions.ts`. `useModSelection` reconciles current displayed ordering with the workspace store. All durable mutations still use the single `useModVault` save/operation lock.
- `src/renderer/src/stores`: session-only workspace and draft state in Zustand, scoped to one app mount. The workspace store owns both panels' search text/scope and sorting, focused mod, multi-selection and context-menu targets. The draft store owns per-mod intentions, review state, progress and its apply lock. Neither has IPC, storage or Steam dependencies.
- `src/renderer/src/services`: the native/browser store adapter, notifications, diagnostics, settings persistence, and optional user-owned Firebase client. The browser adapter preserves the Promise/error contract but uses separate local storage and cannot execute native actions. Firebase Authentication and Firestore run as unprivileged renderer clients with user-provided Web app configuration; no service-account credential crosses the preload bridge.
- `src/renderer/src/utils`: derived presentation views, filtering, ordering and selection logic. `tagDialogs.ts` defines one explicit dialog state and its valid transitions. An editor retains its return state; a bulk chooser stays mounted underneath it to preserve checked tags and search. User tag mutations live in `shared/tags.ts`, not in a UI utility.

Lint enforces the process import boundaries, so they are not only conventions. There is deliberately no generic repository framework or dependency-injection container; tests use existing service constructors and narrow function parameters.

## Renderer State

[Zustand](https://github.com/pmndrs/zustand#using-zustand-without-react) manages shared, transient workspace interactions through a vanilla store and React selector bindings. `WorkspaceStoreProvider` creates a fresh store for each app mount; there is no module-global singleton or persistence middleware. Selectors return stable state references rather than freshly constructed objects. Panel view changes preserve the other panel's reference, and no-op actions do not notify subscribers.

Consumers receive observation methods and named actions, not raw `setState`. Selection, focus and context opening use the latest synchronous state and existing pure selection rules, avoiding parallel React-state/ref copies. Store-connected panels read their search/sort state, selection and pending drafts directly, then delegate rendering to pure views; callers pass only domain data and workflow commands. Actions receive current displayed IDs rather than keeping a second mod collection. Reconciliation removes hidden targets and closes invalid menus in one transition. Tag searches derive their names from the current vault, so tag edits need no parallel workspace cleanup.

The vault remains the only durable source of mod records, tags and notes. `useModVault` still owns debounce, serialized saves, revision checks, operation locking and before-close flushing; Zustand never bypasses it. Steam/Active observations and destructive-action guards remain in their existing workflows and main-process services. Dialog forms, notifications and operation progress stay with their local owners. Reopening resets filters, focus, multi-selection and menus while retaining database-backed tags.

## Draft Workflow

Subscription changes and library removals are session-only intentions, not database edits. A draft has at most one net intention per saved mod. Staging validates a whole selection before changing it; opposite subscription intentions cancel, and Undo/Discard never contact Steam. Panel projection moves pending subscriptions without changing authoritative records, keeps pending removals visible and never moves newly Active mods into Library. Metadata refresh and tag edits remain immediate and preserve pending intentions.

The footer opens a full review. Deletion additionally requires acknowledgement. Applying captures and locks the queue, flushes personal edits through `useModVault`, checks Steam when needed, reloads targets and preflights every subscription group before any Steam mutation. Each subsequent native action rechecks its guards and binds the expected Workshop identity. Removals are reloaded/revalidated, checkpointed and committed only after subscription steps. No timer abandons a persistence write or Steam mutation. If a native mutation exceeds its foreground deadline, `SteamOperations` keeps the exclusive lane in an indeterminate state until that exact promise settles, force-refreshes Steam, persists the observed result and only then permits another mutation.

Execution is sequential and reports named steps and per-step progress. Confirmed changes leave the queue only after their result is adopted. The first failure stops later work; completed changes remain recorded and unresolved intentions remain available for review/retry. No implicit rollback contacts Steam, and no draft writes RimWorld's enabled configuration. Closing without applying discards intentions only; tags, saved mods and confirmed changes stay durable.

## Constants And Keys

`shared/domainConstants.ts` owns persisted sources, activity states and subscription actions. Types derive from these frozen maps, and runtime validation uses the same values. `shared/ipc.ts` owns invoke/event channels; the preload and main process reference those maps rather than repeating wire strings. Lint rejects raw protocol/action keys outside their owning modules.

`shared/storage.ts` owns stable database/browser storage names, and `shared/limits.ts` owns read deadlines and Steam import/cache policies. Logging policies remain in `shared/logging.ts`, native OS/error/window constants in `main/platformConstants.ts`, and renderer modes, filters, sorting and UI timings in `utils/uiConstants.ts`. Dialog transitions and tooltip placements stay with their respective workflow utilities. Database validation schemas are checked with `satisfies` against their domain field keys.

Supported IPC names, database filenames and schema version have explicit contracts. Retired invoke channels and subscription actions are rejected; they are not compatibility aliases. Tests deliberately keep independent literal fixtures to verify storage contracts. Use named constants for identifiers and policy decisions; ordinary labels, HTML/OS API vocabulary, arithmetic identities and presentation classes need not become a global constants catalogue.

## Data And Safety

The local v3 vault separates canonical `library` records from machine-specific `deviceState.steam`. Stored mods do not contain `subscribed`; the runtime derives membership from locally observed Workshop IDs plus explicit pending subscribe/unsubscribe actions. Optional Firebase sync mirrors only portable mod fields and personal tags into per-entity user documents; device paths, file sizes, download/subscription observations, settings and transient focus remain local. Firestore writes carry versions and deletion tombstones, use transactions for compare-and-set, and retain a device-local baseline. Independent local and remote edits stop as conflicts rather than choosing a winner. Authentication passwords are transient and Firebase persists only its own session. `applicationIdentity.ts` sets RimLib's display name and pins default Electron data/session paths to the `RimLib` storage directory before logging, instance locking or database loading. Explicit path overrides remain untouched. Only the configured location is used; identity setup never scans, migrates or merges other application folders. Identity setup failures show a native error and terminate before database access. The browser preview uses only the `rimlib:vault` and `rimlib:vault:backup` keys, without aliases or namespace migration. `VaultStore` serializes writes, rejects stale revisions/external edits, writes atomically, retains a previous-version backup and checkpoints destructive operations. Database loads and saves validate every known field before normalizing optional metadata. Unknown fields are passed through as opaque extensions. Explicit older or newer schema versions are rejected before backup recovery; the standalone `scripts/migrate-vault-v2-to-v3.mjs` tool performs the deliberate, backed-up v2 upgrade.

[Zod](https://zod.dev/api) validates external data at three boundaries. `shared/vaultValidation.ts` defines reusable mod/settings schemas and the stored v3 contract; it validates the header before the complete vault so unsupported versions cannot fall back to a backup. Open records preserve extension fields without coercion or schema defaults. The validated source is retained because Zod's parsed clone omits `__proto__`; pending-subscription checks examine every own entry rather than silently skipping that key. `shared/ipc.ts` defines an exhaustive channel-to-tuple schema map, rejecting wrong types, missing required arguments, unknown channels and extra arguments before actions. Save requests validate normalized runtime state and accept only supported save options. `main/workshopMetadata.ts` validates public HTTP request IDs and response envelopes; one shared normalizer strictly checks item/result/app identity and sanitizes optional metadata for both individual refresh and bulk import. Internal transformations and native subscription guards remain explicit domain logic, not schema side effects.

An ordinary save merges rather than replacing omitted records. Synchronization adds/enriches records and updates status, never deleting records. Explicit library deletion validates the entire selection before checkpointing and again inside the serialized update. Subscribed records are protected. Approved deletions remove the saved records completely; the checkpoint, not an application-visible metadata archive, provides recovery.

Installed-folder status, actual Steam subscription IDs and the game's enabled packages are different observations. Folder scans are for library presentation/import, the Steam SDK is for subscription actions, and `ModsConfig.xml` plus installed identities determine Active protection and order. A shared linear-time reconciler applies local Steam observations in both processes, preserves unknown state extensions, keeps unchanged object identities and updates only mod flags whose effective membership changed. Do not collapse these observations into one boolean or infer reliable Active identity from cached package metadata.

Every native unsubscribe funnels through a final Active/readability/game-state guard immediately before the Steam call. Draft execution uses explicit whole-group native preflight and then guarded, identity-bound single-mod calls. Preflight is a read/check operation, not an authorization token. Confirmed Steam changes are recorded before reporting failures. No application API writes RimWorld's enabled configuration or downloads Workshop content.

The application models only saved mods, tags, subscription observations and session-only drafts. Active entries come directly from the game configuration and current installed metadata. Unsaved subscribed items use current installed metadata or a Workshop placeholder; they cannot edit tags or refresh saved metadata until imported. No modlist, deleted-mod archive or SteamCMD model exists. Existing unknown database fields remain opaque and are never used as action targets or reinterpreted as tags.

Read-only operations have deadlines and stale-response guards. Persistence writes are awaited, not abandoned by timers. Renderer actions report failures through notifications, and panel error boundaries do not recreate or empty the vault. Window closing is coordinated as an explicit save handshake: healthy renderers may finish without a deadline, save failures keep the window open for retry, and a renderer proven unavailable cannot leave application quit waiting forever.

## Readability Review

The main complexity was workflow ownership, not formatting. `App.tsx` combined tag creation, manager/editor return flags, bulk assignment, Steam availability checks, previews, progress and panel composition. Those workflows now have explicit owners, and shared panel props remove duplicated action wiring. Subscription and deletion confirmation use the draft review; the superseded standalone dialogs and styles are removed.

`services/draftActions.ts` owns sequential draft execution, progress and failure retention. `SteamOperations` owns native preflight and individual guarded mutations; there is no second token-based batch executor or persisted-selection action path. Every unsubscribe passes through `changeSubscription`'s final guard. Tag assignments use the selection-aware transformation for both single and multiple mods.

`steamWorkshop.ts` contains several filesystem/parsing stages, but the stages are named and tested. Concurrent callers share one in-flight raw discovery for the same effective path even if an individual caller times out, and installed metadata reads use an ordered bounded worker pool. `VaultStore` and `useModVault` are deliberately kept together: their write ordering, revision checks and locks are easier to audit as one lifecycle than as scattered generic helpers. Declarative CSS and test fixtures are not split solely to meet a line limit.

## Verification And Next Steps

The suite covers pure transformations, temporary filesystem stores, corruption/backup recovery, races and partial subscription failures, request validation, SSR/control handlers, lint policy and staged commit isolation. Some layout assertions still inspect CSS/source; a few now use TypeScript ASTs so formatting cannot change their meaning.

Fast-check supplements example regressions with bounded generated vaults and independent action-sequence models. It checks current record preservation and explicit deletion, tags, selection, panel membership/order, unavailable-drive status, native unsubscribe guards, public metadata refresh, IPC validation, log privacy and presentation geometry. Filesystem and HTTP/native tests use temporary stores and injected doubles; no real user database, Steam account or game config is accessed. This does not replace Electron rendering/focus tests. See [TESTING.md](TESTING.md) for run and replay policies.

The Playwright harness in `tests/e2e` launches the production main-process lifecycle, IPC validation/handlers, preload and renderer, retaining the real vault store, XML readers, installed-metadata index and Steam operation coordinator. A test-only esbuild entry substitutes native availability/Steam calls and discovery of the user's Steam/game directories. OS dialogs/shell actions and public metadata requests are controlled doubles. Production modules contain no test-mode environment branches or generic IPC escape hatch.

Each test owns a token-marked temporary directory for its database, backups, logs, session, Workshop content and game config. The launcher refuses missing/mismatched ownership and out-of-fixture paths, including symlink escapes. External HTTP requests are blocked; subscription changes and OS actions are recorded, never executed. Fixtures await shutdown before removing files. The build is separate from development output. These tests cover application interactions, not native SDK compatibility, OS permission dialogs or packaged upgrades.

The next architectural work should be driven by specific workflows and regression tests:

1. Extend the isolated Electron suite when workflows change, especially confirmation/recheck races and shutdown. Keep live Steam and packaged-binary validation explicit, authorized and separate from automated fixture tests.
2. Keep App focused on panel composition. Extract remaining derived views or file-action workflows only when their behavior grows; keep the vault's save/operation lock centralized and avoid competing state stores.
3. Add packaging/update tests and a dependency security review before distributing a public binary. ESM preload/native SDK constraints must be considered before changing Electron's sandbox settings.

Avoid changing the storage engine, rewriting the whole app or removing historical data merely to make the tree look cleaner. Database preservation and observable behavior take precedence over architectural symmetry.
