import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";

import fc from "fast-check";

import { deleteLibraryMods } from "../src/main/libraryActions";
import { VaultStore } from "../src/main/vaultStore";
import { vaultBackupDirectory, vaultBackupSuffix } from "../src/shared/storage";
import { normalizeVault, serializeVault } from "../src/shared/vault";
import {
  extensionArbitrary,
  filesystemPropertyOptions,
  temporaryVault,
  vaultArbitrary,
} from "./helpers/properties";

void test("property: persisted vaults retain generated metadata through save and reopen with a previous-version backup", async () => {
  await fc.assert(
    fc.asyncProperty(vaultArbitrary, async (vault) =>
      temporaryVault(async (path) => {
        const initial = JSON.stringify(serializeVault(vault));
        await writeFile(path, initial);
        const store = new VaultStore(path);
        const loaded = await store.load();
        const saved = await store.save(loaded);
        const restored = await new VaultStore(path).load();
        assert.deepEqual(restored, saved);
        assert.equal(await readFile(`${path}${vaultBackupSuffix}`, "utf8"), initial);
        assert.deepEqual(restored.mods, loaded.mods);
        assert.deepEqual(restored.userTags, loaded.userTags);

        assert.deepEqual(Reflect.get(restored, "futureData"), vault.futureData);
        assert.ok(!(await readdir(dirname(path))).some((file) => file.endsWith(".tmp")));
      }),
    ),
    filesystemPropertyOptions,
  );
});

void test("property: stale saves cannot overwrite the latest vault or its backup", async () => {
  await fc.assert(
    fc.asyncProperty(vaultArbitrary, async (vault) =>
      temporaryVault(async (path) => {
        await writeFile(path, JSON.stringify(serializeVault(vault)));
        const store = new VaultStore(path);
        const stale = await store.load();
        const latest = await store.save(stale);
        const raw = await readFile(path, "utf8");
        const backup = await readFile(`${path}${vaultBackupSuffix}`, "utf8");
        await assert.rejects(
          store.save({ ...stale, mods: [], userTags: [] }),
          /changed during this operation/,
        );
        assert.equal(await readFile(path, "utf8"), raw);
        assert.equal(await readFile(`${path}${vaultBackupSuffix}`, "utf8"), backup);
        assert.deepEqual(await new VaultStore(path).load(), latest);
      }),
    ),
    filesystemPropertyOptions,
  );
});

void test("property: external edits block all subsequent writes and preserve the external file byte for byte", async () => {
  await fc.assert(
    fc.asyncProperty(vaultArbitrary, extensionArbitrary, async (vault, extension) =>
      temporaryVault(async (path) => {
        await writeFile(path, JSON.stringify(serializeVault(vault)));
        const store = new VaultStore(path);
        const loaded = await store.load();
        const external = JSON.stringify({
          ...serializeVault(loaded),
          externalEditorData: extension,
        });
        await writeFile(path, external);
        await assert.rejects(store.save(loaded), /outside this app/);
        await assert.rejects(
          store.update((current) => ({ ...current, mods: [] })),
          /outside this app/,
        );
        await assert.rejects(store.assertUnchanged(), /outside this app/);
        assert.equal(await readFile(path, "utf8"), external);
        assert.deepEqual(
          Reflect.get(await new VaultStore(path).load(), "externalEditorData"),
          extension,
        );
      }),
    ),
    filesystemPropertyOptions,
  );
});

void test("property: authorized library deletion checkpoints the complete vault before changing any records", async () => {
  await fc.assert(
    fc.asyncProperty(
      vaultArbitrary.filter((vault) => vault.mods.length > 0),
      fc.nat(),
      async (vault, mask) =>
        temporaryVault(async (path) => {
          const input = {
            ...vault,
            mods: vault.mods.map((mod) => ({ ...mod, subscribed: false })),
            localSteamState: { ...vault.localSteamState, observedIds: [], pending: {} },
          };
          await writeFile(path, JSON.stringify(serializeVault(input)));
          const store = new VaultStore(path);
          const before = await store.load();
          const targets = before.mods
            .filter((_, index) => index === 0 || ((mask >>> index) & 1) !== 0)
            .map((mod) => mod.id);
          const deleted = await deleteLibraryMods(store, targets);
          const backups = await readdir(join(dirname(path), vaultBackupDirectory));
          assert.equal(backups.length, 1);
          const checkpoint: unknown = JSON.parse(
            await readFile(
              join(dirname(path), vaultBackupDirectory, backups[0] ?? "missing"),
              "utf8",
            ),
          );
          assert.deepEqual(normalizeVault(checkpoint), before);
          assert.deepEqual(
            deleted.mods,
            before.mods.filter((mod) => !targets.includes(mod.id)),
          );
          assert.deepEqual(deleted.userTags, before.userTags);
          assert.deepEqual(await new VaultStore(path).load(), deleted);
        }),
    ),
    filesystemPropertyOptions,
  );
});

void test("property: future schema refusal preserves the main database even with a valid older backup", async () => {
  await fc.assert(
    fc.asyncProperty(vaultArbitrary, fc.integer({ min: 1, max: 1000 }), async (vault, increment) =>
      temporaryVault(async (path) => {
        const raw = JSON.stringify({
          ...serializeVault(vault),
          schemaVersion: vault.schemaVersion + increment,
        });
        const backup = JSON.stringify(serializeVault(vault));
        await writeFile(path, raw);
        await writeFile(`${path}${vaultBackupSuffix}`, backup);
        const store = new VaultStore(path);
        await assert.rejects(store.load(), /newer app version/);
        await assert.rejects(store.save(vault), /blocked/);
        assert.equal(await readFile(path, "utf8"), raw);
        assert.equal(await readFile(`${path}${vaultBackupSuffix}`, "utf8"), backup);
      }),
    ),
    filesystemPropertyOptions,
  );
});
