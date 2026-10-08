import assert from "node:assert/strict";
import { test } from "node:test";

import fc from "fast-check";

import { buildActiveMods } from "../src/renderer/src/utils/activeMods";
import {
  applyWorkshopStatus,
  filterLibrary,
  modBatchAvailability,
  subscriptionPanels,
} from "../src/renderer/src/utils/library";
import { modSorts, type SearchScope, searchScopes } from "../src/renderer/src/utils/uiConstants";
import { modActivities, modSources } from "../src/shared/domainConstants";
import { createActivityLookup } from "../src/shared/subscriptions";
import { requireValue } from "../src/shared/validation";
import { effectiveSubscribedIds } from "../src/shared/vault";
import {
  assertUnchanged,
  modsArbitrary,
  propertyOptions,
  textArbitrary,
  vaultArbitrary,
  workshopIdArbitrary,
  workshopModsArbitrary,
} from "./helpers/properties";

void test("property: subscription panels partition saved records and never mark library records Active", () => {
  fc.assert(
    fc.property(vaultArbitrary, fc.nat(), (vault, mask) => {
      const active = {
        packageIds: vault.mods
          .filter((_, index) => ((mask >>> index) & 1) !== 0)
          .map((mod) => mod.packageId),
        installedMods: vault.mods.map((mod) => ({
          packageId: mod.packageId,
          workshopId: mod.workshopId,
          localPath: `/virtual/${mod.id}`,
        })),
      };
      const entries = buildActiveMods(active, vault.mods).entries;
      assertUnchanged([vault, active], () => {
        const panels = subscriptionPanels(vault, vault.mods, active, entries);
        const live = effectiveSubscribedIds(vault.localSteamState);
        assert.deepEqual(
          panels.unsubscribed.map((mod) => mod.id),
          vault.mods
            .filter((mod) => !mod.workshopId || !live.has(mod.workshopId))
            .map((mod) => mod.id),
        );
        assert.deepEqual(new Set(panels.subscribed.map((mod) => mod.workshopId)), live);
        assert.equal(panels.unsubscribed.length + panels.subscribed.length, vault.mods.length);
        for (const mod of panels.unsubscribed) {
          assert.ok(!panels.activeIds.has(mod.id));
        }
        const lookup = createActivityLookup(active);
        for (const mod of panels.subscribed) {
          assert.equal(panels.activeIds.has(mod.id), lookup(mod) === modActivities.active);
        }
      });
    }),
    propertyOptions,
  );
});

void test("property: Active entries and their sort order follow RimWorld rather than library order", () => {
  fc.assert(
    fc.property(
      workshopModsArbitrary,
      fc.array(fc.nat({ max: 100 }), { maxLength: 15 }),
      (mods, positions) => {
        const ordered = [
          ...new Set(
            positions.flatMap((position) => mods[position % Math.max(mods.length, 1)]?.id ?? []),
          ),
        ].map((id) => requireValue(mods.find((mod) => mod.id === id)));
        const active = {
          packageIds: ordered.map((mod) => requireValue(mod.packageId).toUpperCase() + "_steam"),
          installedMods: mods.map((mod) => ({
            packageId: requireValue(mod.packageId),
            workshopId: mod.workshopId,
            localPath: `/virtual/${mod.id}`,
          })),
        };
        const subscribed = mods.map((mod) => ({ ...mod, subscribed: true }));
        const built = buildActiveMods(active, subscribed);
        assert.deepEqual(
          built.entries.map((mod) => mod.id),
          ordered.map((mod) => mod.id),
        );
        const panels = subscriptionPanels(
          { localSteamState: { observedIds: mods.map((mod) => mod.workshopId), pending: {} } },
          subscribed,
          active,
          built.entries,
        );
        const filtered = filterLibrary(
          panels.subscribed,
          "",
          searchScopes.all,
          modSorts.active,
          [],
          panels.activeOrder,
        );
        assert.deepEqual(
          filtered.slice(0, ordered.length).map((mod) => mod.id),
          ordered.map((mod) => mod.id),
        );
        assert.deepEqual(
          new Set(filtered.map((mod) => mod.id)),
          new Set(panels.subscribed.map((mod) => mod.id)),
        );
      },
    ),
    propertyOptions,
  );
});

void test("property: metadata and personal tag searches return exact subsets without mutation", () => {
  fc.assert(
    fc.property(vaultArbitrary, textArbitrary, (vault, query) => {
      assertUnchanged(vault.mods, () => {
        const result = filterLibrary(
          vault.mods,
          query,
          searchScopes.tags,
          modSorts.newest,
          vault.userTags,
        );
        const search = query.trim().toLowerCase();
        const names = new Map(vault.userTags.map((tag) => [tag.id, tag.name.toLowerCase()]));
        assert.deepEqual(
          new Set(result.map((mod) => mod.id)),
          new Set(
            vault.mods
              .filter((mod) =>
                !search
                  ? true
                  : [...mod.tags, ...mod.userTagIds.flatMap((id) => names.get(id) ?? [])].some(
                      (value) => value.toLowerCase().includes(search),
                    ),
              )
              .map((mod) => mod.id),
          ),
        );
      });
    }),
    propertyOptions,
  );
});

void test("property: scoped searching returns exact matches and download sorting is monotonic", () => {
  fc.assert(
    fc.property(
      modsArbitrary,
      textArbitrary,
      fc.constantFrom(...Object.values(searchScopes)),
      fc.constantFrom(modSorts.newest, modSorts.oldest),
      (mods, query, scope, sort) => {
        assertUnchanged(mods, () => {
          const result = filterLibrary(mods, query, scope, sort);
          const search = query.trim().toLowerCase();
          const matches = (mod: (typeof mods)[number], field: Exclude<SearchScope, "all">) => {
            const values = {
              title: [mod.name],
              author: [mod.author],
              description: [mod.summary],
              tags: mod.tags,
            }[field];
            return values.some((value) => value.toLowerCase().includes(search));
          };
          assert.deepEqual(
            new Set(result.map((mod) => mod.id)),
            new Set(
              mods
                .filter((mod) =>
                  !search
                    ? true
                    : scope === searchScopes.all
                      ? Object.values(searchScopes)
                          .filter((value): value is Exclude<SearchScope, "all"> => value !== "all")
                          .some((field) => matches(mod, field))
                      : matches(mod, scope),
                )
                .map((mod) => mod.id),
            ),
          );
          for (let index = 1; index < result.length; index++) {
            const previous = Date.parse(requireValue(result[index - 1]).downloadedAt) || 0;
            const current = Date.parse(requireValue(result[index]).downloadedAt) || 0;
            assert.ok(sort === modSorts.newest ? previous >= current : previous <= current);
          }
        });
      },
    ),
    propertyOptions,
  );
});

void test("property: stale workshop status cannot change a vault with another revision or configured path", () => {
  fc.assert(
    fc.property(
      vaultArbitrary,
      fc.array(workshopIdArbitrary, { maxLength: 15 }),
      fc.boolean(),
      (vault, subscribedIds, changePath) => {
        const snapshot = {
          revision: changePath ? vault.revision : `${vault.revision}-stale`,
          workshopModsPath: changePath
            ? `${vault.settings.workshopModsPath}-stale`
            : vault.settings.workshopModsPath,
          observedIds: subscribedIds,
          observedAt: "2026-01-01T00:00:00.000Z",
          pending: {},
          warnings: [],
        };
        assertUnchanged(vault, () => {
          assert.equal(applyWorkshopStatus(vault, snapshot), vault);
        });
      },
    ),
    propertyOptions,
  );
});

void test("property: current workshop observations update membership only and are idempotent", () => {
  fc.assert(
    fc.property(
      vaultArbitrary,
      fc.array(workshopIdArbitrary, { maxLength: 15 }),
      (vault, subscribedIds) => {
        const snapshot = {
          revision: vault.revision,
          workshopModsPath: vault.settings.workshopModsPath,
          observedIds: [...new Set(subscribedIds)],
          observedAt: "2026-01-01T00:00:00.000Z",
          pending: {},
          warnings: [],
        };
        assertUnchanged(vault, () => {
          const applied = applyWorkshopStatus(vault, snapshot);
          assert.equal(applyWorkshopStatus(applied, snapshot), applied);
          assert.deepEqual(applied.userTags, vault.userTags);

          assert.deepEqual(
            applied.mods,
            vault.mods.map((mod) =>
              mod.workshopId
                ? { ...mod, subscribed: snapshot.observedIds.includes(mod.workshopId) }
                : mod,
            ),
          );
        });
      },
    ),
    propertyOptions,
  );
});

void test("property: batch actions cannot unsubscribe Active mods or delete subscribed records", () => {
  fc.assert(
    fc.property(workshopModsArbitrary, workshopIdArbitrary, (mods, id) => {
      const target = {
        id: `steam-${id}`,
        workshopId: id,
        packageId: "test.active",
        name: "Active",
        author: "Author",
        source: modSources.steam,
        summary: "",
        tags: [],
        screenshots: [],
        gameVersions: [],
        subscribed: true,
        addedAt: "",
        downloadedAt: "",
      };
      const selection = [...mods, target];
      const saved = new Set(selection.map((mod) => mod.id));
      const guarded = modBatchAvailability(
        selection,
        saved,
        false,
        false,
        undefined,
        new Set([target.id]),
      );
      assert.ok(guarded.subscriptionDisabledReason);
      assert.ok(guarded.removalDisabledReason);
      const unreadable = modBatchAvailability(
        selection,
        saved,
        false,
        false,
        undefined,
        new Set(),
        "Config unreadable",
      );
      assert.ok(unreadable.subscriptionDisabledReason);
    }),
    propertyOptions,
  );
});
