import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ModInfoPanel } from "../src/renderer/src/components/panels/ModInfoPanel";
import { buildActiveMods, buildModViews } from "../src/renderer/src/utils/activeMods";
import {
  indexMissingDependencies,
  missingDependencies,
  resolveDependencyTargets,
} from "../src/renderer/src/utils/dependencies";
import { activityPanels } from "../src/renderer/src/utils/library";
import { buildModListExportPackageIds } from "../src/renderer/src/utils/modListExport";
import { officialContentImageUrl } from "../src/shared/officialContent";
import type { Mod } from "../src/shared/types";
import { requireValue } from "../src/shared/validation";
import { createEmptyVault } from "../src/shared/vault";

const mod: Mod = {
  id: "steam-123",
  workshopId: "123",
  packageId: "author.qol",
  name: "Quality of life",
  author: "Author",
  source: "steam",
  summary: "Saved metadata",
  tags: [],
  gameVersions: [],
  screenshots: [],
  subscribed: true,
  downloadedAt: "",
  addedAt: "",
};

const noop = () => undefined;

void test("Active always exists, preserves game order and covers packages not in the saved library", () => {
  const result = buildActiveMods(
    { packageIds: ["ludeon.rimworld", "Author.QoL_steam", "another.package"] },
    [mod],
  );
  assert.equal(result.entries.length, 3);
  assert.equal(requireValue(result.entries[0]).packageId, "ludeon.rimworld");
  assert.equal(result.entries[1], mod);
  assert.equal(requireValue(result.entries[2]).name, "another.package");
  assert.equal(buildActiveMods({ packageIds: [], error: "Unavailable" }, []).entries.length, 0);
});

void test("Active prefers subscribed saved metadata, then updates after switching configuration", () => {
  const old = { ...mod, id: "old", subscribed: false };
  const current = buildActiveMods({ packageIds: ["author.qol"] }, [old, mod]);
  assert.equal(requireValue(current.entries[0]).id, mod.id);
  const next = buildActiveMods({ packageIds: ["ludeon.rimworld", "new.package"] }, [mod]);
  assert.ok(!next.entries.some((entry) => entry.id === mod.id));
  assert.equal(next.entries.length, 2);
});

void test("an unsaved installed local row retains its filesystem recency in the Library", () => {
  const downloadedAt = "2026-08-19T14:25:00.000Z";
  const views = buildModViews(
    {
      packageIds: [],
      installedMods: [
        {
          packageId: "author.local-only",
          localPath: "/game/Mods/LocalOnly",
          name: "Local only",
          downloadedAt,
        },
      ],
    },
    [],
  );

  const row = requireValue(
    views.allEntries.find((entry) => entry.packageId === "author.local-only"),
  );
  assert.equal(row.source, "local");
  assert.equal(row.localPath, "/game/Mods/LocalOnly");
  assert.equal(row.downloadedAt, downloadedAt);
  assert.equal(row.addedAt, "");
});

void test("filesystem discovery removes a stale Workshop identity from a saved local-path row", () => {
  const localPath = "/game/Mods/NowLocal";
  const stale = { ...mod, id: "steam-999", workshopId: "999", localPath };
  const installedMods = [{ packageId: mod.packageId ?? "author.qol", localPath }];
  const views = buildModViews(
    {
      packageIds: [mod.packageId ?? "author.qol"],
      installedMods,
    },
    [stale],
  );
  const discovered = requireValue(views.allEntries.find((entry) => entry.localPath === localPath));

  assert.notEqual(discovered.id, stale.id);
  assert.equal(discovered.source, "local");
  assert.equal(discovered.workshopId, undefined);
  assert.equal(discovered.subscribed, false);
  assert.deepEqual(buildModListExportPackageIds([discovered], installedMods), ["author.qol"]);
});

void test("Active and XML export round-trip the bare/local versus _steam/Workshop duplicate", () => {
  const packageId = "author.duplicate";
  const savedWorkshop = {
    ...mod,
    id: "steam-987",
    workshopId: "987",
    packageId,
    localPath: "/workshop/987",
  };
  const installedMods = [
    { packageId, localPath: "/game/Mods/Duplicate", name: "Local duplicate" },
    {
      packageId,
      workshopId: "987",
      localPath: "/workshop/987",
      name: "Workshop duplicate",
    },
  ];

  const localViews = buildModViews({ packageIds: [packageId], installedMods }, [savedWorkshop]);
  const localActive = requireValue(localViews.activeEntries[0]);
  assert.notEqual(localActive.id, savedWorkshop.id);
  assert.equal(localActive.source, "local");
  assert.equal(localActive.workshopId, undefined);
  assert.ok(localViews.allEntries.some((entry) => entry.id === "steam-987"));
  assert.deepEqual(buildModListExportPackageIds(localViews.activeEntries, installedMods), [
    packageId,
  ]);

  const workshopViews = buildModViews({ packageIds: [`${packageId}_steam`], installedMods }, [
    savedWorkshop,
  ]);
  assert.equal(requireValue(workshopViews.activeEntries[0]).id, savedWorkshop.id);
  assert.deepEqual(buildModListExportPackageIds(workshopViews.activeEntries, installedMods), [
    `${packageId}_steam`,
  ]);
});

void test("Active uses installed Workshop identity rather than stale saved dependency packages, in exact game order", () => {
  const saved = [
    { ...mod, id: "steam-10", workshopId: "10", packageId: "brrainz.harmony", name: "Achtung!" },
    {
      ...mod,
      id: "steam-20",
      workshopId: "20",
      packageId: "brrainz.harmony",
      name: "Harmony",
      thumbnail: "preview",
    },
    {
      ...mod,
      id: "steam-30",
      workshopId: "30",
      packageId: "ludeon.rimworld.royalty",
      name: "Another mod",
    },
  ];
  const before = JSON.stringify(saved);
  const active = buildActiveMods(
    {
      packageIds: [
        "brrainz.harmony",
        "loading.progress",
        "ludeon.rimworld",
        "ludeon.rimworld.royalty",
        "brrainz.achtung",
        "author.another",
      ],
      installedMods: [
        {
          packageId: "author.another",
          workshopId: "30",
          localPath: "/mods/30",
          name: "Another mod",
        },
        { packageId: "brrainz.achtung", workshopId: "10", localPath: "/mods/10", name: "Achtung!" },
        {
          packageId: "ludeon.rimworld.royalty",
          localPath: "/game/Data/Royalty",
          officialContent: true,
          name: "Royalty",
        },
        {
          packageId: "ludeon.rimworld",
          localPath: "/game/Data/Core",
          officialContent: true,
          name: "Core",
        },
        { packageId: "brrainz.harmony", workshopId: "20", localPath: "/mods/20", name: "Harmony" },
      ],
    },
    saved,
  );
  assert.deepEqual(
    active.entries.map((entry) => entry.name),
    ["Harmony", "loading.progress", "Core", "Royalty", "Achtung!", "Another mod"],
  );
  assert.deepEqual(
    active.entries.map((entry) => entry.packageId),
    [
      "brrainz.harmony",
      "loading.progress",
      "ludeon.rimworld",
      "ludeon.rimworld.royalty",
      "brrainz.achtung",
      "author.another",
    ],
  );
  assert.equal(requireValue(active.entries[0]).thumbnail, "preview");
  assert.equal(requireValue(active.entries[4]).id, "steam-10");
  assert.equal(JSON.stringify(saved), before);
});

void test("official active content cannot inherit a saved Workshop identity or stale artwork", () => {
  const packageId = "ludeon.rimworld.anomaly";
  const impostor: Mod = {
    ...mod,
    id: "steam-999",
    workshopId: "999",
    packageId,
    name: "Fake Anomaly",
    thumbnail: "https://example.test/wrong-artwork.png",
  };

  const placeholder = requireValue(
    buildActiveMods({ packageIds: [packageId] }, [impostor]).entries[0],
  );
  assert.equal(placeholder.id, `active-package:${packageId}`);
  assert.equal(placeholder.name, "RimWorld - Anomaly");
  assert.equal(placeholder.workshopId, undefined);
  assert.equal(placeholder.thumbnail, undefined);

  const thumbnail = requireValue(officialContentImageUrl(packageId));
  const installed = requireValue(
    buildActiveMods(
      {
        packageIds: [packageId],
        installedMods: [
          { packageId, localPath: "/game/Data/Anomaly", officialContent: true, thumbnail },
        ],
      },
      [impostor],
    ).entries[0],
  );
  assert.equal(installed.id, `active-package:${packageId}`);
  assert.equal(installed.workshopId, undefined);
  assert.equal(installed.thumbnail, thumbnail);

  const missingPreview = requireValue(
    buildActiveMods(
      {
        packageIds: [packageId],
        installedMods: [{ packageId, localPath: "/game/Data/Anomaly", officialContent: true }],
      },
      [impostor],
    ).entries[0],
  );
  assert.equal(missingPreview.thumbnail, undefined);
});

void test("activity panels cannot replace canonical official rows through a persisted ID collision", () => {
  const packageId = "ludeon.rimworld";
  const impostor: Mod = {
    ...mod,
    id: `active-package:${packageId}`,
    workshopId: "999",
    packageId,
    name: "Fake Core",
  };
  const views = buildModViews({ packageIds: [packageId] }, [impostor]);
  const panels = activityPanels(createEmptyVault(), views.allEntries, views.activeEntries);
  const active = requireValue(panels.active[0]);

  assert.equal(active.id, `active-package:${packageId}`);
  assert.equal(active.name, "RimWorld");
  assert.equal(active.workshopId, undefined);
  assert.ok(!views.allEntries.some((entry) => entry.name === "Fake Core"));
});

void test("scanner-approved official content wins duplicate installed package identities", () => {
  const packageId = "ludeon.rimworld.anomaly";
  const thumbnail = requireValue(officialContentImageUrl(packageId));
  const views = buildModViews(
    {
      packageIds: [packageId],
      installedMods: [
        {
          packageId,
          workshopId: "999",
          localPath: "/workshop/999",
          name: "Workshop impostor",
        },
        {
          packageId,
          localPath: "/game/Data/Anomaly",
          officialContent: true,
          name: "RimWorld - Anomaly",
          thumbnail,
        },
        {
          packageId,
          localPath: "/game/Mods/FakeAnomaly",
          name: "Local impostor",
        },
      ],
    },
    [],
  );

  const active = requireValue(views.activeEntries[0]);
  assert.equal(active.name, "RimWorld - Anomaly");
  assert.equal(active.localPath, "/game/Data/Anomaly");
  assert.equal(active.thumbnail, thumbnail);

  const canonical = requireValue(
    views.allEntries.find((entry) => entry.id === `active-package:${packageId}`),
  );
  assert.equal(canonical.name, "RimWorld - Anomaly");
  assert.equal(canonical.localPath, "/game/Data/Anomaly");
  assert.equal(canonical.thumbnail, thumbnail);
  assert.ok(views.allEntries.some((entry) => entry.id === "steam-999"));
  assert.ok(
    views.allEntries.some(
      (entry) =>
        entry.id.startsWith(`installed-local:${packageId}:`) && entry.name === "Local impostor",
    ),
  );

  const withoutPreview = requireValue(
    buildModViews(
      {
        packageIds: [packageId],
        installedMods: [
          { packageId, localPath: "/game/Mods/FakeAnomaly", name: "Local impostor" },
          {
            packageId,
            localPath: "/game/Data/Anomaly",
            officialContent: true,
            name: "RimWorld - Anomaly",
          },
        ],
      },
      [],
    ).activeEntries[0],
  );
  assert.equal(withoutPreview.name, "RimWorld - Anomaly");
  assert.equal(withoutPreview.localPath, "/game/Data/Anomaly");
  assert.equal(withoutPreview.thumbnail, undefined);
});

void test("active packages outside the library do not expose saved-mod or tag editing", () => {
  const entry = buildActiveMods({ packageIds: ["ludeon.rimworld"] }, []).entries[0];
  const html = renderToStaticMarkup(
    <ModInfoPanel
      mod={entry}
      active={true}
      isSaved={false}
      tags={[]}
      onRemoveModFromLibrary={noop}
      onAssignTag={noop}
      onCreateTag={noop}
    />,
  );
  assert.match(html, />Not subscribe<\/span>/);
  assert.match(html, /class="official-marker"/);
  assert.match(html, /lucide-shield-check/);
  assert.match(html, /Core<\/span>/);
  assert.doesNotMatch(html, /Active in RimWorld|class="active-pill"/);
  assert.doesNotMatch(html, /Remove saved mod|aria-label="Mod tags"/);
});

void test("active mods identify missing dependencies by normalized package id", () => {
  const dependent: Mod = {
    ...mod,
    dependencies: [
      { packageId: "brrainz.harmony", displayName: "Harmony" },
      { packageId: "author.framework", displayName: "Framework" },
      { packageId: "AUTHOR.FRAMEWORK" },
      { packageId: "author.legacy", displayName: "Legacy library", gameVersions: ["1.5"] },
    ],
  };
  assert.deepEqual(missingDependencies(dependent, ["BRRAINZ.HARMONY_steam"]), [
    { packageId: "AUTHOR.FRAMEWORK" },
  ]);
  assert.deepEqual(
    indexMissingDependencies([dependent], new Set([dependent.id]), ["brrainz.harmony"]).get(
      dependent.id,
    ),
    [{ packageId: "AUTHOR.FRAMEWORK" }],
  );
  assert.equal(indexMissingDependencies([dependent], new Set(), []).size, 0);
  assert.deepEqual(missingDependencies(dependent, ["brrainz.harmony"], "v1.6.4633 rev42"), [
    { packageId: "AUTHOR.FRAMEWORK" },
  ]);

  const versioned: Mod = {
    ...dependent,
    dependencies: [{ packageId: "author.base" }],
    dependenciesByVersion: [
      {
        gameVersion: "v1.6",
        dependencies: [{ packageId: "author.current", displayName: "Current framework" }],
      },
    ],
  };
  assert.deepEqual(missingDependencies(versioned, [], "1.6.4633 rev42"), [
    { packageId: "author.current", displayName: "Current framework" },
  ]);
  assert.deepEqual(missingDependencies(versioned, [], "1.5.4104"), [{ packageId: "author.base" }]);
});

void test("dependency fixes resolve normalized Library package IDs once", () => {
  const framework: Mod = {
    ...mod,
    id: "steam-framework",
    workshopId: "456",
    packageId: "author.framework",
    name: "Framework",
  };

  assert.deepEqual(
    resolveDependencyTargets(
      [
        { packageId: "AUTHOR.FRAMEWORK_steam", displayName: "Framework" },
        { packageId: "author.framework" },
      ],
      [framework],
    ),
    [framework],
  );
});

void test("dependency fixes reject unavailable and ambiguous Library packages", () => {
  const dependency = { packageId: "author.framework", displayName: "Framework" };
  assert.throws(
    () => resolveDependencyTargets([dependency], []),
    /Framework \(author\.framework\) is not available in Library/,
  );

  const first = { ...mod, id: "steam-framework-1", packageId: "author.framework" };
  const second = {
    ...mod,
    id: "steam-framework-2",
    workshopId: "456",
    packageId: "AUTHOR.FRAMEWORK_steam",
  };
  assert.throws(
    () => resolveDependencyTargets([dependency], [first, second]),
    /matches multiple Library mods/,
  );
});

void test("the info panel displays requirements and warns when an active dependency is missing", () => {
  const dependencies = [
    { packageId: "brrainz.harmony", displayName: "Harmony" },
    { packageId: "author.framework", displayName: "Framework" },
  ];
  const html = renderToStaticMarkup(
    <ModInfoPanel
      mod={{ ...mod, dependencies }}
      active
      missingDependencies={[requireValue(dependencies[0])]}
      onFixDependencies={noop}
      tags={[]}
      onRemoveModFromLibrary={noop}
      onAssignTag={noop}
      onCreateTag={noop}
    />,
  );
  assert.match(html, /aria-label="Mod requirements"/);
  assert.match(html, /role="status" aria-label="Dependency status"/);
  assert.match(html, /Missing active dependency/);
  assert.match(html, />Auto-fix dependencies<\/button>/);
  assert.match(html, /Harmony/);
  assert.match(html, /brrainz\.harmony/);
  assert.match(html, /Framework/);
  assert.match(html, />Missing</);
  assert.match(html, />Active</);
});
