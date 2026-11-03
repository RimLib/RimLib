import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { AutoSortDependenciesModal } from "../src/renderer/src/components/modals/AutoSortDependenciesModal";
import {
  autoSortDependencyPlanKey,
  autoSortDependencyStatuses,
  buildAutoSortDependencyPlan,
  canStageAutoSortDependency,
} from "../src/renderer/src/utils/autoSortDependencies";
import type { Mod } from "../src/shared/types";
import { requireValue } from "../src/shared/validation";

const mod = (id: string, packageId: string, name = id): Mod => ({
  id,
  workshopId: id,
  packageId,
  name,
  author: "Author",
  source: "steam",
  summary: "Summary",
  tags: [],
  gameVersions: [],
  screenshots: [],
  subscribed: true,
  downloadedAt: "",
  addedAt: "",
});
const noop = () => undefined;

void test("auto-sort only offers Workshop dependencies whose subscription can be staged", () => {
  const unsaved = { ...mod("301", "author.unsaved"), subscribed: false };
  const saved = new Set<string>();

  assert.equal(canStageAutoSortDependency(unsaved, saved), false);
  assert.equal(canStageAutoSortDependency({ ...unsaved, subscribed: true }, saved), true);
  assert.equal(canStageAutoSortDependency(unsaved, new Set([unsaved.id])), true);
  assert.equal(
    canStageAutoSortDependency({ ...unsaved, workshopId: undefined, source: "local" }, saved),
    true,
  );
});

void test("auto-sort dependency planning groups declarations and separates resolvable targets", () => {
  const first = {
    ...mod("first", "author.first", "First active mod"),
    dependencies: [
      { packageId: "AUTHOR.FRAMEWORK_steam", displayName: "Framework" },
      { packageId: "author.missing", displayName: "Missing library" },
      { packageId: "author.ambiguous", displayName: "Ambiguous library" },
    ],
  };
  const second = {
    ...mod("second", "author.second", "Second active mod"),
    dependencies: [{ packageId: "author.framework" }],
  };
  const framework = mod("framework", "author.framework", "Framework in Library");
  const duplicateA = mod("duplicate-a", "author.ambiguous");
  const duplicateB = mod("duplicate-b", "AUTHOR.AMBIGUOUS_steam");

  const plan = buildAutoSortDependencyPlan([first, second], [framework, duplicateA, duplicateB]);

  assert.equal(plan.entries.length, 3);
  assert.equal(plan.affectedModCount, 2);
  assert.deepEqual(plan.availableMods, [framework]);
  assert.deepEqual(
    plan.availableEntries.map((entry) => entry.packageId),
    ["author.framework"],
  );
  assert.deepEqual(
    plan.unresolvedEntries.map((entry) => [entry.packageId, entry.status]),
    [
      ["author.missing", autoSortDependencyStatuses.unavailable],
      ["author.ambiguous", autoSortDependencyStatuses.ambiguous],
    ],
  );
  const frameworkEntry = requireValue(
    plan.entries.find((entry) => entry.packageId === "author.framework"),
  );
  assert.equal(frameworkEntry.dependency.displayName, "Framework");
  assert.deepEqual(
    frameworkEntry.requiredBy.map((entry) => entry.id),
    ["first", "second"],
  );
});

void test("auto-sort dependency planning follows the game version and projected Active packages", () => {
  const activeFramework = mod("framework", "author.framework", "Active framework");
  const dependent = {
    ...mod("dependent", "author.dependent"),
    dependencies: [{ packageId: "author.fallback" }],
    dependenciesByVersion: [
      {
        gameVersion: "1.6",
        dependencies: [
          { packageId: "author.framework" },
          { packageId: "author.current", displayName: "Current dependency" },
        ],
      },
    ],
  };
  const current = mod("current", "author.current");

  const plan = buildAutoSortDependencyPlan(
    [dependent, activeFramework],
    [current],
    "v1.6.4633 rev42",
  );

  assert.deepEqual(
    plan.entries.map((entry) => entry.packageId),
    ["author.current"],
  );
  assert.deepEqual(plan.availableMods, [current]);
});

void test("auto-sort dependency planning follows available dependency chains before sorting", () => {
  const active = {
    ...mod("active", "author.active", "Active feature"),
    dependencies: [{ packageId: "author.framework", displayName: "Framework" }],
  };
  const framework = {
    ...mod("framework", "author.framework", "Framework"),
    dependencies: [{ packageId: "author.foundation", displayName: "Foundation" }],
  };
  const foundation = mod("foundation", "author.foundation", "Foundation");

  const plan = buildAutoSortDependencyPlan([active], [framework, foundation]);

  assert.deepEqual(
    plan.entries.map((entry) => [entry.packageId, entry.requiredBy.map((mod) => mod.id)]),
    [
      ["author.framework", [active.id]],
      ["author.foundation", [framework.id]],
    ],
  );
  assert.deepEqual(
    plan.availableMods.map((entry) => entry.id),
    [framework.id, foundation.id],
  );
  assert.equal(plan.affectedModCount, 2);
});

void test("missing-dependency modal explains partial resolution and exposes both sort choices", () => {
  const active = {
    ...mod("active", "author.active", "Dependent mod"),
    dependencies: [
      { packageId: "author.framework", displayName: "Framework" },
      { packageId: "author.missing", displayName: "Missing library" },
    ],
  };
  const framework = mod("framework", "author.framework", "Framework in Library");
  const plan = buildAutoSortDependencyPlan([active], [framework]);
  const html = renderToStaticMarkup(
    <AutoSortDependenciesModal
      plan={plan}
      onClose={noop}
      onSortWithoutAdding={noop}
      onAddAndSort={noop}
    />,
  );

  assert.match(html, /role="dialog"/);
  assert.match(html, /Missing dependencies/);
  assert.match(html, /2.*missing dependencies.*1.*Active.*mod/);
  assert.match(html, /Framework/);
  assert.match(html, /author\.framework/);
  assert.match(html, /Required by Dependent mod/);
  assert.match(html, /Available in Library/);
  assert.match(html, /Not available in Library/);
  assert.match(html, /1 dependency cannot.*added automatically/);
  assert.match(html, /Sort current list/);
  assert.match(html, /Add 1 &amp; sort/);
});

void test("add-and-sort is disabled when no missing dependency has one Library match", () => {
  const active = {
    ...mod("active", "author.active"),
    dependencies: [{ packageId: "author.missing", displayName: "Missing library" }],
  };
  const html = renderToStaticMarkup(
    <AutoSortDependenciesModal
      plan={buildAutoSortDependencyPlan([active], [])}
      onClose={noop}
      onSortWithoutAdding={noop}
      onAddAndSort={noop}
    />,
  );
  assert.match(html, /disabled=""[^>]*>[^<]*<svg[\s\S]*Add 0 &amp; sort/);
});

void test("dependency review snapshots change with targets, requirements and readiness", () => {
  const active = {
    ...mod("active", "author.active", "Dependent mod"),
    dependencies: [{ packageId: "author.framework", displayName: "Framework" }],
  };
  const framework = mod("framework", "author.framework", "Framework in Library");
  const plan = buildAutoSortDependencyPlan([active], [framework]);
  assert.equal(
    autoSortDependencyPlanKey(plan),
    autoSortDependencyPlanKey(buildAutoSortDependencyPlan([active], [framework])),
  );
  assert.notEqual(
    autoSortDependencyPlanKey(plan),
    autoSortDependencyPlanKey(buildAutoSortDependencyPlan([active], [])),
  );

  const html = renderToStaticMarkup(
    <AutoSortDependenciesModal
      plan={plan}
      decisionDisabledReason="Installed mod details are still loading."
      onClose={noop}
      onSortWithoutAdding={noop}
      onAddAndSort={noop}
    />,
  );
  assert.match(html, /Installed mod details are still loading/);
  assert.match(html, /Sort current list<\/button>/);
  assert.match(html, /disabled=""[^>]*>[\s\S]*Sort current list/);
  assert.match(html, /Add 1 &amp; sort/);
});
