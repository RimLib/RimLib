import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";

import fc from "fast-check";

import { VaultStore } from "../src/main/vaultStore";
import { fetchWorkshopDetails, refreshModMetadata } from "../src/main/workshopMetadata";
import { RIMWORLD_APP_ID, steamResultCodes } from "../src/shared/steam";
import { requireValue } from "../src/shared/validation";
import { normalizeVault, serializeVault } from "../src/shared/vault";
import {
  filesystemPropertyOptions,
  modArbitrary,
  propertyOptions,
  temporaryVault,
  textArbitrary,
  vaultArbitrary,
  workshopIdArbitrary,
} from "./helpers/properties";

void test("property: public Workshop requests ignore unrelated items and retain large IDs as strings", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.uniqueArray(workshopIdArbitrary, { minLength: 2, maxLength: 12 }),
      textArbitrary,
      async (ids, title) => {
        const requested = ids.slice(1);
        const details = ids.map((id) => ({
          publishedfileid: id,
          result: steamResultCodes.ok,
          title,
        }));
        const request: typeof fetch = async (_url, options) => {
          const body = options?.body;
          assert.ok(body instanceof URLSearchParams);
          assert.equal(body.get("itemcount"), String(requested.length));
          requested.forEach((id, index) => {
            assert.equal(body.get(`publishedfileids[${index}]`), id);
          });
          return Response.json({ response: { publishedfiledetails: details } });
        };
        const result = await fetchWorkshopDetails(requested, request);
        assert.deepEqual(
          result.map((detail) => detail.publishedfileid),
          requested,
        );
        assert.deepEqual(
          result.map((detail) => detail.title),
          requested.map(() => title),
        );
      },
    ),
    propertyOptions,
  );
});

void test("property: metadata refresh preserves personal data, subscription membership and unrelated records", async () => {
  await fc.assert(
    fc.asyncProperty(
      vaultArbitrary,
      modArbitrary,
      workshopIdArbitrary,
      textArbitrary,
      async (vault, metadata, id, description) =>
        temporaryVault(async (path) => {
          const mod = {
            ...metadata,
            id: `target-${id}`,
            workshopId: id,
            userTagIds: vault.userTags.map((tag) => tag.id),
            subscribed: false,
          };
          await writeFile(
            path,
            JSON.stringify(serializeVault({ ...vault, mods: [...vault.mods, mod] })),
          );
          const store = new VaultStore(path);
          const before = await store.load();
          const original = requireValue(before.mods.find((entry) => entry.id === mod.id));
          const request: typeof fetch = async () =>
            Response.json({
              response: {
                publishedfiledetails: [
                  {
                    publishedfileid: id,
                    result: steamResultCodes.ok,
                    consumer_app_id: RIMWORLD_APP_ID,
                    title: "Refreshed Workshop title",
                    description,
                    preview_url: `https://images.example.invalid/${id}.png`,
                  },
                ],
              },
            });
          const refreshed = await refreshModMetadata(store, mod.id, request);
          const saved = requireValue(refreshed.mods.find((entry) => entry.id === mod.id));
          assert.equal(saved.name, "Refreshed Workshop title");
          assert.equal(saved.summary, description);
          assert.equal(saved.author, original.author);
          assert.equal(saved.packageId, original.packageId);
          assert.equal(saved.notes, original.notes);
          assert.equal(saved.subscribed, original.subscribed);
          assert.equal(saved.addedAt, original.addedAt);
          assert.equal(saved.downloadedAt, original.downloadedAt);
          assert.deepEqual(saved.userTagIds, original.userTagIds);
          assert.deepEqual(Reflect.get(saved, "futureData"), Reflect.get(original, "futureData"));
          assert.deepEqual(refreshed.userTags, before.userTags);
          assert.deepEqual(
            refreshed.mods.filter((entry) => entry.id !== mod.id),
            before.mods.filter((entry) => entry.id !== mod.id),
          );
          assert.deepEqual(refreshed.localSteamState, before.localSteamState);
        }),
    ),
    filesystemPropertyOptions,
  );
});

void test("property: unavailable Workshop metadata never writes to the database", async () => {
  await fc.assert(
    fc.asyncProperty(
      modArbitrary,
      workshopIdArbitrary,
      fc.integer({ min: 2, max: 100 }),
      async (metadata, id, resultCode) =>
        temporaryVault(async (path) => {
          const mod = { ...metadata, id: `steam-${id}`, workshopId: id };
          const raw = JSON.stringify(serializeVault(normalizeVault({ mods: [mod] })));
          await writeFile(path, raw);
          const store = new VaultStore(path);
          const before = await store.load();
          const request: typeof fetch = async () =>
            Response.json({
              response: { publishedfiledetails: [{ publishedfileid: id, result: resultCode }] },
            });
          await assert.rejects(refreshModMetadata(store, mod.id, request), /preserved/);
          assert.deepEqual(await store.load(), before);
          assert.equal(await readFile(path, "utf8"), raw);
        }),
    ),
    filesystemPropertyOptions,
  );
});
