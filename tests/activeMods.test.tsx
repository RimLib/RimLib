import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ModInfoPanel } from "../src/renderer/src/components/panels/ModInfoPanel";
import { buildActiveMods } from "../src/renderer/src/utils/activeMods";
import {
  indexMissingDependencies,
  missingDependencies,
} from "../src/renderer/src/utils/dependencies";
import type { Mod } from "../src/shared/types";
import { requireValue } from "../src/shared/validation";

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
        { packageId: "ludeon.rimworld.royalty", localPath: "/game/Data/Royalty", name: "Royalty" },
        { packageId: "ludeon.rimworld", localPath: "/game/Data/Core", name: "Core" },
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
  assert.match(html, /Not saved/);
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
  assert.deepEqual(missingDependencies(dependent, ["brrainz.harmony"], "1.6"), [
    { packageId: "AUTHOR.FRAMEWORK" },
  ]);
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
      tags={[]}
      onRemoveModFromLibrary={noop}
      onAssignTag={noop}
      onCreateTag={noop}
    />,
  );
  assert.match(html, /aria-label="Mod requirements"/);
  assert.match(html, /Missing active dependency/);
  assert.match(html, /Harmony/);
  assert.match(html, /brrainz\.harmony/);
  assert.match(html, /Framework/);
  assert.match(html, />Missing</);
  assert.match(html, />Active</);
});
