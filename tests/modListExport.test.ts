import assert from "node:assert/strict";
import { test } from "node:test";

import { buildModListExportPackageIds } from "../src/renderer/src/utils/modListExport";
import type { Mod } from "../src/shared/types";

function mod(id: string, packageId: string, extra: Partial<Mod> = {}): Mod {
  return {
    id,
    packageId,
    name: id,
    author: "Author",
    source: "local",
    summary: "",
    gameVersions: [],
    tags: [],
    subscribed: false,
    downloadedAt: "",
    addedAt: "",
    screenshots: [],
    ...extra,
  };
}

void test("XML export marks only an installed Workshop copy with real physical duplicates", () => {
  const core = mod("active-package:ludeon.rimworld", "ludeon.rimworld");
  const local = mod("local-camera", "Author.Camera", { localPath: "/local/camera" });
  const workshop = mod("steam-123", "author.camera", {
    source: "steam",
    workshopId: "123",
    localPath: "/workshop/123",
  });
  const singleWorkshop = mod("steam-456", "Author.Single_STEAM", {
    source: "steam",
    workshopId: "456",
  });
  const installedDuplicates = [
    { packageId: "AUTHOR.CAMERA", localPath: "/local/camera" },
    { packageId: "author.camera", workshopId: "123", localPath: "/workshop/123" },
  ];

  assert.deepEqual(
    buildModListExportPackageIds([core, workshop, singleWorkshop], installedDuplicates),
    ["ludeon.rimworld", "author.camera_steam", "author.single"],
  );
  assert.deepEqual(buildModListExportPackageIds([core, local], installedDuplicates), [
    "ludeon.rimworld",
    "author.camera",
  ]);
});

void test("XML export ignores stale library duplicates and canonicalizes unresolved markers", () => {
  const workshop = mod("steam-123", "Author.Camera", {
    source: "steam",
    workshopId: "123",
  });
  const unresolved = mod("active-package:author.unknown", "Author.Unknown_steam");
  assert.deepEqual(
    buildModListExportPackageIds(
      [workshop],
      [{ packageId: "author.camera", workshopId: "123", localPath: "/workshop/123" }],
    ),
    ["author.camera"],
  );
  assert.deepEqual(buildModListExportPackageIds([unresolved], []), ["author.unknown"]);

  assert.throws(
    () => buildModListExportPackageIds([mod("invalid", "steam.123")], []),
    /cannot be exported/,
  );
});

void test("XML export de-duplicates repeated observations of one physical copy", () => {
  const workshop = mod("steam-123", "Author.Camera", {
    source: "steam",
    workshopId: "123",
  });
  const observation = {
    packageId: "author.camera",
    workshopId: "123",
    localPath: "/workshop/123",
  };
  assert.deepEqual(buildModListExportPackageIds([workshop], [observation, observation]), [
    "author.camera",
  ]);
});

void test("XML export treats the same Workshop item in distinct folders as physical duplicates", () => {
  const workshop = mod("steam-123", "Author.Camera", {
    source: "steam",
    workshopId: "123",
  });
  assert.deepEqual(
    buildModListExportPackageIds(
      [workshop],
      [
        { packageId: "author.camera", workshopId: "123", localPath: "/library-a/123" },
        { packageId: "author.camera", workshopId: "123", localPath: "/library-b/123" },
      ],
    ),
    ["author.camera_steam"],
  );
});

void test("XML export never emits RimSort's Workshop marker for registered official content", () => {
  const fakeOfficialWorkshop = mod("steam-999", "LUDEON.RIMWORLD.ANOMALY_steam", {
    source: "steam",
    workshopId: "999",
  });
  const duplicate = mod("local-anomaly", "ludeon.rimworld.anomaly");

  assert.deepEqual(
    buildModListExportPackageIds(
      [fakeOfficialWorkshop],
      [
        { packageId: fakeOfficialWorkshop.packageId ?? "", workshopId: "999", localPath: "/w" },
        { packageId: duplicate.packageId ?? "", localPath: "/local" },
      ],
    ),
    ["ludeon.rimworld.anomaly"],
  );
});
