import assert from "node:assert/strict";
import { test } from "node:test";

import { type ModSortSuccess, sortActiveMods } from "../src/renderer/src/utils/modSort";
import type { Mod } from "../src/shared/types";

function mod(packageId: string | undefined, name: string, patch: Partial<Mod> = {}): Mod {
  return {
    id: patch.id ?? `mod-${packageId ?? name}`,
    packageId,
    name,
    author: "Author",
    source: "local",
    summary: "",
    gameVersions: [],
    tags: [],
    subscribed: false,
    downloadedAt: "",
    addedAt: "",
    screenshots: [],
    ...patch,
  };
}

function success(result: ReturnType<typeof sortActiveMods>): ModSortSuccess {
  if (!result.ok) {
    assert.fail(result.message);
  }
  return result;
}

function packageOrder(result: ModSortSuccess): (string | undefined)[] {
  return result.mods.map(({ packageId }) => packageId);
}

void test("explicit load-before and load-after rules produce topological levels with deterministic ties", () => {
  const active = [
    mod("author.finish", "Finish", {
      loadAfter: [{ packageId: "AUTHOR.LIBRARY_steam" }],
    }),
    mod("author.zebra", "Same name"),
    mod("author.library", "Library"),
    mod("author.alpha", "Same name", {
      loadBefore: [{ packageId: "author.finish" }],
    }),
  ];
  const result = success(sortActiveMods(active));

  assert.deepEqual(packageOrder(result), [
    "author.library",
    "author.alpha",
    "author.zebra",
    "author.finish",
  ]);
  assert.equal(result.stats.explicitRuleCount, 2);
  assert.equal(result.stats.topologicalLevelCount, 2);
  assert.deepEqual(
    active.map(({ packageId }) => packageId),
    ["author.finish", "author.zebra", "author.library", "author.alpha"],
  );
});

void test("applicable dependencies are inferred while a directly reversed explicit rule wins", () => {
  const result = success(
    sortActiveMods(
      [
        mod("author.addon", "Addon", {
          dependencies: [
            { packageId: "author.framework", gameVersions: ["v1.6"] },
            { packageId: "author.legacy", gameVersions: ["1.5"] },
          ],
        }),
        mod("author.framework", "Framework", {
          loadAfter: [{ packageId: "author.addon", gameVersions: ["1.6"] }],
        }),
        mod("author.legacy", "Legacy"),
      ],
      "1.6.4633 rev42",
    ),
  );

  assert.deepEqual(packageOrder(result), ["author.addon", "author.legacy", "author.framework"]);
  assert.equal(result.stats.explicitRuleCount, 1);
  assert.equal(result.stats.inferredDependencyCount, 0);
  assert.equal(result.stats.overriddenInferredDependencyCount, 1);
  assert.equal(result.warnings[0]?.code, "inferred-dependency-overridden");
});

void test("matching versioned dependencies replace base dependencies, including with an empty list", () => {
  const matching = success(
    sortActiveMods(
      [
        mod("author.addon", "Z Addon", {
          dependencies: [{ packageId: "author.base-only" }],
          dependenciesByVersion: [
            {
              gameVersion: "v1.6.9999",
              dependencies: [{ packageId: "author.patched-fallback" }],
            },
            {
              gameVersion: "v1.6",
              dependencies: [{ packageId: "author.framework" }],
            },
          ],
        }),
        mod("author.framework", "Framework"),
      ],
      "1.6.4633 rev42",
    ),
  );

  assert.equal(matching.stats.inferredDependencyCount, 1);
  assert.equal(matching.stats.ignoredMissingTargetCount, 0);
  assert.deepEqual(packageOrder(matching), ["author.framework", "author.addon"]);

  const empty = success(
    sortActiveMods(
      [
        mod("author.addon", "A Addon", {
          dependencies: [{ packageId: "author.framework" }],
          dependenciesByVersion: [{ gameVersion: "v1.6", dependencies: [] }],
        }),
        mod("author.framework", "Z Framework"),
      ],
      "1.6.4633",
    ),
  );

  assert.equal(empty.stats.inferredDependencyCount, 0);
  assert.deepEqual(packageOrder(empty), ["author.addon", "author.framework"]);
});

void test("matching ByVersion rules replace base rules while force rules always apply", () => {
  const matching = success(
    sortActiveMods(
      [
        mod("author.subject", "A Subject", {
          loadAfter: [{ packageId: "author.base-only" }],
          loadAfterByVersion: [
            {
              gameVersion: "v1.6.9999",
              rules: [{ packageId: "author.patched-fallback" }],
            },
            {
              gameVersion: "v1.6",
              rules: [{ packageId: "author.version-rule" }],
            },
          ],
          forceLoadAfter: [{ packageId: "author.forced-rule" }],
        }),
        mod("author.version-rule", "Version rule"),
        mod("author.forced-rule", "Forced rule"),
      ],
      "1.6.4633 rev42",
    ),
  );

  assert.equal(matching.stats.explicitRuleCount, 2);
  assert.equal(matching.stats.ignoredMissingTargetCount, 0);
  assert.deepEqual(packageOrder(matching), [
    "author.forced-rule",
    "author.version-rule",
    "author.subject",
  ]);

  const fallback = success(
    sortActiveMods(
      [
        mod("author.subject", "A Subject", {
          loadAfter: [{ packageId: "author.base-rule" }],
          loadAfterByVersion: [{ gameVersion: "v1.6", rules: [] }],
          forceLoadAfter: [{ packageId: "author.forced-rule" }],
        }),
        mod("author.base-rule", "Base rule"),
        mod("author.forced-rule", "Forced rule"),
      ],
      "1.5.4104",
    ),
  );

  assert.equal(fallback.stats.explicitRuleCount, 2);
  assert.deepEqual(packageOrder(fallback), [
    "author.base-rule",
    "author.forced-rule",
    "author.subject",
  ]);
});

void test("an empty matching ByVersion block suppresses the base rules", () => {
  const result = success(
    sortActiveMods(
      [
        mod("author.subject", "A Subject", {
          loadBefore: [{ packageId: "author.base-rule" }],
          loadBeforeByVersion: [{ gameVersion: "v1.6", rules: [] }],
        }),
        mod("author.base-rule", "Z Base rule"),
      ],
      "1.6.4633 rev42",
    ),
  );

  assert.equal(result.stats.explicitRuleCount, 0);
  assert.deepEqual(packageOrder(result), ["author.subject", "author.base-rule"]);
});

void test("Tier 0 contains RimWorld modules and their recursive prerequisites", () => {
  const result = success(
    sortActiveMods([
      mod("author.regular", "A regular mod"),
      mod("ludeon.rimworld", "Core", {
        dependencies: [{ packageId: "AUTHOR.BOOTSTRAP_steam" }],
      }),
      mod("author.bootstrap", "Framework", {
        dependencies: [{ packageId: "author.earliest" }],
      }),
      mod("brrainz.harmony", "Harmony"),
      mod("author.earliest", "Bootstrap"),
      mod("ludeon.rimworld.royalty", "Royalty"),
      mod("ludeon.rimworld.ideology", "Ideology"),
      mod("ludeon.rimworld.biotech", "Biotech"),
      mod("ludeon.rimworld.anomaly", "Anomaly"),
      mod("ludeon.rimworld.odyssey", "Odyssey"),
      mod("zetrith.prepatcher", "Prepatcher"),
      mod("brrainz.visualexceptions", "Visual Exceptions"),
    ]),
  );

  assert.deepEqual(packageOrder(result), [
    "zetrith.prepatcher",
    "author.earliest",
    "brrainz.harmony",
    "author.bootstrap",
    "brrainz.visualexceptions",
    "ludeon.rimworld",
    "ludeon.rimworld.royalty",
    "ludeon.rimworld.ideology",
    "ludeon.rimworld.biotech",
    "ludeon.rimworld.anomaly",
    "ludeon.rimworld.odyssey",
    "author.regular",
  ]);
  assert.equal(result.stats.tierZeroCount, 11);
  assert.equal(result.stats.inferredDependencyCount, 2);
});

void test("Tier 0 uses canonical package order instead of display names", () => {
  const result = success(
    sortActiveMods([
      mod("ludeon.rimworld.odyssey", "A Odyssey"),
      mod("ludeon.rimworld.anomaly", "B Anomaly"),
      mod("ludeon.rimworld.biotech", "C Biotech"),
      mod("ludeon.rimworld.ideology", "D Ideology"),
      mod("ludeon.rimworld.royalty", "E Royalty"),
      mod("ludeon.rimworld", "F Core"),
      mod("brrainz.visualexceptions", "G Visual Exceptions"),
      mod("brrainz.harmony", "H Harmony"),
      mod("zetrith.prepatcher", "I Prepatcher"),
    ]),
  );

  assert.deepEqual(packageOrder(result), [
    "zetrith.prepatcher",
    "brrainz.harmony",
    "brrainz.visualexceptions",
    "ludeon.rimworld",
    "ludeon.rimworld.royalty",
    "ludeon.rimworld.ideology",
    "ludeon.rimworld.biotech",
    "ludeon.rimworld.anomaly",
    "ludeon.rimworld.odyssey",
  ]);

  const constrained = success(
    sortActiveMods([
      mod("brrainz.harmony", "A Harmony"),
      mod("ludeon.rimworld", "Z Core", {
        loadBefore: [{ packageId: "brrainz.harmony" }],
      }),
    ]),
  );
  assert.deepEqual(packageOrder(constrained), ["ludeon.rimworld", "brrainz.harmony"]);
});

void test("missing targets are warned about and missing-package rows remain anchored", () => {
  const unknown = mod(undefined, "Unidentified", { id: "unknown" });
  const result = success(
    sortActiveMods([
      mod("author.zebra", "Zebra"),
      unknown,
      mod("author.alpha", "Alpha", {
        loadAfter: [{ packageId: "absent.rule" }],
        dependencies: [{ packageId: "absent.dependency" }],
      }),
    ]),
  );

  assert.equal(result.mods[1], unknown);
  assert.deepEqual(packageOrder(result), ["author.alpha", undefined, "author.zebra"]);
  assert.deepEqual(result.warnings.map(({ code }) => code).sort(), [
    "missing-dependency-target",
    "missing-package-id",
    "missing-rule-target",
  ]);
  assert.equal(result.stats.ignoredMissingTargetCount, 2);
  assert.equal(result.stats.missingPackageIdCount, 1);
});

void test("normalized duplicate package IDs return a structured failure without a proposed order", () => {
  const result = sortActiveMods([
    mod("Author.Example", "First", { id: "first" }),
    mod("author.example_steam", "Second", { id: "second" }),
  ]);

  if (result.ok) {
    assert.fail("Expected duplicate-package-id failure");
  }
  assert.equal(result.code, "duplicate-package-id");
  assert.deepEqual(result.duplicates, [
    {
      packageId: "author.example",
      modIds: ["first", "second"],
      names: ["First", "Second"],
    },
  ]);
  assert.equal("mods" in result, false);
});

void test("cycles return the involved package IDs and no proposed order", () => {
  const result = sortActiveMods([
    mod("author.a", "A", { loadAfter: [{ packageId: "author.b" }] }),
    mod("author.b", "B", { loadAfter: [{ packageId: "author.a" }] }),
    mod("author.free", "Free"),
  ]);

  if (result.ok) {
    assert.fail("Expected cycle failure");
  }
  assert.equal(result.code, "cycle");
  assert.deepEqual(result.cyclePackageIds, ["author.a", "author.b", "author.a"]);
  assert.deepEqual(result.cycleModIds, ["mod-author.a", "mod-author.b", "mod-author.a"]);
  assert.equal("mods" in result, false);
});

void test("sorting is case-insensitive, stable, and idempotent", () => {
  const initial = [
    mod("author.Z", "Same"),
    mod("AUTHOR.a", "same"),
    mod("author.middle", "Middle"),
  ];
  const first = success(sortActiveMods(initial));
  const second = success(sortActiveMods(first.mods));

  assert.deepEqual(packageOrder(first), ["author.middle", "AUTHOR.a", "author.Z"]);
  assert.deepEqual(second.mods, first.mods);
  assert.equal(second.stats.movedCount, 0);
});
