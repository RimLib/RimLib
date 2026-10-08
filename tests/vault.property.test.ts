import assert from "node:assert/strict";
import { test } from "node:test";

import fc from "fast-check";

import { requireValue } from "../src/shared/validation";
import {
  deleteLibraryModsExplicitly,
  mergeModMetadata,
  mergeSteamSync,
  mergeVaultSave,
  normalizeVault,
  serializeVault,
} from "../src/shared/vault";
import { vaultSchemaVersion } from "../src/shared/vaultValidation";
import {
  assertUnchanged,
  modArbitrary,
  modsArbitrary,
  propertyOptions,
  steamImport,
  vaultArbitrary,
  workshopIdArbitrary,
} from "./helpers/properties";

void test("property: vault normalization is idempotent and does not mutate its input", () => {
  fc.assert(
    fc.property(vaultArbitrary, (vault) => {
      assertUnchanged(vault, () => {
        const normalized = normalizeVault(vault);
        assert.deepEqual(normalizeVault(normalized), normalized);
        assert.equal(normalized.schemaVersion, vaultSchemaVersion);
        assert.deepEqual(
          normalized.mods.map((mod) => mod.id),
          vault.mods.map((mod) => mod.id),
        );
      });
    }),
    propertyOptions,
  );
});

void test("property: JSON round trips preserve user data and unknown fields in every current record", () => {
  fc.assert(
    fc.property(vaultArbitrary, (vault) => {
      const normalized = normalizeVault(vault);
      const raw = JSON.stringify(serializeVault(normalized));
      const parsed: unknown = JSON.parse(raw);
      const restored = normalizeVault(parsed);
      assert.equal(JSON.stringify(serializeVault(restored)), raw);
      assert.deepEqual(Reflect.get(restored, "futureData"), vault.futureData);
      assert.deepEqual(
        Reflect.get(requireValue(restored.settings), "futureData"),
        vault.futureData,
      );
      for (const original of vault.mods) {
        const saved = requireValue(restored.mods.find((mod) => mod.id === original.id));
        assert.deepEqual(Reflect.get(saved, "futureData"), original.futureData);
        assert.deepEqual(saved.userTagIds, original.userTagIds);
        assert.equal(saved.notes, original.notes);
      }
      for (const tag of vault.userTags) {
        assert.deepEqual(
          Reflect.get(
            requireValue(restored.userTags.find((entry) => entry.id === tag.id)),
            "futureData",
          ),
          tag.futureData,
        );
      }
    }),
    propertyOptions,
  );
});

void test("property: metadata enrichment cannot replace personal tags, notes or the original added date", () => {
  fc.assert(
    fc.property(modArbitrary, modArbitrary, (previous, metadata) => {
      const incoming = { ...metadata, id: previous.id, userTagIds: ["remote-tag"] };
      assertUnchanged([previous, incoming], () => {
        const merged = mergeModMetadata(previous, incoming);
        assert.deepEqual(merged.userTagIds, previous.userTagIds);
        assert.equal(merged.notes, previous.notes ?? incoming.notes);
        assert.equal(merged.addedAt, previous.addedAt);
        assert.deepEqual(merged.screenshots, [
          ...new Set([...previous.screenshots, ...incoming.screenshots]),
        ]);
      });
    }),
    propertyOptions,
  );
});

void test("property: sync preserves every library record and user tag while updating subscription membership", () => {
  fc.assert(
    fc.property(
      vaultArbitrary,
      modsArbitrary,
      fc.array(workshopIdArbitrary, { maxLength: 15 }),
      (vault, newMods, subscribedIds) => {
        const incoming = [
          ...vault.mods.map((mod) => ({
            ...mod,
            name: `Refreshed ${mod.name}`,
            userTagIds: ["remote-tag"],
          })),
          ...newMods,
        ];
        const result = steamImport(incoming, subscribedIds);
        assertUnchanged([vault, result], () => {
          const synced = mergeSteamSync(vault, result);
          const savedIds = new Set(synced.mods.map((mod) => mod.id));
          assert.equal(savedIds.size, synced.mods.length);
          for (const mod of [...vault.mods, ...newMods]) {
            assert.ok(savedIds.has(mod.id));
          }
          assert.deepEqual(synced.userTags, vault.userTags);
          assert.deepEqual(synced.settings, vault.settings);
          for (const previous of vault.mods) {
            const mod = requireValue(synced.mods.find((entry) => entry.id === previous.id));
            assert.deepEqual(mod.userTagIds, previous.userTagIds);
            if (previous.notes !== undefined) {
              assert.equal(mod.notes, previous.notes);
            }
            assert.equal(mod.addedAt, previous.addedAt);
          }
          for (const mod of synced.mods) {
            if (mod.workshopId) {
              assert.equal(mod.subscribed, subscribedIds.includes(mod.workshopId));
            }
          }
          assert.deepEqual(mergeSteamSync(synced, result), synced);
        });
      },
    ),
    propertyOptions,
  );
});

void test("property: an empty Steam sync retains records, tags, settings and personal metadata", () => {
  fc.assert(
    fc.property(vaultArbitrary, (vault) => {
      const synced = mergeSteamSync(vault, steamImport([], []));
      assert.deepEqual(
        synced.mods.map((mod) => mod.id),
        vault.mods.map((mod) => mod.id),
      );
      assert.deepEqual(synced.userTags, vault.userTags);
      assert.deepEqual(synced.settings, vault.settings);
      for (const mod of vault.mods) {
        const saved = requireValue(synced.mods.find((entry) => entry.id === mod.id));
        assert.deepEqual(saved, mod.workshopId ? { ...mod, subscribed: false } : mod);
      }
    }),
    propertyOptions,
  );
});

void test("property: ordinary partial saves cannot delete omitted mods, tags or settings", () => {
  fc.assert(
    fc.property(vaultArbitrary, fc.boolean(), (vault, includeSome) => {
      const incoming = {
        ...vault,
        mods: includeSome ? vault.mods.filter((_, index) => index % 2 === 0) : [],
        userTags: [],
      };
      assertUnchanged([vault, incoming], () => {
        const saved = mergeVaultSave(vault, incoming);
        assert.deepEqual(saved.mods, vault.mods);
        assert.deepEqual(saved.userTags, vault.userTags);

        assert.deepEqual(Reflect.get(saved, "futureData"), vault.futureData);
      });
    }),
    propertyOptions,
  );
});

void test("property: explicit deletion removes only approved records and preserves remaining user data", () => {
  fc.assert(
    fc.property(vaultArbitrary, modArbitrary, fc.nat(), (vault, extra, mask) => {
      const mods = [
        ...new Map(
          [...vault.mods, extra].map((mod) => [mod.id, { ...mod, subscribed: false }]),
        ).values(),
      ];
      const input = {
        ...vault,
        mods,
        localSteamState: { ...vault.localSteamState, observedIds: [], pending: {} },
      };
      const targets = mods
        .filter((_, index) => index === 0 || ((mask >>> (index % 31)) & 1) !== 0)
        .map((mod) => mod.id);
      assertUnchanged(input, () => {
        const deleted = deleteLibraryModsExplicitly(input, [...targets, ...targets]);
        assert.deepEqual(
          deleted.mods,
          mods.filter((mod) => !targets.includes(mod.id)),
        );
        assert.deepEqual(deleted.userTags, input.userTags);
        assert.deepEqual(deleted.localSteamState, input.localSteamState);
        assert.deepEqual(deleted.settings, input.settings);
      });
    }),
    propertyOptions,
  );
});

void test("property: one subscribed or missing target rejects the entire deletion without mutation", () => {
  fc.assert(
    fc.property(
      vaultArbitrary,
      modArbitrary,
      workshopIdArbitrary,
      fc.boolean(),
      (vault, metadata, id, useOverride) => {
        const protectedMod = {
          ...metadata,
          id: `protected-${id}`,
          workshopId: id,
          subscribed: false,
        };
        const input = {
          ...vault,
          mods: [...vault.mods, protectedMod],
          localSteamState: {
            ...vault.localSteamState,
            observedIds: useOverride ? [] : [id],
            pending: useOverride ? { [id]: "subscribe" as const } : {},
          },
        };
        assertUnchanged(input, () => {
          assert.throws(
            () =>
              deleteLibraryModsExplicitly(input, [
                ...vault.mods.map((mod) => mod.id),
                protectedMod.id,
              ]),
            /Nothing was deleted/,
          );
          assert.throws(
            () =>
              deleteLibraryModsExplicitly(input, [
                ...vault.mods.map((mod) => mod.id),
                "missing-record",
              ]),
            /Nothing was deleted/,
          );
        });
      },
    ),
    propertyOptions,
  );
});

void test("property: newer database schemas are rejected rather than normalized or downgraded", () => {
  fc.assert(
    fc.property(vaultArbitrary, fc.integer({ min: 1, max: 1000 }), (vault, increment) => {
      const future = { ...vault, schemaVersion: vaultSchemaVersion + increment };
      assertUnchanged(future, () => {
        assert.throws(() => normalizeVault(future), /newer app version/);
      });
    }),
    propertyOptions,
  );
});

void test("property: duplicate mod and tag identities block normalization", () => {
  fc.assert(
    fc.property(vaultArbitrary, modArbitrary, (vault, mod) => {
      assert.throws(
        () => normalizeVault({ ...vault, mods: [mod, mod] }),
        /Duplicate database identifiers/,
      );
      const tag = { id: "duplicate", name: "Tag", color: "#123456" };
      assert.throws(
        () => normalizeVault({ ...vault, userTags: [tag, tag] }),
        /Duplicate tag identifiers/,
      );
    }),
    propertyOptions,
  );
});
