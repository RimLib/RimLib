import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ModsPanelView } from "../src/renderer/src/components/panels/ModsPanel";
import {
  filterLibrary,
  isModMetadataUnavailable,
  modInstalledOrUpdatedAt,
  promoteModsToFront,
  resolveModPriorityId,
} from "../src/renderer/src/utils/library";
import { modPanelModes, modSorts, searchScopes } from "../src/renderer/src/utils/uiConstants";
import type { Mod } from "../src/shared/types";

const noop = () => undefined;
const mod = (id: string, downloadedAt: string): Mod => ({
  id,
  workshopId: id,
  packageId: `author.mod${id}`,
  name: `Mod ${id}`,
  author: "Author",
  source: "steam",
  summary: "Description",
  tags: [],
  gameVersions: [],
  screenshots: [],
  subscribed: true,
  downloadedAt,
  addedAt: downloadedAt,
});

void test("invalid metadata recognizes unusable identities and only generated non-official placeholders", () => {
  const valid = mod("1", "2026-01-01");
  assert.equal(isModMetadataUnavailable(valid), false);
  assert.equal(isModMetadataUnavailable({ ...valid, packageId: undefined }), true);
  assert.equal(isModMetadataUnavailable({ ...valid, packageId: "steam.1" }), true);
  assert.equal(
    isModMetadataUnavailable({
      ...valid,
      id: "active-package:author.placeholder",
      workshopId: undefined,
      packageId: "author.placeholder",
    }),
    true,
  );
  assert.equal(
    isModMetadataUnavailable({
      ...valid,
      id: "active-package:author.installed",
      workshopId: undefined,
      packageId: "author.installed",
      localPath: "/game/Mods/Installed",
    }),
    false,
  );
  assert.equal(
    isModMetadataUnavailable({
      ...valid,
      id: "active-package:ludeon.rimworld",
      workshopId: undefined,
      packageId: "ludeon.rimworld",
    }),
    false,
  );
});

void test("Invalid first groups incomplete library entries and keeps newest-first order inside each group", () => {
  const mods = [
    mod("valid-old", "2026-01-01"),
    { ...mod("invalid-old", "2026-02-01"), packageId: undefined },
    mod("valid-new", "2026-04-01"),
    { ...mod("invalid-new", "2026-03-01"), packageId: "unknown" },
  ];
  const before = structuredClone(mods);

  assert.deepEqual(
    filterLibrary(mods, "", searchScopes.all, modSorts.invalid).map(({ id }) => id),
    ["invalid-new", "invalid-old", "valid-new", "valid-old"],
  );
  assert.deepEqual(mods, before);
});

void test("Not subscribed first groups Library entries and keeps newest-first order inside each group", () => {
  const mods = [
    { ...mod("subscribed-new", "2026-04-01"), subscribed: true },
    { ...mod("not-subscribed-old", "2026-01-01"), subscribed: false },
    { ...mod("subscribed-old", "2026-02-01"), subscribed: true },
    { ...mod("not-subscribed-new", "2026-03-01"), subscribed: false },
  ];
  const before = structuredClone(mods);

  assert.deepEqual(
    filterLibrary(mods, "", searchScopes.all, modSorts.notSubscribed).map(({ id }) => id),
    ["not-subscribed-new", "not-subscribed-old", "subscribed-new", "subscribed-old"],
  );
  assert.deepEqual(mods, before);
});

void test("Newest first uses the latest add, local installation, or Workshop update timestamp", () => {
  const workshopUpdated = {
    ...mod("workshop-updated", "2026-01-01T00:00:00.000Z"),
    addedAt: "2026-02-01T00:00:00.000Z",
    steamUpdatedAt: "2026-06-01T00:00:00.000Z",
  };
  const locallyUpdated = {
    ...mod("locally-updated", "2026-05-01T00:00:00.000Z"),
    addedAt: "2026-01-01T00:00:00.000Z",
    steamUpdatedAt: "2026-03-01T00:00:00.000Z",
  };
  const recentlyAdded = {
    ...mod("recently-added", "2026-02-01T00:00:00.000Z"),
    addedAt: "2026-04-01T00:00:00.000Z",
    steamUpdatedAt: "2026-01-01T00:00:00.000Z",
  };
  const unknown = {
    ...mod("unknown", "not-a-date"),
    addedAt: "",
    steamUpdatedAt: "also-not-a-date",
  };
  const mods = [unknown, recentlyAdded, locallyUpdated, workshopUpdated];
  const before = structuredClone(mods);

  assert.equal(modInstalledOrUpdatedAt(workshopUpdated), Date.parse("2026-06-01T00:00:00.000Z"));
  assert.equal(modInstalledOrUpdatedAt(locallyUpdated), Date.parse("2026-05-01T00:00:00.000Z"));
  assert.deepEqual(
    filterLibrary(mods, "", searchScopes.all, modSorts.newest).map(({ id }) => id),
    [workshopUpdated.id, locallyUpdated.id, recentlyAdded.id, unknown.id],
  );
  assert.deepEqual(
    filterLibrary(
      mods,
      "",
      searchScopes.all,
      modSorts.newest,
      [],
      new Map(mods.map((entry, index) => [entry.id, mods.length - index])),
    ).map(({ id }) => id),
    [workshopUpdated.id, locallyUpdated.id, recentlyAdded.id, unknown.id],
    "Newest first must use recency in the Active panel instead of load order",
  );
  assert.deepEqual(
    filterLibrary(mods, "", searchScopes.all, modSorts.oldest).map(({ id }) => id),
    [unknown.id, recentlyAdded.id, locallyUpdated.id, workshopUpdated.id],
  );
  assert.deepEqual(mods, before);
});

void test("date sorting uses the mod ID as a deterministic tie-breaker", () => {
  const zeta = mod("zeta", "2026-02-01T00:00:00.000Z");
  const alpha = {
    ...mod("alpha", "2026-01-01T00:00:00.000Z"),
    steamUpdatedAt: "2026-02-01T00:00:00.000Z",
  };

  assert.deepEqual(
    filterLibrary([zeta, alpha], "", searchScopes.all, modSorts.newest).map(({ id }) => id),
    [alpha.id, zeta.id],
  );
});

void test("temporary deactivation priority stable-prepends matching Library rows", () => {
  const first = mod("first", "2026-03-01");
  const second = mod("second", "2026-02-01");
  const third = mod("third", "2026-01-01");
  const sorted = [first, second, third];
  const before = [...sorted];

  assert.deepEqual(
    promoteModsToFront(sorted, [third.id, "missing", third.id, second.id]).map(({ id }) => id),
    [third.id, second.id, first.id],
  );
  assert.deepEqual(sorted, before);
  assert.equal(promoteModsToFront(sorted, ["missing"]), sorted);
});

void test("temporary priority follows one metadata identity replacement but never an ambiguity", () => {
  const installed = { ...mod("installed", "2026-03-01"), packageId: "Author.Target" };
  const duplicate = { ...mod("duplicate", "2026-02-01"), packageId: "author.target" };
  const placeholder = { id: "active-package:author.target", packageId: "author.target" };

  assert.equal(resolveModPriorityId([installed], placeholder), installed.id);
  assert.equal(resolveModPriorityId([installed, duplicate], placeholder), undefined);
  assert.equal(resolveModPriorityId([installed, duplicate], installed), installed.id);
});

void test("Invalid first keeps game order inside active invalid and valid groups", () => {
  const invalidLater = {
    ...mod("invalid-later", "2026-04-01"),
    packageId: undefined,
  };
  const invalidEarlier = {
    ...mod("invalid-earlier", "2026-01-01"),
    id: "active-package:author.missing",
    workshopId: undefined,
    packageId: "author.missing",
    source: "local" as const,
  };
  const validFirst = mod("valid-first", "2026-02-01");
  const validLater = mod("valid-later", "2026-03-01");
  const mods = [invalidLater, validLater, invalidEarlier, validFirst];
  const activeOrder = new Map([
    [validFirst.id, 1],
    [invalidEarlier.id, 2],
    [validLater.id, 3],
    [invalidLater.id, 4],
  ]);

  assert.deepEqual(
    filterLibrary(mods, "", searchScopes.all, modSorts.invalid, [], activeOrder).map(
      ({ id }) => id,
    ),
    [invalidEarlier.id, invalidLater.id, validFirst.id, validLater.id],
  );
});

void test("Active Invalid first prioritizes missing dependencies, then metadata failures, in game order", () => {
  const dependencyBrokenEarlier = mod("dependency-broken-earlier", "2026-05-01");
  const dependencyBrokenLater = mod("dependency-broken-later", "2026-06-01");
  const metadataInvalid = {
    ...mod("metadata-invalid", "2026-04-01"),
    packageId: undefined,
  };
  const valid = mod("valid", "2026-03-01");
  const mods = [valid, dependencyBrokenLater, metadataInvalid, dependencyBrokenEarlier];
  const activeOrder = new Map([
    [valid.id, 1],
    [dependencyBrokenEarlier.id, 2],
    [metadataInvalid.id, 3],
    [dependencyBrokenLater.id, 4],
  ]);
  const invalidModIds = new Set([dependencyBrokenEarlier.id, dependencyBrokenLater.id]);

  assert.deepEqual(
    filterLibrary(mods, "", searchScopes.all, modSorts.invalid, [], activeOrder, invalidModIds).map(
      ({ id }) => id,
    ),
    [dependencyBrokenEarlier.id, dependencyBrokenLater.id, metadataInvalid.id, valid.id],
  );
});

void test("Library alone offers Not subscribed first while both panels retain their other sorts", () => {
  const entry = mod("1", "2026-01-01");
  const common = {
    mods: [entry],
    totalCount: 1,
    tags: [],
    selectedModId: entry.id,
    search: "",
    searchScope: searchScopes.all,
    sort: modSorts.invalid,
    activeIds: new Set<string>(),
    onSearch: noop,
    onSearchScope: noop,
    onSort: noop,
    onSelect: noop,
    onSubscribe: noop,
    onUnsubscribe: noop,
  };
  const library = renderToStaticMarkup(<ModsPanelView {...common} mode={modPanelModes.inactive} />);
  const active = renderToStaticMarkup(
    <ModsPanelView
      {...common}
      mode={modPanelModes.active}
      activeIds={new Set([entry.id])}
      activeOrder={new Map([[entry.id, 1]])}
    />,
  );

  assert.match(library, /<option value="invalid-first" selected="">Invalid first<\/option>/);
  assert.doesNotMatch(library, />Load order<\/option>/);
  assert.match(library, />Not subscribed first<\/option>/);
  assert.match(active, /<option value="invalid-first" selected="">Invalid first<\/option>/);
  assert.match(active, />Load order<\/option>/);
  assert.doesNotMatch(active, />Not subscribed first<\/option>/);
});
