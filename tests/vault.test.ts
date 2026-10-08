import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { atomicWrite, VaultStore } from "../src/main/vaultStore";
import { steamStatusSources, subscriptionCommands } from "../src/shared/domainConstants";
import type { LocalSteamState, Mod, ModVault, SteamImportResult } from "../src/shared/types";
import { requireValue } from "../src/shared/validation";
import {
  createEmptyVault,
  deleteLibraryModsExplicitly,
  mergeSteamSync,
  mergeVaultSave,
  normalizeVault,
  reconcileLocalSteamState,
  serializeVault,
} from "../src/shared/vault";
import { vaultSchemaVersion } from "../src/shared/vaultValidation";

export function mod(id: string, packageId = `author.mod${id}`): Mod {
  return {
    id: `steam-${id}`,
    workshopId: id,
    packageId,
    name: `Mod ${id}`,
    author: "Author",
    source: "steam",
    summary: "Saved description",
    tags: ["QoL"],
    gameVersions: ["1.6"],
    subscribed: true,
    downloadedAt: "2025-01-01",
    addedAt: "2025-01-01",
    screenshots: ["preview"],
    notes: "My notes",
  };
}
export function vault(): ModVault {
  const entry = mod("1");
  return {
    schemaVersion: vaultSchemaVersion,
    mods: [entry, mod("2")],
    userTags: [],
    localSteamState: { observedIds: ["1", "2"], pending: {} },
    settings: {},
  };
}
export function imported(
  mods: Mod[],
  subscribedIds: string[] = mods.map((entry) => requireValue(entry.workshopId)),
): SteamImportResult {
  return {
    mods,
    subscribedIds,
    discoveredIds: subscribedIds,
    warnings: [],
    manifestPaths: [],
    missingMetadataIds: [],
    steamLibraryPaths: [],
  };
}

void test("sync appends mods and marks absent subscriptions false without losing anything", () => {
  const original = vault();
  const next = mergeSteamSync(original, imported([mod("1"), mod("3")]));
  assert.equal(next.mods.length, 3);
  assert.equal(next.mods.find((entry) => entry.id === "steam-2")?.subscribed, false);

  const empty = mergeSteamSync(next, imported([]));
  assert.equal(empty.mods.length, 3);
  assert.ok(empty.mods.every((entry) => !entry.subscribed));
  assert.equal(requireValue(original.mods[1]).subscribed, true);
});

void test("mods imported before an external unsubscribe use the final verified membership, including newly saved entries", () => {
  const original = vault();
  const next = mergeSteamSync(original, imported([mod("1"), mod("3")], []));
  assert.equal(next.mods.length, 3);
  assert.ok(next.mods.every((entry) => !entry.subscribed));
  assert.deepEqual(next.localSteamState.observedIds, []);
  assert.equal(requireValue(next.mods[2]).notes, "My notes");
  assert.equal(original.mods.length, 2);
});

void test("local Steam reconciliation compares observations and pending commands semantically", () => {
  const original = {
    ...vault(),
    localSteamState: {
      source: steamStatusSources.workshopFolders,
      observedIds: ["1", "2"],
      observedAt: "2026-01-01T00:00:00.000Z",
      futureSyncMetadata: { retained: true },
      pending: {
        "3": subscriptionCommands.subscribe,
        "2": subscriptionCommands.unsubscribe,
      },
    } as LocalSteamState & { futureSyncMetadata: { retained: boolean } },
    mods: vault().mods.map((entry) =>
      entry.workshopId === "2" ? { ...entry, subscribed: false } : entry,
    ),
  } satisfies ModVault;
  const reordered = {
    source: steamStatusSources.workshopFolders,
    observedIds: ["2", "1", "2"],
    observedAt: "2026-02-01T00:00:00.000Z",
    pending: {
      "2": subscriptionCommands.unsubscribe,
      "3": subscriptionCommands.subscribe,
    },
  } satisfies LocalSteamState;
  assert.equal(reconcileLocalSteamState(original, reordered), original);

  const changed = reconcileLocalSteamState(original, {
    ...reordered,
    pending: { "3": subscriptionCommands.subscribe },
  });
  assert.notEqual(changed, original);
  assert.equal(changed.mods[0], original.mods[0]);
  assert.notEqual(changed.mods[1], original.mods[1]);
  assert.equal(requireValue(changed.mods[1]).subscribed, true);
  assert.deepEqual(
    (changed.localSteamState as LocalSteamState & { futureSyncMetadata: unknown })
      .futureSyncMetadata,
    { retained: true },
  );
});

void test("failed enrichment retains metadata, notes, first added date and unknown fields", () => {
  const original = { ...vault(), customExtension: { version: 3 } };
  const incoming = {
    ...mod("1"),
    name: "Workshop item 1",
    author: "Unknown author",
    summary: "Steam Workshop metadata imported.",
    packageId: undefined,
    addedAt: "new",
    tags: ["Metadata needed"],
    gameVersions: [],
    screenshots: [],
  };
  const next = mergeSteamSync(original, imported([incoming])) as typeof original;
  assert.deepEqual(next.mods[0], original.mods[0]);
  assert.deepEqual(next.customExtension, original.customExtension);
});

void test("omitting entries on save never deletes mods; deletion is explicit", () => {
  const original = vault();
  const saved = mergeVaultSave(original, { ...original, mods: [], settings: {} });
  assert.equal(saved.mods.length, 2);

  const deleted = deleteLibraryModsExplicitly(mergeSteamSync(saved, imported([], [])), ["steam-1"]);
  assert.equal(deleted.mods.length, 1);
});

void test("normalization keeps unknown fields and rejects unsupported schemas and invalid records", () => {
  const result = normalizeVault({
    ...vault(),
    custom: "retained",
    mods: [{ id: "saved", name: "Saved" }],
  }) as ModVault & { custom: string };
  assert.equal(result.custom, "retained");
  assert.deepEqual(requireValue(result.mods[0]).screenshots, []);
  assert.throws(() => normalizeVault({ ...vault(), schemaVersion: 999 }), /newer app version/);
  assert.throws(() => normalizeVault({ mods: null }), /Invalid/);
});

async function temporary(run: (path: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "mod-vault-test-"));
  try {
    await run(join(directory, "mod-vault.json"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

void test("new libraries, sync and explicit deletion create only current model fields", () => {
  const empty = createEmptyVault();
  const keys = Object.keys(empty).sort();
  assert.deepEqual(keys, ["localSteamState", "mods", "schemaVersion", "settings", "userTags"]);
  const synced = mergeSteamSync(empty, imported([mod("1")], []));
  assert.deepEqual(Object.keys(synced).sort(), keys);
  const deleted = deleteLibraryModsExplicitly(synced, ["steam-1"]);
  assert.deepEqual(Object.keys(deleted).sort(), keys);
  assert.deepEqual(deleted.mods, []);
});

void test("older schemas fail closed even with a current backup and leave both files untouched", async () =>
  temporary(async (path) => {
    const older = JSON.stringify({ ...vault(), schemaVersion: 1 });
    const backup = JSON.stringify(serializeVault(normalizeVault(vault())));
    await writeFile(path, older);
    await writeFile(`${path}.bak`, backup);
    const store = new VaultStore(path);
    await assert.rejects(store.load(), /Unsupported database schema/);
    await assert.rejects(store.save(vault()), /blocked/);
    assert.equal(await readFile(path, "utf8"), older);
    assert.equal(await readFile(`${path}.bak`, "utf8"), backup);
    assert.deepEqual((await readdir(join(path, ".."))).sort(), [
      "mod-vault.json",
      "mod-vault.json.bak",
    ]);
  }));

void test("atomic saves preserve backups; stale revisions and external edits are blocked", async () =>
  temporary(async (path) => {
    await writeFile(path, JSON.stringify(serializeVault(vault())));
    const store = new VaultStore(path);
    const initial = await store.load();
    const saved = await store.save({ ...initial, selectedModId: "steam-2" });
    assert.equal(normalizeVault(JSON.parse(await readFile(`${path}.bak`, "utf8"))).mods.length, 2);
    await assert.rejects(store.save(initial), /changed/);
    const external = JSON.stringify({ ...saved, selectedModId: "external" });
    await writeFile(path, external);
    await assert.rejects(store.save(saved), /outside/);
    assert.equal(await readFile(path, "utf8"), external);
  }));

void test("corruption restores the last good backup and preserves the corrupt original", async () =>
  temporary(async (path) => {
    await writeFile(path, "corrupt original");
    await writeFile(`${path}.bak`, JSON.stringify(serializeVault(vault())));
    const store = new VaultStore(path);
    const loaded = await store.load();
    assert.equal(loaded.mods.length, 2);
    const files = await readdir(join(path, "..", "backups"));
    assert.equal(
      await readFile(join(path, "..", "backups", requireValue(files[0])), "utf8"),
      "corrupt original",
    );
    await store.save(loaded);
  }));

void test("unrecoverable database cannot be overwritten by a save", async () =>
  temporary(async (path) => {
    await writeFile(path, "broken");
    const store = new VaultStore(path);
    await assert.rejects(store.load(), /preserved/);
    await assert.rejects(store.save(vault()), /blocked/);
    assert.equal(await readFile(path, "utf8"), "broken");
  }));

void test("missing main database recovers backup; future schema never falls back", async () =>
  temporary(async (path) => {
    await writeFile(`${path}.bak`, JSON.stringify(serializeVault(vault())));
    const store = new VaultStore(path);
    const loaded = await store.load();
    await store.save(loaded);
    assert.equal(normalizeVault(JSON.parse(await readFile(path, "utf8"))).mods.length, 2);
    await writeFile(path, JSON.stringify({ ...serializeVault(vault()), schemaVersion: 999 }));
    await assert.rejects(new VaultStore(path).load(), /newer/);
  }));

void test("guarded atomic writes do not replace a changed file and clean up temporary files", async () =>
  temporary(async (path) => {
    await writeFile(path, "external change");
    await assert.rejects(atomicWrite(path, "our data", { expected: "old data" }), /outside/);
    assert.equal(await readFile(path, "utf8"), "external change");
    assert.deepEqual(await readdir(join(path, "..")), ["mod-vault.json"]);
  }));
