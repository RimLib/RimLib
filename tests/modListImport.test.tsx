import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ImportModListModal } from "../src/renderer/src/components/modals/ImportModListModal";
import {
  buildModListImportPlan,
  importChoiceReasons,
  type ImportedModListFile,
  InvalidModListImportError,
  modListImportBaselineError,
  modListImportPlanKey,
} from "../src/renderer/src/utils/modListImport";
import type { Mod } from "../src/shared/types";
import { requireValue } from "../src/shared/validation";

function mod(
  id: string,
  packageId: string,
  source: Mod["source"] = "local",
  extra: Partial<Mod> = {},
): Mod {
  return {
    id,
    packageId,
    name: id,
    author: "Author",
    source,
    summary: "Summary",
    gameVersions: [],
    tags: [],
    subscribed: source === "steam",
    downloadedAt: "",
    addedAt: "",
    screenshots: [],
    ...extra,
  };
}

function imported(
  packageIds: readonly string[],
  extra: Partial<ImportedModListFile> = {},
): ImportedModListFile {
  return {
    fileName: "example.xml",
    gameVersion: "1.6",
    packageIds,
    knownExpansions: [],
    ...extra,
  };
}

const noop = () => undefined;

const corePackageId = "ludeon.rimworld";

function coreMod(): Mod {
  return mod("active-package:ludeon.rimworld", corePackageId);
}

void test("import planning keeps file order, normalized matches, missing order and exact row changes", () => {
  const core = mod("active-package:ludeon.rimworld", "ludeon.rimworld");
  const current = mod("current-copy", "Author.Current");
  const removed = mod("removed", "author.removed");
  const added = mod("added", "author.added", "manual");

  const plan = buildModListImportPlan(
    imported(["LUDEON.RIMWORLD", "AUTHOR.CURRENT_steam", "Author.Missing", "author.added"]),
    [core, current, removed, added],
    [core, current, removed],
    "v1.6.4633 rev42",
  );

  assert.deepEqual(
    plan.targetMods.map((entry) => entry.id),
    [core.id, current.id, added.id],
  );
  assert.deepEqual(plan.availablePackageIds, [
    "LUDEON.RIMWORLD",
    "AUTHOR.CURRENT_steam",
    "author.added",
  ]);
  assert.deepEqual(plan.missingPackageIds, ["Author.Missing"]);
  assert.deepEqual(
    plan.activatedMods.map((entry) => entry.id),
    [added.id],
  );
  assert.deepEqual(
    plan.deactivatedMods.map((entry) => entry.id),
    [removed.id],
  );
  assert.equal(plan.versionMismatch, undefined);
});

void test("_steam selects a Workshop copy ahead of an active local copy and reports the swap", () => {
  const core = coreMod();
  const local = mod("local-copy", "author.camera", "local", { localPath: "/mods/camera" });
  const workshop = mod("steam-123", "author.camera", "steam", {
    workshopId: "123",
    localPath: "/workshop/123",
  });

  const plan = buildModListImportPlan(
    imported([corePackageId, "AUTHOR.CAMERA_steam"]),
    [core, local, workshop],
    [core, local],
  );

  assert.deepEqual(
    plan.targetMods.map((entry) => entry.id),
    [core.id, workshop.id],
  );
  assert.equal(requireValue(plan.targetMods[1]).packageId, "author.camera_steam");
  assert.equal(requireValue(plan.activatedMods[0]).id, workshop.id);
  assert.equal(requireValue(plan.activatedMods[0]).packageId, "author.camera_steam");
  assert.deepEqual(plan.deactivatedMods, [local]);
  assert.equal(plan.duplicateChoices.length, 1);
  const choice = requireValue(plan.duplicateChoices[0]);
  assert.equal(choice.selected, workshop);
  assert.equal(choice.reason, importChoiceReasons.steamHint);
  assert.deepEqual(
    choice.candidates.map((entry) => entry.id),
    [workshop.id, local.id],
  );
});

void test("_steam never prefers an unactionable stale Steam row", () => {
  const core = coreMod();
  const local = mod("local-copy", "author.camera", "local", { localPath: "/mods/camera" });
  const stale = mod("stale-steam", "author.camera", "steam", { workshopId: "not-numeric" });

  const plan = buildModListImportPlan(
    imported([corePackageId, "author.camera_steam"]),
    [core, local, stale],
    [core],
  );

  assert.equal(plan.targetMods[1], local);
  assert.equal(plan.duplicateChoices.length, 0);
});

void test("preview omits an unsaved inactive Workshop row that staging cannot subscribe", () => {
  const core = coreMod();
  const discovered = mod("steam-123", "author.discovered", "steam", {
    workshopId: "123",
    localPath: "/workshop/123",
    subscribed: false,
  });

  const unavailable = buildModListImportPlan(
    imported([corePackageId, "author.discovered"]),
    [core, discovered],
    [core],
    "1.6",
    new Set([core.id]),
  );
  assert.deepEqual(unavailable.targetMods, [core]);
  assert.deepEqual(unavailable.missingPackageIds, ["author.discovered"]);

  const saved = buildModListImportPlan(
    imported([corePackageId, "author.discovered"]),
    [core, discovered],
    [core],
    "1.6",
    new Set([core.id, discovered.id]),
  );
  assert.equal(saved.targetMods[1], discovered);
});

void test("bare package IDs select a non-Workshop duplicate before current-active priority", () => {
  const core = coreMod();
  const local = mod("local-copy", "author.camera", "local");
  const manual = mod("manual-copy", "author.camera", "manual");
  const workshop = mod("steam-123", "author.camera_steam", "steam", { workshopId: "123" });

  const activePlan = buildModListImportPlan(
    imported([corePackageId, "author.camera"]),
    [core, local, manual, workshop],
    [core, workshop],
  );
  assert.equal(activePlan.targetMods[1], local);
  assert.equal(
    requireValue(activePlan.duplicateChoices[0]).reason,
    importChoiceReasons.nonSteamHint,
  );

  const priorityPlan = buildModListImportPlan(
    imported([corePackageId, "author.camera"]),
    [core, workshop, manual, local],
    [core],
  );
  assert.equal(priorityPlan.targetMods[1], local);
  assert.equal(
    requireValue(priorityPlan.duplicateChoices[0]).reason,
    importChoiceReasons.nonSteamHint,
  );

  const activeManualPlan = buildModListImportPlan(
    imported([corePackageId, "author.camera"]),
    [core, local, manual, workshop],
    [core, manual],
  );
  assert.equal(activeManualPlan.targetMods[1], manual);
  assert.equal(
    requireValue(activeManualPlan.duplicateChoices[0]).reason,
    importChoiceReasons.nonSteamHint,
  );
});

void test("candidate selection uses official then local/manual/Workshop priority deterministically", () => {
  const fakeCore = mod("manual-core", "ludeon.rimworld", "manual");
  const officialCore = mod("active-package:ludeon.rimworld", "LUDEON.RIMWORLD", "local");
  const localB = mod("b-local", "author.same", "local");
  const localA = mod("a-local", "author.same", "local");

  const plan = buildModListImportPlan(
    imported(["ludeon.rimworld", "author.same"]),
    [fakeCore, localB, officialCore, localA],
    [],
  );

  assert.equal(requireValue(plan.targetMods[0]).id, officialCore.id);
  assert.equal(requireValue(plan.targetMods[0]).packageId, corePackageId);
  assert.equal(plan.targetMods[1], localA);
});

void test("official packages reject _steam and never resolve to Workshop impostors", () => {
  const officialCore = coreMod();
  const anomaly = mod("active-package:ludeon.rimworld.anomaly", "ludeon.rimworld.anomaly", "local");
  const fakeCore = mod("steam-1", corePackageId, "steam", { workshopId: "1" });
  const fakeAnomaly = mod("steam-2", "ludeon.rimworld.anomaly", "steam", {
    workshopId: "2",
  });

  for (const packageIds of [
    [`${corePackageId}_steam`],
    [corePackageId, "ludeon.rimworld.anomaly_steam"],
  ]) {
    assert.throws(
      () => buildModListImportPlan(imported(packageIds), [officialCore, anomaly], []),
      /official RimWorld content cannot use the _steam marker/,
    );
  }

  const plan = buildModListImportPlan(
    imported([corePackageId, "ludeon.rimworld.anomaly"]),
    [fakeCore, fakeAnomaly, anomaly, officialCore],
    [],
  );
  assert.deepEqual(
    plan.targetMods.map((entry) => entry.id),
    [officialCore.id, anomaly.id],
  );
  assert.deepEqual(plan.duplicateChoices, []);
});

void test("planner reports major/minor version mismatches without blocking the plan", () => {
  const core = mod("active-package:ludeon.rimworld", "ludeon.rimworld");
  const plan = buildModListImportPlan(
    imported(["ludeon.rimworld"], { gameVersion: "1.5" }),
    [core],
    [core],
    "v1.6.4633 rev42",
  );

  assert.deepEqual(plan.versionMismatch, {
    importedVersion: "1.5",
    currentVersion: "v1.6.4633 rev42",
    importedComparableVersion: "1.5",
    currentComparableVersion: "1.6",
  });
});

void test("import plan keys detect inventory and duplicate-choice changes before confirmation", () => {
  const core = coreMod();
  const local = mod("local", "author.camera", "local");
  const workshop = mod("steam-123", "author.camera", "steam", { workshopId: "123" });
  const file = imported([corePackageId, "author.camera"]);
  const reviewed = buildModListImportPlan(file, [core, local], [core]);
  const refreshed = buildModListImportPlan(file, [core, local, workshop], [core]);

  assert.notEqual(modListImportPlanKey(reviewed), modListImportPlanKey(refreshed));
  assert.equal(
    modListImportPlanKey(reviewed),
    modListImportPlanKey(buildModListImportPlan(file, [core, local], [core])),
  );
});

void test("import plan keys detect a pure Active reorder and action-relevant metadata drift", () => {
  const core = coreMod();
  const first = mod("first", "author.first", "local");
  const second = mod("second", "author.second", "local");
  const workshop = mod("steam-123", "author.workshop", "steam", {
    workshopId: "123",
    subscribed: false,
  });
  const orderedFile = imported([corePackageId, "author.first", "author.second"]);
  const reviewed = buildModListImportPlan(
    orderedFile,
    [core, first, second],
    [core, first, second],
  );
  const reordered = buildModListImportPlan(
    orderedFile,
    [core, first, second],
    [core, second, first],
  );
  assert.notEqual(modListImportPlanKey(reviewed), modListImportPlanKey(reordered));

  const workshopFile = imported([corePackageId, "author.workshop"]);
  const unsubscribed = buildModListImportPlan(
    workshopFile,
    [core, workshop],
    [core],
    undefined,
    new Set([core.id, workshop.id]),
  );
  const subscribed = buildModListImportPlan(
    workshopFile,
    [core, { ...workshop, subscribed: true }],
    [core],
    undefined,
    new Set([core.id, workshop.id]),
  );
  assert.notEqual(modListImportPlanKey(unsubscribed), modListImportPlanKey(subscribed));
});

void test("renderer validation rejects malformed and duplicate normalized package IDs", () => {
  assert.throws(
    () =>
      buildModListImportPlan(
        imported([corePackageId, "Author.Same", " AUTHOR.SAME_steam "]),
        [],
        [],
      ),
    (error) =>
      error instanceof InvalidModListImportError &&
      error.message.includes("duplicate package ID AUTHOR.SAME_steam"),
  );
  assert.throws(
    () => buildModListImportPlan(imported([corePackageId, "author.good", "not a package"]), [], []),
    (error) =>
      error instanceof InvalidModListImportError &&
      error.message.includes("activeMods contains an invalid package ID"),
  );
  assert.throws(
    () => buildModListImportPlan(imported([corePackageId, "_steam"]), [], []),
    /activeMods contains an invalid package ID/,
  );
  assert.throws(
    () =>
      buildModListImportPlan(
        { ...imported([]), packageIds: "not-an-array" } as unknown as ImportedModListFile,
        [],
        [],
      ),
    (error) =>
      error instanceof InvalidModListImportError &&
      error.message.includes("activeMods must be a list"),
  );
  assert.throws(
    () => buildModListImportPlan(imported(["author.good"]), [], []),
    (error) =>
      error instanceof InvalidModListImportError &&
      error.message.includes("must contain RimWorld Core exactly once"),
  );
  assert.throws(
    () =>
      buildModListImportPlan(
        { ...imported([corePackageId]), knownExpansions: ["ludeon.rimworld.royalty_steam"] },
        [],
        [],
      ),
    /official RimWorld content cannot use the _steam marker/,
  );
});

void test("import availability rejects baselines the draft store cannot stage", () => {
  assert.equal(modListImportBaselineError([corePackageId, "author.valid"]), undefined);
  assert.match(
    requireValue(modListImportBaselineError([corePackageId, "Author.Same", "author.same_steam"])),
    /duplicate package IDs/,
  );
  assert.match(
    requireValue(modListImportBaselineError([corePackageId, "_steam"])),
    /invalid package ID/,
  );
});

void test("import preview fully discloses missing packages, version and duplicate-copy choices", () => {
  const core = coreMod();
  const local = mod("local-copy", "author.camera", "local");
  const workshop = mod("steam-123", "author.camera", "steam", { workshopId: "123" });
  const old = mod("old", "author.old");
  const plan = buildModListImportPlan(
    imported([corePackageId, "author.camera_steam", "author.missing"], {
      fileName: "unsafe <img>.xml",
      gameVersion: "1.5",
    }),
    [core, local, workshop, old],
    [core, local, old],
    "1.6",
  );
  const html = renderToStaticMarkup(
    <ImportModListModal plan={plan} onClose={noop} onConfirm={noop} />,
  );

  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-labelledby="import-mod-list-title"/);
  assert.match(html, /Load RimWorld mod list/);
  assert.match(html, /unsafe &lt;img&gt;\.xml/);
  assert.match(html, /Exported game/);
  assert.match(html, />1\.5</);
  assert.match(html, /Available in RimLib/);
  assert.match(html, /Current mods to deactivate/);
  assert.match(html, /This list targets RimWorld 1\.5/);
  assert.match(html, /RimLib will not subscribe, download, or invent/);
  assert.match(html, /aria-label="Unavailable package IDs"/);
  assert.match(html, /author\.missing/);
  assert.match(html, /max-h-\[min\(240px,32vh\)\].*overflow-auto/);
  assert.match(html, /Duplicate physical copies resolved/);
  assert.match(html, /the _steam suffix prefers a Workshop copy/);
  assert.match(html, /Stage 2 available mods only/);
  assert.match(html, /Nothing changes in RimWorld until you apply the staged draft/);
  assert.match(html, /autofocus=""/);
});

void test("import preview disables confirmation when none of the file's packages are available", () => {
  const plan = buildModListImportPlan(imported([corePackageId, "author.missing"]), [], []);
  const html = renderToStaticMarkup(
    <ImportModListModal plan={plan} onClose={noop} onConfirm={noop} />,
  );

  assert.match(html, /disabled=""[^>]*>[\s\S]*Stage 0 available mods only/);
});

void test("import preview explains a temporary confirmation block while keeping Cancel available", () => {
  const core = coreMod();
  const plan = buildModListImportPlan(imported([corePackageId]), [core], [core]);
  const html = renderToStaticMarkup(
    <ImportModListModal
      plan={plan}
      confirmDisabledReason="Installed mod details are still loading"
      onClose={noop}
      onConfirm={noop}
    />,
  );

  assert.match(html, /Installed mod details are still loading/);
  assert.match(html, /<button[^>]*autofocus=""[^>]*>Cancel<\/button>/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>[\s\S]*Stage 1 mod/);
});
