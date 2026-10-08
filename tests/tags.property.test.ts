import assert from "node:assert/strict";
import { test } from "node:test";

import fc from "fast-check";

import { assignTagsToMods, saveUserTag, tagNameExists, tagSaveModes } from "../src/shared/tags";
import type { ModVault } from "../src/shared/types";
import { requireValue } from "../src/shared/validation";
import { mergeVaultSave, normalizeVault } from "../src/shared/vault";
import {
  assertUnchanged,
  colorArbitrary,
  modArbitrary,
  propertyOptions,
  sequenceLimit,
  textArbitrary,
  vaultArbitrary,
} from "./helpers/properties";

const operationArbitrary = fc.record({
  assigned: fc.boolean(),
  modMask: fc.nat({ max: 4095 }),
  tagMask: fc.nat({ max: 63 }),
});

void test("property: bulk tag operations follow an independent set model across arbitrary action sequences", () => {
  fc.assert(
    fc.property(
      vaultArbitrary,
      fc.array(operationArbitrary, { minLength: 1, maxLength: sequenceLimit }),
      (vault, operations) => {
        const model = new Map(vault.mods.map((mod) => [mod.id, new Set(mod.userTagIds)]));
        let current: ModVault = vault;
        for (const operation of operations) {
          const modIds = vault.mods
            .filter((_, index) => (operation.modMask & (1 << index)) !== 0)
            .map((mod) => mod.id);
          const tagIds = vault.userTags
            .filter((_, index) => (operation.tagMask & (1 << index)) !== 0)
            .map((tag) => tag.id);
          assertUnchanged(current, () => {
            current = assignTagsToMods(
              current,
              [...modIds, ...modIds],
              [...tagIds, ...tagIds],
              operation.assigned,
            );
          });
          for (const id of modIds) {
            const assigned = requireValue(model.get(id));
            for (const tag of tagIds) {
              if (operation.assigned) {
                assigned.add(tag);
              } else {
                assigned.delete(tag);
              }
            }
          }
          for (const mod of current.mods) {
            assert.deepEqual(new Set(mod.userTagIds), model.get(mod.id));
            assert.equal(mod.userTagIds?.length, new Set(mod.userTagIds).size);
            const { userTagIds: _tags, ...metadata } = mod;
            const { userTagIds: _originalTags, ...original } = requireValue(
              vault.mods.find((entry) => entry.id === mod.id),
            );
            assert.deepEqual(metadata, original);
          }
          assert.deepEqual(current.userTags, vault.userTags);
          assert.deepEqual(current.localSteamState, vault.localSteamState);
        }
      },
    ),
    propertyOptions,
  );
});

void test("property: assigning or removing the same tag twice is idempotent and agrees with bulk assignment", () => {
  fc.assert(
    fc.property(vaultArbitrary, modArbitrary, fc.boolean(), (vault, mod, assigned) => {
      const tag = { id: "property-target-tag", name: "Target", color: "#123456" };
      const input = {
        ...vault,
        mods: [mod, ...vault.mods.filter((entry) => entry.id !== mod.id)],
        userTags: [...vault.userTags, tag],
      };
      assertUnchanged(input, () => {
        const once = assignTagsToMods(input, [mod.id], [tag.id], assigned);
        assert.deepEqual(assignTagsToMods(once, [mod.id], [tag.id], assigned), once);
        assert.deepEqual(assignTagsToMods(input, [mod.id], [tag.id], assigned), once);
        assert.throws(
          () => assignTagsToMods(input, [mod.id], ["missing-tag"], assigned),
          /No tags were edited/,
        );
      });
    }),
    propertyOptions,
  );
});

void test("property: stale mod or tag targets reject an entire bulk edit atomically", () => {
  fc.assert(
    fc.property(vaultArbitrary, fc.boolean(), (vault, assigned) => {
      assertUnchanged(vault, () => {
        assert.throws(
          () =>
            assignTagsToMods(
              vault,
              [...vault.mods.map((mod) => mod.id), "missing-mod"],
              [...vault.userTags.map((tag) => tag.id), "missing-tag"],
              assigned,
            ),
          /No tags were edited/,
        );
        const tag = { id: "new-property-tag", name: "Unique new property tag", color: "#123456" };
        assert.throws(
          () => saveUserTag(vault, tag, tagSaveModes.create, ["missing-mod"]),
          /No tags were edited/,
        );
      });
    }),
    propertyOptions,
  );
});

void test("property: tag edits preserve identity, assignments and unknown tag fields", () => {
  fc.assert(
    fc.property(vaultArbitrary, textArbitrary, colorArbitrary, (vault, name, color) => {
      const tag = {
        id: "property-edited-tag",
        name: "Original",
        color: "#123456",
        futureData: { retained: true },
      };
      const input = {
        ...vault,
        userTags: [...vault.userTags, tag],
        mods: vault.mods.map((mod) => ({ ...mod, userTagIds: [...mod.userTagIds, tag.id] })),
      };
      assertUnchanged(input, () => {
        const edited = saveUserTag(
          input,
          { id: tag.id, name: `Renamed ${name}`, color },
          tagSaveModes.edit,
        );
        assert.deepEqual(edited.mods, input.mods);
        assert.deepEqual(edited.localSteamState, input.localSteamState);
        const saved = requireValue(edited.userTags.find((entry) => entry.id === tag.id));
        assert.equal(saved.name, `Renamed ${name}`);
        assert.equal(saved.color, color);
        assert.deepEqual(Reflect.get(saved, "futureData"), tag.futureData);
      });
    }),
    propertyOptions,
  );
});

void test("property: tag names are unique independently of surrounding whitespace and ASCII casing", () => {
  fc.assert(
    fc.property(
      fc
        .array(fc.constantFrom(...Array.from("abcdefghijklmnopqrstuvwxyz")), {
          minLength: 1,
          maxLength: 40,
        })
        .map((letters) => letters.join("")),
      (name) => {
        const tag = { id: "existing", name, color: "#123456" };
        const vault = normalizeVault({ mods: [], userTags: [tag] });
        assert.ok(tagNameExists([tag], ` \t${name.toUpperCase()}\n `));
        assert.equal(tagNameExists([tag], name, tag.id), false);
        assertUnchanged(vault, () => {
          assert.throws(
            () =>
              saveUserTag(
                vault,
                { ...tag, id: "new", name: ` ${name.toUpperCase()} ` },
                tagSaveModes.create,
              ),
            /unique/,
          );
        });
      },
    ),
    propertyOptions,
  );
});

void test("property: explicit tag deletion leaves mods intact and removes only that tag from live and retained selection records", () => {
  fc.assert(
    fc.property(vaultArbitrary, (vault) => {
      const tag = { id: "deleted-property-tag", name: "Deleted", color: "#123456" };
      const mods = vault.mods.map((mod) => ({ ...mod, userTagIds: [...mod.userTagIds, tag.id] }));
      const input = {
        ...vault,
        mods,
        userTags: [...vault.userTags, tag],
      };
      assertUnchanged(input, () => {
        const deleted = mergeVaultSave(input, input, { deletedTagIds: [tag.id] });
        assert.deepEqual(deleted.mods, vault.mods);
        assert.deepEqual(
          deleted.userTags,
          vault.userTags.map((tag) => ({ ...tag })),
        );

        assert.deepEqual(deleted.localSteamState, vault.localSteamState);
      });
    }),
    propertyOptions,
  );
});
