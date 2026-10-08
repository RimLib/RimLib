# Contributing

## Toolchain

Use Node 24 (at least 24.21) and npm 11. `.nvmrc`, `.npmrc`, the engine declarations and `package-lock.json` define the supported toolchain. Use `npm ci` for a reproducible installation. Do not edit the lockfile manually.

## Required Checks

```bash
npm run format
npm run lint:fix
npm run quality
```

`quality` stops at the first failure and runs formatting verification, lint with zero warnings, TypeScript checks for both application processes and every test, unit/property tests, a production Electron build and Playwright Electron tests. It does not auto-fix files. Newly added top-level `tests/*.test.ts` and `tests/*.test.tsx` files are discovered automatically; helpers belong under `tests/helpers` or `tests/fixtures`. Native interaction tests belong under `tests/e2e/*.spec.ts` and run separately from Node's test runner.

Property-based tests are part of this same gate, not an optional CI job. Run just those with `npm run test:properties`. See [TESTING.md](TESTING.md) for generated invariants, replaying failures, and increasing the run budget.

Playwright is also required in the commit gate. Run it alone with `npm run test:e2e`; do not bypass failing UI tests. Install the Electron binary normally (do not set `ELECTRON_SKIP_BINARY_DOWNLOAD`). A desktop display is required; headless Linux uses `xvfb-run --auto-servernum npm run quality`. No separate Chromium browser download is needed. CI installs Linux system dependencies and uses a virtual display, and uploads the HTML report, traces, screenshots and test-only logs when checks fail.

Formatting is not a review preference: use the pinned Prettier configuration for TypeScript, JSX, JavaScript, CSS, JSON, Markdown and YAML. Imports are sorted automatically; type-only imports are explicit. All branches require braces. Unused declarations, unsafe `any` propagation, unchecked indexed access, non-null assertions, unhandled Promises, non-exhaustive switches and incorrect React hook dependencies are errors. Renderer/shared/privileged import boundaries are enforced by lint.

The baseline is [typescript-eslint's strict type-checked configuration](https://typescript-eslint.io/users/configs/#strict-type-checked), with [Prettier handling formatting separately](https://prettier.io/docs/integrating-with-linters). The sole test-specific relaxation allows `async` mocks with synchronous bodies to implement the real Promise-based API. Test safety rules otherwise remain enabled. Numeric template interpolation is permitted; objects and nullable values must be converted explicitly. Optional fields may explicitly contain `undefined` because clearing a setting or UI selection is an intentional operation.

Inline ESLint overrides are disabled. Do not add blanket TypeScript suppression, weaken the shared configuration, or use casts to hide an invalid boundary. External data starts as `unknown` and must be validated. Use explicit invariants only after the business rule has established that a value is required. A new exception needs a narrow scope, an explanation and regression coverage.

## Commit Enforcement

`npm ci`/`npm install` installs Husky hooks when this project is the Git root. If Git is initialized after dependencies are installed, run `npm run prepare` once. No Git repository is created automatically, and a parent repository's hook configuration is never modified.

The pre-commit hook runs the full quality gate against an isolated checkout of the **Git index**, using installed dependencies. It does not stash, rewrite or stage working files. A good unstaged edit cannot conceal a bad staged commit; partial staging is supported. Temporary checkouts are removed after completion. Install changed dependencies before committing a changed lockfile.

Git hooks are local guardrails and can be bypassed. The GitHub `Quality` workflow independently runs `npm ci` and the same gate on pushes and pull requests on Linux, macOS and Windows. When publishing, require all three `Quality (...)` status checks on the default branch, disallow direct pushes and restrict protection bypasses. Review dependency updates rather than auto-merging them; Dependabot proposals are configured separately. Hosted CI and branch protection cannot be verified until the repository exists on GitHub.

## Change Policy

- Keep domain operations pure, platform adapters narrow, and component props explicit. Follow [ARCHITECTURE.md](ARCHITECTURE.md) for ownership.
- Add focused regression tests for bug fixes, and broader tests for persistence, subscription safety or IPC changes. Do not depend on formatting-sensitive source strings when a behavioral test or AST check is available.
- Never run tests against a real user database, Workshop folder or Steam account. Use temporary directories, injected clients and request doubles. Native manual tests require explicit authorization and a backup.
- Preserve unknown database fields and historical snapshots. Changes to a schema require fixtures, migration tests, a checkpoint and a forward-version refusal test. Synchronization must not delete records.
- Treat disconnected disks, unavailable Steam, partial results and failed saves as normal failure states. Preserve displayed data and report errors without disabling unrelated UI.
- Do not put logs, database exports, credentials or installed mod content in commits. Review logs before sharing them.

## Before Release

The quality gate is not a security audit or a complete native UI test. Before public distribution, review Electron/Chromium and parser advisories, verify native Steam SDK packaging, test upgrades and shutdown with disposable databases, and exercise keyboard interaction and disk/Steam failure paths in Electron on each supported OS. Dependency advisory queries need network access; do not interpret an unavailable audit as a clean audit.
