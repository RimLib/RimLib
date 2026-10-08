import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import fc from "fast-check";

import type { WorkshopFolderDiscovery } from "../src/main/steamWorkshop";
import { workshopFolderStatus } from "../src/main/workshopStatus";
import { modActivities } from "../src/shared/domainConstants";
import { createActivityLookup } from "../src/shared/subscriptions";
import { requireValue } from "../src/shared/validation";
import { normalizeVault } from "../src/shared/vault";
import {
  assertUnchanged,
  modArbitrary,
  propertyOptions,
  vaultArbitrary,
  workshopIdArbitrary,
  workshopModsArbitrary,
} from "./helpers/properties";

const scanned = join("virtual", "SteamLibrary");
const unavailable = join("virtual", "DisconnectedLibrary");
function discovery(installedIds: string[], disconnected = false): WorkshopFolderDiscovery {
  return {
    folders: installedIds.map((workshopId) => ({ workshopId, path: join(scanned, workshopId) })),
    steamLibraryPaths: [scanned, unavailable],
    scannedLibraryPaths: [scanned],
    unavailableLibraryPaths: disconnected ? [unavailable] : [],
    manifestPaths: [],
    warnings: [],
  };
}

void test("property: an unavailable drive preserves previously present mods while an accessible empty drive clears presence", () => {
  fc.assert(
    fc.property(workshopModsArbitrary, fc.nat(), (rawMods, mask) => {
      const mods = rawMods.map((mod, index) => ({
        ...mod,
        subscribed: true,
        localPath: join(((mask >>> index) & 1) !== 0 ? unavailable : scanned, mod.workshopId),
      }));
      const vault = normalizeVault({
        mods,
        localSteamState: { observedIds: mods.map((mod) => mod.workshopId), pending: {} },
      });
      assertUnchanged(vault, () => {
        const partial = workshopFolderStatus(vault, discovery([], true));
        assert.deepEqual(
          new Set(partial.effectiveIds),
          new Set(
            mods
              .filter((mod) => mod.localPath.startsWith(unavailable))
              .map((mod) => mod.workshopId),
          ),
        );
        assert.deepEqual(workshopFolderStatus(vault, discovery([])).effectiveIds, []);
      });
    }),
    propertyOptions,
  );
});

void test("property: confirmed subscription overrides win over folders until observations catch up", () => {
  fc.assert(
    fc.property(
      vaultArbitrary,
      fc.uniqueArray(workshopIdArbitrary, { maxLength: 12 }),
      fc.nat(),
      (vault, ids, mask) => {
        const targets = Object.fromEntries(
          ids.map((id, index) => [id, ((mask >>> index) & 1) !== 0]),
        );
        const pendingActions = Object.fromEntries(
          Object.entries(targets).map(([id, subscribed]) => [
            id,
            subscribed ? "subscribe" : "unsubscribe",
          ]),
        );
        const input = normalizeVault({
          ...vault,
          localSteamState: { ...vault.localSteamState, pending: pendingActions },
        });
        const installed = ids.filter((id) => !targets[id]);
        assertUnchanged(input, () => {
          const pending = workshopFolderStatus(input, discovery(installed));
          assert.deepEqual(new Set(pending.effectiveIds), new Set(ids.filter((id) => targets[id])));
          assert.deepEqual(pending.pending, pendingActions);
          const caughtUp = workshopFolderStatus(input, discovery(ids.filter((id) => targets[id])));
          assert.deepEqual(new Set(caughtUp.effectiveIds), new Set(pending.effectiveIds));
          assert.deepEqual(caughtUp.pending, {});
        });
      },
    ),
    propertyOptions,
  );
});

void test("property: similarly prefixed sibling folders are not considered successfully scanned libraries", () => {
  fc.assert(
    fc.property(workshopIdArbitrary, modArbitrary, (id, metadata) => {
      const mod = {
        ...metadata,
        id: `steam-${id}`,
        workshopId: id,
        subscribed: true,
        localPath: join(`${scanned}-sibling`, id),
      };
      const vault = normalizeVault({
        mods: [mod],
        localSteamState: { observedIds: [id], pending: {} },
      });
      const status = workshopFolderStatus(vault, discovery([], true));
      assert.deepEqual(status.effectiveIds, [id]);
    }),
    propertyOptions,
  );
});

void test("property: installed Workshop identity wins over another mod's stale cached package identity", () => {
  fc.assert(
    fc.property(fc.uniqueArray(workshopIdArbitrary, { minLength: 2, maxLength: 2 }), (ids) => {
      const installedId = requireValue(ids[0]);
      const staleId = requireValue(ids[1]);
      const active = {
        packageIds: ["Test.SharedPackage_steam"],
        installedMods: [
          { packageId: "test.sharedpackage", workshopId: installedId, localPath: "/virtual/mod" },
        ],
      };
      const lookup = createActivityLookup(active);
      assert.equal(lookup({ workshopId: installedId, packageId: "unknown" }), modActivities.active);
      assert.equal(
        lookup({ workshopId: staleId, packageId: "test.sharedpackage" }),
        modActivities.inactive,
      );
    }),
    propertyOptions,
  );
});

void test("property: unreadable Active state never reports a mod safely inactive", () => {
  fc.assert(
    fc.property(workshopModsArbitrary, fc.nat(), (mods, mask) => {
      const lookup = createActivityLookup({
        error: "Config unavailable",
        packageIds: mods
          .filter((_, index) => ((mask >>> index) & 1) !== 0)
          .map((mod) => requireValue(mod.packageId)),
      });
      for (const mod of mods) {
        assert.equal(lookup(mod), modActivities.unknown);
      }
    }),
    propertyOptions,
  );
});

void test("property: missing or placeholder package identities remain protected without verified installed metadata", () => {
  fc.assert(
    fc.property(
      workshopIdArbitrary,
      fc.constantFrom(undefined, "", "Unknown", "unknown", "not a package"),
      (id, packageId) => {
        const lookup = createActivityLookup({ packageIds: [] });
        assert.equal(lookup({ workshopId: id, packageId }), modActivities.unknown);
        assert.equal(lookup({ workshopId: id, packageId: `steam.${id}` }), modActivities.unknown);
      },
    ),
    propertyOptions,
  );
});
