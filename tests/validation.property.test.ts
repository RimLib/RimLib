import assert from "node:assert/strict";
import { test } from "node:test";

import fc from "fast-check";

import { ipcChannels, validateIpcArgs } from "../src/shared/ipc";
import { normalizePackageId } from "../src/shared/packages";
import { createSteamWorkshopUrl, getModWorkshopId, isSteamWorkshopId } from "../src/shared/steam";
import { normalizeVault } from "../src/shared/vault";
import {
  assertUnchanged,
  extensionArbitrary,
  propertyOptions,
  textArbitrary,
  vaultArbitrary,
  workshopIdArbitrary,
} from "./helpers/properties";

void test("property: every valid Workshop identifier survives canonical URL creation and parsing", () => {
  fc.assert(
    fc.property(workshopIdArbitrary, (id) => {
      assert.ok(isSteamWorkshopId(id));
      assert.equal(getModWorkshopId({ url: createSteamWorkshopUrl(id) }), id);
      assert.equal(getModWorkshopId({ workshopId: id, url: "not a URL" }), id);
    }),
    propertyOptions,
  );
});

void test("property: malformed arbitrary URLs and IDs never throw or yield invalid Workshop identifiers", () => {
  fc.assert(
    fc.property(extensionArbitrary, textArbitrary, (value, url) => {
      if (isSteamWorkshopId(value)) {
        assert.equal(typeof value, "string");
        assert.equal(getModWorkshopId({ url: createSteamWorkshopUrl(value) }), value);
      }
      const result = getModWorkshopId({ workshopId: url, url });
      assert.ok(result === undefined || isSteamWorkshopId(result));
    }),
    propertyOptions,
  );
});

void test("property: Workshop URL parsing rejects foreign hosts, credentials and unsupported protocols", () => {
  fc.assert(
    fc.property(
      workshopIdArbitrary,
      fc.constantFrom(
        "https://steamcommunity.com.evil.invalid",
        "https://evil.invalid",
        "https://user:password@steamcommunity.com",
        "ftp://steamcommunity.com",
        "https://steamcommunity.com:1234",
      ),
      (id, origin) => {
        assert.equal(
          getModWorkshopId({ url: `${origin}/sharedfiles/filedetails/?id=${id}` }),
          undefined,
        );
      },
    ),
    propertyOptions,
  );
});

void test("property: package matching ignores whitespace, ASCII casing and one Steam suffix", () => {
  fc.assert(
    fc.property(workshopIdArbitrary, fc.constantFrom("", "_steam", "_STEAM"), (id, suffix) => {
      const canonical = `author.mod${id}`;
      assert.equal(normalizePackageId(` \t${canonical.toUpperCase()}${suffix}\n `), canonical);
      assert.equal(normalizePackageId(canonical), canonical);
    }),
    propertyOptions,
  );
});

void test("property: malformed known metadata cannot pass vault normalization", () => {
  const corruption = fc.oneof(
    fc.constant({ field: "subscribed", value: "true" }),
    fc.constant({ field: "source", value: "future-source" }),
    fc.constant({ field: "screenshots", value: {} }),
    fc.constant({ field: "userTagIds", value: [1] }),
    fc.constant({ field: "fileSize", value: -1 }),
    fc.constant({ field: "notes", value: {} }),
  );
  fc.assert(
    fc.property(vaultArbitrary, corruption, (vault, { field, value }) => {
      const bad = { ...vault, mods: [{ id: "bad", name: "Invalid metadata", [field]: value }] };
      assertUnchanged(bad, () => {
        assert.throws(() => normalizeVault(bad), /Invalid/);
      });
    }),
    propertyOptions,
  );
});

void test("property: IPC subscription requests require an actual boolean rather than truthy external data", () => {
  fc.assert(
    fc.property(extensionArbitrary, (value) => {
      const args: unknown[] = ["saved-mod", value];
      if (typeof value === "boolean") {
        validateIpcArgs(ipcChannels.setSubscription, args);
      } else {
        assert.throws(() => {
          validateIpcArgs(ipcChannels.setSubscription, args);
        }, /Invalid application request/);
      }
    }),
    propertyOptions,
  );
});

void test("property: malformed mixed identifier batches are rejected at the IPC boundary", () => {
  fc.assert(
    fc.property(
      fc.array(fc.uuid(), { maxLength: 20 }),
      fc.constantFrom(null, false, 1, {}, []),
      (ids, invalid) => {
        const validArgs: unknown[] = [ids];
        validateIpcArgs(ipcChannels.deleteLibraryMods, validArgs);
        assert.throws(() => {
          validateIpcArgs(ipcChannels.deleteLibraryMods, [[...ids, invalid]]);
        }, /Invalid application request/);
      },
    ),
    propertyOptions,
  );
});
