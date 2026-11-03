import assert from "node:assert/strict";
import { test } from "node:test";

import { reconcileInstalledModMetadata } from "../src/renderer/src/utils/installedModPersistence";
import type { InstalledModMetadata, Mod, ModVault } from "../src/shared/types";
import { createEmptyVault } from "../src/shared/vault";

const observedAt = "2026-10-13T08:30:00.000Z";

function mod(overrides: Partial<Mod> = {}): Mod {
  return {
    id: "steam-123",
    workshopId: "123",
    packageId: "author.original",
    name: "Saved name",
    author: "Saved author",
    source: "steam",
    summary: "Saved summary",
    tags: ["Steam", "Remote tag"],
    userTagIds: ["personal-tag"],
    gameVersions: ["1.5"],
    screenshots: ["https://example.test/screenshot.png"],
    subscribed: true,
    downloadedAt: "2026-09-01T00:00:00.000Z",
    addedAt: "2026-01-01T00:00:00.000Z",
    notes: "Personal notes",
    thumbnail: "https://example.test/preview.png",
    metadataUpdatedAt: "2026-09-02T00:00:00.000Z",
    steamCreatorId: "456",
    steamPublishedAt: "2025-01-01T00:00:00.000Z",
    steamUpdatedAt: "2026-09-03T00:00:00.000Z",
    fileSize: 42,
    localPath: "/old/workshop/123",
    url: "https://steamcommunity.com/sharedfiles/filedetails/?id=123",
    ...overrides,
  };
}

function vault(mods: Mod[], observedIds: string[] = []): ModVault {
  return {
    ...createEmptyVault(),
    mods,
    userTags: [{ id: "personal-tag", name: "Personal", color: "#123456" }],
    localSteamState: { observedIds, pending: {} },
  };
}

void test("installed Workshop metadata updates scanner fields while preserving personal and remote fields", () => {
  const saved = mod();
  const untouched = mod({ id: "steam-999", workshopId: "999", name: "Absent saved mod" });
  const current = vault([saved, untouched], ["123"]);
  const installed: InstalledModMetadata = {
    packageId: "author.changed",
    workshopId: "123",
    localPath: "/current/workshop/123",
    downloadedAt: "2026-10-12T21:48:39.000Z",
    name: "About.xml name",
    author: "About.xml author",
    summary: "About.xml description",
    dependencies: [{ packageId: "dependency.base", displayName: "Base dependency" }],
    dependenciesByVersion: [
      {
        gameVersion: "1.6",
        dependencies: [{ packageId: "dependency.versioned" }],
      },
    ],
    loadAfter: [{ packageId: "load.before.this" }],
    loadAfterByVersion: [{ gameVersion: "1.6", rules: [{ packageId: "versioned.before.this" }] }],
    forceLoadAfter: [{ packageId: "always.before.this" }],
    loadBefore: [{ packageId: "load.after.this" }],
    loadBeforeByVersion: [{ gameVersion: "1.6", rules: [{ packageId: "versioned.after.this" }] }],
    forceLoadBefore: [{ packageId: "always.after.this" }],
    gameVersions: ["1.6"],
    // This field is intentionally not scanner-owned for persisted non-official rows.
    thumbnail: "rimlib-official-image://preview/invalid",
  };

  const next = reconcileInstalledModMetadata(current, [installed], observedAt);
  const refreshed = next.mods[0];

  assert.notEqual(next, current);
  assert.ok(refreshed);
  assert.notEqual(refreshed, saved);
  assert.equal(next.mods[1], untouched);
  assert.equal(refreshed.id, "steam-123");
  assert.equal(refreshed.packageId, installed.packageId);
  assert.equal(refreshed.localPath, installed.localPath);
  assert.equal(refreshed.downloadedAt, installed.downloadedAt);
  assert.equal(refreshed.name, installed.name);
  assert.equal(refreshed.author, installed.author);
  assert.equal(refreshed.summary, installed.summary);
  assert.deepEqual(refreshed.dependencies, installed.dependencies);
  assert.deepEqual(refreshed.dependenciesByVersion, installed.dependenciesByVersion);
  assert.deepEqual(refreshed.loadAfter, installed.loadAfter);
  assert.deepEqual(refreshed.loadAfterByVersion, installed.loadAfterByVersion);
  assert.deepEqual(refreshed.forceLoadAfter, installed.forceLoadAfter);
  assert.deepEqual(refreshed.loadBefore, installed.loadBefore);
  assert.deepEqual(refreshed.loadBeforeByVersion, installed.loadBeforeByVersion);
  assert.deepEqual(refreshed.forceLoadBefore, installed.forceLoadBefore);
  assert.deepEqual(refreshed.gameVersions, installed.gameVersions);
  assert.equal(refreshed.subscribed, true);

  assert.equal(refreshed.addedAt, saved.addedAt);
  assert.equal(refreshed.notes, saved.notes);
  assert.deepEqual(refreshed.tags, saved.tags);
  assert.deepEqual(refreshed.userTagIds, saved.userTagIds);
  assert.equal(refreshed.thumbnail, saved.thumbnail);
  assert.deepEqual(refreshed.screenshots, saved.screenshots);
  assert.equal(refreshed.url, saved.url);
  assert.equal(refreshed.metadataUpdatedAt, saved.metadataUpdatedAt);
  assert.equal(refreshed.steamCreatorId, saved.steamCreatorId);
  assert.equal(refreshed.steamPublishedAt, saved.steamPublishedAt);
  assert.equal(refreshed.steamUpdatedAt, saved.steamUpdatedAt);
  assert.equal(refreshed.fileSize, saved.fileSize);
  assert.equal(saved.localPath, "/old/workshop/123");
});

void test("an identical installed observation is a reference-preserving semantic no-op", () => {
  const dependencies = [{ packageId: "dependency.base", displayName: "Base" }];
  const saved = mod({
    packageId: "author.same",
    localPath: "/workshop/123",
    downloadedAt: "2026-10-12T00:00:00.000Z",
    name: "Same",
    author: "Same author",
    summary: "Same summary",
    dependencies,
    dependenciesByVersion: [],
    loadAfter: [],
    loadAfterByVersion: [],
    forceLoadAfter: [],
    loadBefore: [],
    loadBeforeByVersion: [],
    forceLoadBefore: [],
    gameVersions: ["1.6"],
  });
  const current = vault([saved], ["123"]);
  const installed: InstalledModMetadata = {
    packageId: "author.same",
    workshopId: saved.workshopId,
    localPath: "/workshop/123",
    downloadedAt: saved.downloadedAt,
    name: saved.name,
    author: saved.author,
    summary: saved.summary,
    dependencies: structuredClone(dependencies),
    dependenciesByVersion: [],
    loadAfter: [],
    loadAfterByVersion: [],
    forceLoadAfter: [],
    loadBefore: [],
    loadBeforeByVersion: [],
    forceLoadBefore: [],
    gameVersions: ["1.6"],
  };

  assert.equal(reconcileInstalledModMetadata(current, [installed], observedAt), current);
  const newer = { ...installed, downloadedAt: "2026-10-13T00:00:00.000Z" };
  const once = reconcileInstalledModMetadata(current, [newer], observedAt);
  assert.notEqual(once, current);
  assert.equal(
    reconcileInstalledModMetadata(
      once,
      [{ ...newer, dependencies: structuredClone(dependencies) }],
      observedAt,
    ),
    once,
  );
});

void test("new non-official Workshop and local rows share one observation time and official content stays transient", () => {
  const current = vault([], ["456"]);
  const next = reconcileInstalledModMetadata(
    current,
    [
      {
        packageId: "author.workshop",
        workshopId: "456",
        localPath: "/workshop/456",
        downloadedAt: "2026-10-12T01:00:00.000Z",
        name: "Workshop mod",
      },
      {
        packageId: "author.local",
        localPath: "/game/Mods/Local",
        downloadedAt: "2026-10-11T01:00:00.000Z",
        name: "Local mod",
      },
      {
        packageId: "ludeon.rimworld.anomaly",
        localPath: "/game/Data/Anomaly",
        officialContent: true,
        name: "RimWorld - Anomaly",
      },
    ],
    observedAt,
  );

  assert.equal(next.mods.length, 2);
  const workshop = next.mods.find((entry) => entry.workshopId === "456");
  const local = next.mods.find((entry) => entry.packageId === "author.local");
  assert.ok(workshop);
  assert.ok(local);
  assert.equal(workshop.id, "steam-456");
  assert.equal(workshop.source, "steam");
  assert.equal(workshop.subscribed, true);
  assert.equal(workshop.url, "https://steamcommunity.com/sharedfiles/filedetails/?id=456");
  assert.equal(local.id, "active-package:author.local");
  assert.equal(local.source, "local");
  assert.equal(local.subscribed, false);
  assert.equal(workshop.addedAt, observedAt);
  assert.equal(local.addedAt, observedAt);
  assert.ok(!next.mods.some((entry) => entry.packageId === "ludeon.rimworld.anomaly"));
});

void test("non-canonical copies of an official package remain ordinary persisted mods", () => {
  const next = reconcileInstalledModMetadata(
    vault([]),
    [
      {
        packageId: "ludeon.rimworld.anomaly",
        workshopId: "456",
        localPath: "/workshop/456",
        name: "Workshop impostor",
      },
      {
        packageId: "ludeon.rimworld.anomaly",
        localPath: "/game/Mods/FakeAnomaly",
        name: "Local impostor",
      },
    ],
    observedAt,
  );

  assert.deepEqual(
    next.mods.map(({ id }) => id),
    ["steam-456", "installed-local:ludeon.rimworld.anomaly:%2Fgame%2FMods%2FFakeAnomaly"],
  );
});

void test("duplicate local packages update only exact saved paths and never append an arbitrary copy", () => {
  const first = mod({
    id: "local-first",
    workshopId: undefined,
    packageId: "author.duplicate",
    source: "local",
    localPath: "/game/Mods/First",
    name: "First saved",
    subscribed: false,
  });
  const second = mod({
    id: "local-second",
    workshopId: undefined,
    packageId: "author.duplicate",
    source: "local",
    localPath: "/game/Mods/Second",
    name: "Second saved",
    subscribed: false,
  });
  const next = reconcileInstalledModMetadata(
    vault([first, second]),
    [
      {
        packageId: "author.duplicate",
        localPath: "/game/Mods/Second",
        name: "Second current",
        downloadedAt: "2026-10-12T02:00:00.000Z",
      },
      {
        packageId: "author.duplicate",
        localPath: "/game/Mods/First",
        name: "First current",
        downloadedAt: "2026-10-12T01:00:00.000Z",
      },
      {
        packageId: "author.duplicate",
        localPath: "/game/Mods/Third",
        name: "Unmatched third copy",
      },
    ],
    observedAt,
  );

  assert.equal(next.mods.length, 2);
  assert.deepEqual(
    next.mods.map(({ id, localPath, name }) => ({ id, localPath, name })),
    [
      { id: "local-first", localPath: "/game/Mods/First", name: "First current" },
      { id: "local-second", localPath: "/game/Mods/Second", name: "Second current" },
    ],
  );
  const persistedFirst = next.mods[0];
  const persistedSecond = next.mods[1];
  assert.ok(persistedFirst);
  assert.ok(persistedSecond);
  assert.equal(persistedFirst.notes, first.notes);
  assert.equal(persistedSecond.notes, second.notes);
});

void test("an exact path safely repairs a stale physical source without matching by package alone", () => {
  const staleWorkshop = mod({
    id: "steam-999",
    workshopId: "999",
    packageId: "old.package",
    localPath: "/game/Mods/NowLocal",
  });
  const unrelated = mod({
    id: "manual-same-package",
    workshopId: undefined,
    packageId: "author.current",
    source: "manual",
    localPath: undefined,
    subscribed: false,
  });
  const next = reconcileInstalledModMetadata(
    vault([staleWorkshop, unrelated], ["999"]),
    [
      {
        packageId: "author.current",
        localPath: "/game/Mods/NowLocal",
        name: "Now local",
      },
    ],
    observedAt,
  );

  const repaired = next.mods[0];
  assert.ok(repaired);
  assert.equal(repaired.id, "active-package:author.current");
  assert.equal(repaired.source, "local");
  assert.equal(repaired.workshopId, undefined);
  assert.equal(repaired.subscribed, false);
  assert.equal(repaired.notes, staleWorkshop.notes);
  assert.equal(next.mods[1], unrelated);
});

void test("absent rows and ambiguous or malformed observations are retained without unsafe writes", () => {
  const saved = mod();
  const current = vault([saved], ["123"]);
  const next = reconcileInstalledModMetadata(
    current,
    [
      { packageId: "author.bad-workshop", workshopId: "not-a-number", localPath: "/bad" },
      { packageId: "unknown", localPath: "/unknown" },
      { packageId: "author.empty-path", localPath: "" },
      { packageId: "author.one", workshopId: "777", localPath: "/first" },
      { packageId: "author.two", workshopId: "777", localPath: "/second" },
    ],
    observedAt,
  );

  assert.equal(next, current);
  assert.equal(next.mods[0], saved);
  assert.throws(
    () => reconcileInstalledModMetadata(current, [], "not-a-date"),
    /observation time is invalid/,
  );
});
