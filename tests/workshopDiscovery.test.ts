import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { getActiveModsView, InstalledModIndex } from "../src/main/installedMods";
import type { SteamClient } from "../src/main/steamClient";
import { SteamOperations } from "../src/main/steamOperations";
import {
  detectWorkshopModsPath,
  discoverWorkshopFolders,
  importInstalledSteamMods,
  normalizeWorkshopModsPath,
  validateWorkshopModsPath,
  WorkshopDiscoveryCoordinator,
  type WorkshopFolderDiscovery,
} from "../src/main/steamWorkshop";
import { VaultStore } from "../src/main/vaultStore";
import { workshopFolderStatus } from "../src/main/workshopStatus";
import { buildActiveMods } from "../src/renderer/src/utils/activeMods";
import { applyWorkshopStatus } from "../src/renderer/src/utils/library";
import { mapWithConcurrency, withReadTimeout } from "../src/shared/async";
import { assignTagsToMods } from "../src/shared/tags";
import type { Mod } from "../src/shared/types";
import { requireValue } from "../src/shared/validation";
import { mergeSteamSync, normalizeVault, serializeVault } from "../src/shared/vault";

const mod = (id: string, localPath?: string): Mod => ({
  id: `steam-${id}`,
  workshopId: id,
  localPath,
  name: `Saved ${id}`,
  author: "Saved author",
  packageId: `author.mod${id}`,
  source: "steam",
  summary: "Saved description",
  screenshots: ["saved-preview"],
  tags: [],
  userTagIds: ["qol"],
  notes: "Keep my notes",
  gameVersions: ["1.6"],
  subscribed: true,
  downloadedAt: "",
  addedAt: "2025-01-01",
});
const root = (library: string) => join(library, "steamapps", "workshop", "content", "294100");
async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "workshop-discovery-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
const snapshot = (ids: string[]): WorkshopFolderDiscovery => ({
  folders: ids.map((workshopId) => ({ workshopId, path: `folder-${workshopId}` })),
  steamLibraryPaths: ["library"],
  scannedLibraryPaths: ["library"],
  unavailableLibraryPaths: [],
  manifestPaths: [],
  warnings: [],
});

void test("path detection prefers the populated reachable Workshop folder over empty and stale Steam libraries", async () =>
  temporary(async (directory) => {
    const empty = join(directory, "empty");
    const populated = join(directory, "Samsung drive");
    const stale = join(directory, "old-volume-name");
    await mkdir(root(empty), { recursive: true });
    await mkdir(join(root(populated), "1"), { recursive: true });
    await mkdir(join(root(populated), "2"));
    assert.equal(await detectWorkshopModsPath([empty, stale, populated]), root(populated));
    assert.equal(await detectWorkshopModsPath([stale]), null);
    assert.equal(await detectWorkshopModsPath([empty]), root(empty));
  }));

void test("a configured Workshop root bypasses stale VDF libraries, supports spaces and only scans the chosen root", async () =>
  temporary(async (directory) => {
    const selected = root(join(directory, "Samsung drive"));
    const other = join(directory, "other");
    await mkdir(join(selected, "1"), { recursive: true });
    await mkdir(join(root(other), "2"), { recursive: true });
    const discovery = await discoverWorkshopFolders([other, join(directory, "missing")], {
      workshopModsPath: ` ${selected}/ `,
    });
    assert.deepEqual(discovery.folders, [{ workshopId: "1", path: join(selected, "1") }]);
    assert.deepEqual(discovery.warnings, []);
    assert.deepEqual(discovery.unavailableLibraryPaths, []);
    const current = normalizeVault({ mods: [mod("1"), mod("2")] });
    assert.deepEqual(workshopFolderStatus(current, discovery).effectiveIds, ["1"]);
    assert.equal(current.mods.length, 2);
  }));

void test("folder validation accepts an empty 294100 root, but rejects missing, relative, library, file and individual mod paths", async () =>
  temporary(async (directory) => {
    const selected = root(directory);
    await mkdir(selected, { recursive: true });
    assert.equal(await validateWorkshopModsPath(selected), selected);
    assert.equal(
      normalizeWorkshopModsPath(" ~/Library/Application Support/Steam/../Steam "),
      join(homedir(), "Library", "Application Support", "Steam"),
    );
    await assert.rejects(validateWorkshopModsPath("relative/294100"), /absolute path/);
    await assert.rejects(
      validateWorkshopModsPath(join(directory, "absent", "294100")),
      /Saved mod status was preserved/,
    );
    await assert.rejects(validateWorkshopModsPath(directory), /containing numeric Workshop/);
    const singleMod = join(selected, "1");
    await mkdir(join(singleMod, "About"), { recursive: true });
    await assert.rejects(validateWorkshopModsPath(singleMod), /individual mod/);
    const file = join(selected, "file");
    await writeFile(file, "not a directory");
    await assert.rejects(validateWorkshopModsPath(file), /ENOTDIR/);
    const custom = join(directory, "custom-mod-cache");
    await mkdir(join(custom, "123"), { recursive: true });
    assert.equal(await validateWorkshopModsPath(custom), custom);
  }));

void test("access validation opens the Workshop directory directly without following mod paths or reading their metadata", async () =>
  temporary(async (directory) => {
    if (process.platform === "win32") {
      return;
    }
    const selected = root(directory);
    await mkdir(selected, { recursive: true });
    await symlink("1", join(selected, "1"));
    // Following this mod path would fail with ELOOP; opening the parent directory is valid.
    assert.equal(await validateWorkshopModsPath(selected), selected);
    assert.equal(await detectWorkshopModsPath([directory]), selected);
    await assert.rejects(
      discoverWorkshopFolders([directory], { workshopModsPath: selected }),
      /Cannot scan.*configured Workshop mods folder/,
    );
  }));

void test("folder access distinguishes permission denial from a missing drive and never changes directory permissions", async () =>
  temporary(async (directory) => {
    if (process.platform === "win32" || process.getuid?.() === 0) {
      return;
    }
    const selected = root(directory);
    await mkdir(selected, { recursive: true });
    await chmod(selected, 0o000);
    try {
      await assert.rejects(validateWorkshopModsPath(selected), (error: NodeJS.ErrnoException) => {
        assert.ok(error.code === "EACCES" || error.code === "EPERM");
        assert.match(error.message, /Permission denied/);
        return true;
      });
    } finally {
      await chmod(selected, 0o700);
    }
    await assert.rejects(
      validateWorkshopModsPath(join(directory, "absent", "294100")),
      (error: NodeJS.ErrnoException) => {
        assert.equal(error.code, "ENOENT");
        assert.match(error.message, /Folder not found/);
        assert.doesNotMatch(error.message, /Permission denied/);
        return true;
      },
    );
  }));

void test("a missing configured folder blocks refresh and import without rewriting saved mods, status, tags or notes", async () =>
  temporary(async (directory) => {
    const path = join(directory, "vault.json");
    const original = normalizeVault({
      mods: [mod("1")],

      userTags: [{ id: "qol", name: "QoL", color: "green" }],
      settings: { workshopModsPath: join(directory, "unmounted", "294100") },
    });
    const bytes = JSON.stringify(serializeVault(original));
    await writeFile(path, bytes);
    const store = new VaultStore(path);
    const service = new SteamOperations(
      store,
      () => undefined,
      () => assert.fail("Do not connect to Steam"),
      {
        importMods: async () => assert.fail("Do not import from an unavailable override"),
      },
    );
    await assert.rejects(service.refreshSubscriptions(), /configured Workshop mods folder/);
    await assert.rejects(service.inspectWorkshopStatus(), /configured Workshop mods folder/);
    await assert.rejects(service.syncSubscribedMods(), /configured Workshop mods folder/);
    assert.equal(await readFile(path, "utf8"), bytes);
    assert.deepEqual((await store.load()).mods, normalizeVault(JSON.parse(bytes)).mods);
  }));

void test("a disconnected Workshop drive preserves the readable game's active package order and saved mod details", async () =>
  temporary(async (directory) => {
    const configPath = join(directory, "ModsConfig.xml");
    const settings = {
      rimWorldConfigPath: configPath,
      workshopModsPath: join(directory, "disconnected", "294100"),
    };
    const order = ["author.mod2", "ludeon.rimworld", "author.mod1"];
    await writeFile(
      configPath,
      `<ModsConfigData><activeMods>${order.map((id) => `<li>${id}</li>`).join("")}</activeMods></ModsConfigData>`,
    );
    const index = new InstalledModIndex();
    const active = await getActiveModsView(settings, () =>
      index.read([], settings.workshopModsPath),
    );
    assert.equal(active.error, undefined);
    assert.match(active.metadataError ?? "", /Installed mod metadata is unavailable/);
    assert.deepEqual(active.packageIds, order);
    assert.equal(active.configPath, configPath);
    const saved = [mod("1"), mod("2")];
    const entries = buildActiveMods(active, saved).entries;
    assert.deepEqual(
      entries.map((mod) => mod.packageId),
      order,
    );
    assert.equal(requireValue(entries[0]).name, "Saved 2");
    assert.deepEqual(requireValue(entries[0]).userTagIds, ["qol"]);
  }));

void test("passive disk inspection is read-only and permits user tag saves before a slow check finishes", async () =>
  temporary(async (directory) => {
    const path = join(directory, "vault.json");
    const original = normalizeVault({
      mods: [mod("1"), mod("2")],

      revision: "initial",
      userTags: [{ id: "qol", name: "QoL", color: "green" }],
    });
    const bytes = JSON.stringify(serializeVault(original));
    await writeFile(path, bytes);
    const store = new VaultStore(path);
    let finish!: (value: WorkshopFolderDiscovery) => void;
    let reading!: () => void;
    const started = new Promise<void>((resolve) => {
      reading = resolve;
    });
    const discovery = new Promise<WorkshopFolderDiscovery>((resolve) => {
      finish = resolve;
    });
    const service = new SteamOperations(
      store,
      () => undefined,
      () => assert.fail("Passive checks never connect to Steam"),
      {
        discover: async () => {
          reading();
          return discovery;
        },
        activeMods: async () =>
          assert.fail("Passive folder checks do not depend on Active metadata"),
      },
    );
    const pending = service.inspectWorkshopStatus();
    await started;
    assert.equal(await readFile(path, "utf8"), bytes);
    const edited = await store.save(
      assignTagsToMods(await store.load(), ["steam-2"], ["qol"], false),
    );
    finish(snapshot(["1"]));
    const result = await pending;
    assert.deepEqual(result.observedIds, ["1"]);
    assert.equal(result.revision, "initial");
    assert.equal(applyWorkshopStatus(edited, result), edited);
    assert.deepEqual(requireValue((await store.load()).mods[1]).userTagIds, []);
    assert.equal(requireValue((await store.load()).mods[1]).subscribed, true);
    const fast = new SteamOperations(
      store,
      () => undefined,
      () => assert.fail("No Steam connection"),
      { discover: async () => snapshot(["1"]) },
    );
    const savedBytes = await readFile(path, "utf8");
    assert.equal((await fast.inspectWorkshopStatus()).revision, edited.revision);
    assert.equal(await readFile(path, "utf8"), savedBytes);
  }));

void test("read timeouts release callers and ignore late results without treating them as successful empty scans", async () => {
  let finish!: (value: string) => void;
  const pending = new Promise<string>((resolve) => {
    finish = resolve;
  });
  await assert.rejects(
    withReadTimeout(pending, "Disconnected disk timed out", 5),
    /Disconnected disk timed out/,
  );
  finish("late filesystem response");
  assert.equal(await withReadTimeout(Promise.resolve("ready"), "should not time out", 5), "ready");
  await assert.rejects(
    withReadTimeout(Promise.reject(new Error("Permission denied")), "timeout", 5),
    /Permission denied/,
  );
});

void test("Workshop discovery keeps one raw read alive across caller timeouts and keys path changes independently", async () => {
  const pending: {
    promise: Promise<WorkshopFolderDiscovery>;
    resolve: (value: WorkshopFolderDiscovery) => void;
  }[] = [];
  const coordinator = new WorkshopDiscoveryCoordinator(() => {
    let resolve!: (value: WorkshopFolderDiscovery) => void;
    const promise = new Promise<WorkshopFolderDiscovery>((done) => {
      resolve = done;
    });
    pending.push({ promise, resolve });
    return promise;
  });

  const automatic = coordinator.read(["/library/one"], { rimWorldConfigPath: "/ignored" });
  assert.equal(coordinator.read(["/library/one/"]), automatic);
  await assert.rejects(withReadTimeout(automatic, "caller timed out", 1), /caller timed out/);
  assert.equal(coordinator.read(["/library/one"]), automatic);

  const changedLibrary = coordinator.read(["/library/two"]);
  assert.notEqual(changedLibrary, automatic);
  const configured = coordinator.read(["/library/one"], { workshopModsPath: "/mods/current" });
  assert.equal(
    coordinator.read(["/library/two"], { workshopModsPath: "/mods/current/" }),
    configured,
  );
  const changedPath = coordinator.read(["/library/one"], { workshopModsPath: "/mods/next" });
  assert.notEqual(changedPath, configured);
  assert.equal(pending.length, 4);

  pending[0]?.resolve(snapshot(["1"]));
  pending[1]?.resolve(snapshot(["2"]));
  pending[2]?.resolve(snapshot(["3"]));
  pending[3]?.resolve(snapshot(["4"]));
  assert.deepEqual((await automatic).folders, snapshot(["1"]).folders);
  await Promise.all([changedLibrary, configured, changedPath]);

  const fresh = coordinator.read(["/library/one"]);
  assert.notEqual(fresh, automatic);
  assert.equal(pending.length, 5);
  pending[4]?.resolve(snapshot(["5"]));
  await fresh;
});

void test("bounded concurrent mapping limits work while retaining input order", async () => {
  const releases = new Map<number, () => void>();
  const started: number[] = [];
  let active = 0;
  let peak = 0;
  const mapped = mapWithConcurrency([0, 1, 2, 3], 2, async (value) => {
    started.push(value);
    active += 1;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => {
      releases.set(value, resolve);
    });
    active -= 1;
    return `result-${value}`;
  });
  assert.deepEqual(started, [0, 1]);
  releases.get(1)?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2]);
  releases.get(2)?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2, 3]);
  releases.get(3)?.();
  releases.get(0)?.();
  assert.deepEqual(await mapped, ["result-0", "result-1", "result-2", "result-3"]);
  assert.equal(peak, 2);
});

void test("sync and reopening use the saved override, retain absent records and tags, and permit returning to automatic discovery", async () =>
  temporary(async (directory) => {
    const selected = root(join(directory, "selected"));
    const automatic = join(directory, "automatic");
    await mkdir(join(selected, "1"), { recursive: true });
    await mkdir(join(root(automatic), "2"), { recursive: true });
    const path = join(directory, "vault.json");
    await writeFile(
      path,
      JSON.stringify(
        serializeVault(
          normalizeVault({
            mods: [mod("1"), mod("2")],

            userTags: [{ id: "qol", name: "QoL", color: "green" }],
            settings: { workshopModsPath: selected },
          }),
        ),
      ),
    );
    const create = (store: VaultStore) =>
      new SteamOperations(
        store,
        () => undefined,
        () => assert.fail("Do not connect to Steam"),
        {
          discover: (_libraries, settings) =>
            discoverWorkshopFolders([automatic, join(directory, "stale")], settings),
          activeMods: async () => ({ packageIds: [] }),
          importMods: async (discovery) => ({
            mods: discovery.folders.map((folder) => ({
              ...mod(folder.workshopId),
              localPath: folder.path,
            })),
            subscribedIds: ["1"],
            discoveredIds: ["1"],
            warnings: [],
            steamLibraryPaths: [],
            manifestPaths: [],
            missingMetadataIds: [],
          }),
        },
      );
    const result = await create(new VaultStore(path)).syncSubscribedMods();
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.vault.mods.length, 2);
    assert.equal(requireValue(result.vault.mods[1]).subscribed, false);
    assert.equal(requireValue(result.vault.mods[1]).notes, "Keep my notes");
    assert.deepEqual(requireValue(result.vault.mods[1]).userTagIds, ["qol"]);
    const reopened = new VaultStore(path);
    const service = create(reopened);
    assert.equal((await service.refreshSubscriptions()).vault.settings?.workshopModsPath, selected);
    await reopened.update((vault) => ({
      ...vault,
      settings: { ...vault.settings, workshopModsPath: undefined },
    }));
    const reset = await service.refreshSubscriptions();
    assert.deepEqual(reset.failures, []);
    assert.equal(reset.warnings?.length, 1);
    assert.equal(requireValue(reset.vault.mods[1]).subscribed, true);
  }));

void test("Active metadata uses the same override and invalidates its cache when the folder changes, while preserving Core metadata", async () =>
  temporary(async (directory) => {
    const automatic = join(directory, "Steam");
    const selected = root(join(directory, "selected"));
    const changed = root(join(directory, "changed"));
    const core = join(automatic, "steamapps", "common", "RimWorld", "Data", "Core");
    for (const [path, packageId] of [
      [join(root(automatic), "1"), "stale.package"],
      [join(selected, "1"), "correct.package"],
      [join(changed, "2"), "changed.package"],
      [core, "ludeon.rimworld"],
    ]) {
      await mkdir(join(requireValue(path), "About"), { recursive: true });
      await writeFile(
        join(requireValue(path), "About", "About.xml"),
        `<ModMetaData><packageId>${packageId}</packageId></ModMetaData>`,
      );
    }
    await writeFile(
      join(automatic, "steamapps", "appmanifest_294100.acf"),
      '"AppState" { "installdir" "RimWorld" }',
    );
    const index = new InstalledModIndex();
    const first = index.read([automatic], selected);
    assert.equal(index.read([automatic], selected), first);
    const installed = await first;
    assert.equal(installed.find((entry) => entry.workshopId === "1")?.packageId, "correct.package");
    assert.ok(installed.some((entry) => entry.packageId === "ludeon.rimworld"));
    const switched = await index.read([automatic], changed);
    assert.equal(switched.find((entry) => entry.workshopId)?.packageId, "changed.package");
    const restored = await index.read([automatic]);
    assert.equal(restored.find((entry) => entry.workshopId === "1")?.packageId, "stale.package");
    await assert.rejects(
      index.read([automatic], join(directory, "missing", "294100")),
      /Saved mod status was preserved/,
    );
  }));

void test("discovery uses numeric Workshop directories across libraries, not manifests, Steam metadata or local game mods", async () =>
  temporary(async (directory) => {
    const libraries = [join(directory, "first"), join(directory, "external")];
    for (const library of libraries) {
      await mkdir(root(library), { recursive: true });
    }
    await mkdir(join(root(requireValue(libraries[0])), "1"));
    await mkdir(join(root(requireValue(libraries[1])), "2"));
    await mkdir(join(root(requireValue(libraries[1])), "1"));
    await mkdir(join(root(requireValue(libraries[0])), "not-a-workshop-id"));
    await mkdir(join(root(requireValue(libraries[0])), "0"));
    await writeFile(join(root(requireValue(libraries[0])), "3"), "not a mod directory");
    await mkdir(join(requireValue(libraries[0]), "steamapps", "common", "RimWorld", "Mods", "4"), {
      recursive: true,
    });
    await writeFile(
      join(requireValue(libraries[0]), "steamapps", "workshop", "appworkshop_294100.acf"),
      '"WorkshopItemsInstalled" { "999" {} }',
    );
    const result = await discoverWorkshopFolders(libraries);
    assert.deepEqual(
      result.folders.map((entry) => entry.workshopId),
      ["1", "2"],
    );
    assert.equal(result.manifestPaths.length, 1);
    assert.equal(requireValue(result.folders[0]).path, join(root(requireValue(libraries[0])), "1"));
  }));

void test("a readable empty library is distinct from a missing or unreadable library", async () =>
  temporary(async (directory) => {
    const readable = join(directory, "readable");
    const absent = join(directory, "unmounted");
    const broken = join(directory, "broken");
    await mkdir(join(readable, "steamapps"), { recursive: true });
    await mkdir(join(broken, "steamapps", "workshop", "content"), { recursive: true });
    await writeFile(root(broken), "not a directory");
    const result = await discoverWorkshopFolders([readable, absent, broken]);
    assert.deepEqual(result.folders, []);
    assert.deepEqual(result.scannedLibraryPaths, [readable]);
    assert.deepEqual(result.unavailableLibraryPaths, [absent, broken]);
    assert.equal(result.warnings.length, 2);
    await assert.rejects(discoverWorkshopFolders([absent, broken]), /could be read/);
    await assert.rejects(discoverWorkshopFolders([]), /could be found/);
  }));

void test("linked mod directories are detected and broken links do not block a library scan", async () =>
  temporary(async (directory) => {
    if (process.platform === "win32") {
      return;
    }
    await mkdir(root(directory), { recursive: true });
    const target = join(directory, "linked-mod");
    await mkdir(target);
    await symlink(target, join(root(directory), "1"));
    await symlink(join(directory, "missing"), join(root(directory), "2"));
    const result = await discoverWorkshopFolders([directory]);
    assert.deepEqual(
      result.folders.map((entry) => entry.workshopId),
      ["1"],
    );
    assert.deepEqual(result.unavailableLibraryPaths, []);
  }));

void test("over 2000 installed mods are discovered without Workshop query pagination", async () =>
  temporary(async (directory) => {
    await mkdir(root(directory), { recursive: true });
    for (let index = 1; index <= 2061; index += 64) {
      await Promise.all(
        Array.from({ length: Math.min(64, 2062 - index) }, (_, offset) =>
          mkdir(join(root(directory), String(index + offset))),
        ),
      );
    }
    const result = await discoverWorkshopFolders([directory]);
    assert.equal(result.folders.length, 2061);
    assert.ok(result.folders.some((entry) => entry.workshopId === "2061"));
  }));

void test("optional web metadata failures do not prevent import of local names, authors or package IDs", async () =>
  temporary(async (directory) => {
    const path = join(root(directory), "1");
    await mkdir(join(path, "About"), { recursive: true });
    await writeFile(
      join(path, "About", "About.xml"),
      "<ModMetaData><name>Local name</name><author>Local author</author><packageId>local.package</packageId><description>Local description</description></ModMetaData>",
    );
    await mkdir(join(root(directory), "2"));
    const discovery = await discoverWorkshopFolders([directory]);
    let requests = 0;
    const imported = await importInstalledSteamMods(discovery, undefined, async () => {
      requests++;
      throw new Error("Offline");
    });
    assert.equal(requests, 1);
    assert.equal(imported.mods.length, 2);
    assert.equal(requireValue(imported.mods[0]).packageId, "local.package");
    assert.equal(requireValue(imported.mods[0]).author, "Local author");
    assert.equal(requireValue(imported.mods[0]).name, "Local name");
    assert.equal(requireValue(imported.mods[1]).packageId, undefined);
    assert.match(requireValue(imported.warnings[0]), /Offline/);
  }));

void test("bulk import rejects wrong-game metadata and drops malformed optional fields per item", async () =>
  temporary(async (directory) => {
    const folders = ["1", "2", "3"].map((id) => join(root(directory), id));
    for (const path of folders) {
      await mkdir(join(path, "About"), { recursive: true });
    }
    await writeFile(
      join(requireValue(folders[0]), "About", "About.xml"),
      "<ModMetaData><name>Trusted local name</name><packageId>trusted.local</packageId></ModMetaData>",
    );
    const discovery = await discoverWorkshopFolders([directory]);
    const imported = await importInstalledSteamMods(discovery, undefined, async () =>
      Response.json({
        response: {
          publishedfiledetails: [
            {
              publishedfileid: "1",
              result: 1,
              consumer_app_id: 123,
              title: "Foreign game title",
              preview_url: "https://example.invalid/foreign.png",
              creator: "76561198000000001",
              time_created: 1_600_000_000,
              file_size: "4096",
              tags: [{ tag: "Foreign" }],
            },
            {
              publishedfileid: "2",
              result: 1,
              consumer_app_id: 294100,
              title: "Safe title",
              preview_url: "javascript:alert(1)",
              creator: "not-a-steam-id",
              time_created: 1e100,
              time_updated: -1,
              file_size: "-2048",
              tags: [{ tag: "Mod" }, { tag: "1.6" }, { tag: "Utility" }],
            },
            {
              publishedfileid: "3",
              result: 1,
              consumer_app_id: 294100,
              title: "Complete title",
              preview_url: "http://images.example.invalid/preview.png",
              creator: "76561198000000003",
              time_created: 1_600_000_000,
              time_updated: 1_700_000_000,
              file_size: "4096",
              tags: [],
            },
          ],
        },
      }),
    );

    assert.deepEqual(
      imported.mods.map((entry) => entry.workshopId),
      ["1", "2", "3"],
    );
    assert.deepEqual(imported.missingMetadataIds, ["1"]);
    assert.match(imported.warnings.join("\n"), /Workshop 1:.*not a RimWorld mod/);
    const foreign = requireValue(imported.mods[0]);
    assert.equal(foreign.name, "Trusted local name");
    assert.deepEqual(foreign.tags, ["Steam", "Metadata needed"]);
    assert.equal(foreign.thumbnail, undefined);
    assert.equal(foreign.steamCreatorId, undefined);
    assert.equal(foreign.fileSize, undefined);
    const malformed = requireValue(imported.mods[1]);
    assert.equal(malformed.name, "Safe title");
    assert.deepEqual(malformed.tags, ["Steam", "Utility"]);
    assert.deepEqual(malformed.gameVersions, ["1.6"]);
    assert.equal(malformed.thumbnail, undefined);
    assert.equal(malformed.steamCreatorId, undefined);
    assert.equal(malformed.steamPublishedAt, undefined);
    assert.equal(malformed.steamUpdatedAt, undefined);
    assert.equal(malformed.fileSize, undefined);
    const complete = requireValue(imported.mods[2]);
    assert.equal(complete.thumbnail, "https://images.example.invalid/preview.png");
    assert.equal(complete.steamCreatorId, "76561198000000003");
    assert.equal(complete.fileSize, 4096);
    assert.ok(complete.steamPublishedAt);
    assert.ok(complete.steamUpdatedAt);
  }));

void test("malformed app IDs make bulk web metadata unavailable without aborting local import", async () =>
  temporary(async (directory) => {
    const path = join(root(directory), "1");
    const validPath = join(root(directory), "2");
    await mkdir(join(path, "About"), { recursive: true });
    await mkdir(validPath, { recursive: true });
    await writeFile(
      join(path, "About", "About.xml"),
      "<ModMetaData><name>Local fallback</name><packageId>local.fallback</packageId></ModMetaData>",
    );
    const imported = await importInstalledSteamMods(
      await discoverWorkshopFolders([directory]),
      undefined,
      async () =>
        Response.json({
          response: {
            publishedfiledetails: [
              {
                publishedfileid: "1",
                result: 1,
                consumer_app_id: "294100",
                title: "Untrusted remote title",
              },
              {
                publishedfileid: "2",
                result: 1,
                consumer_app_id: 294100,
                title: "Valid remote title",
              },
            ],
          },
        }),
    );
    assert.equal(requireValue(imported.mods[0]).name, "Local fallback");
    assert.equal(requireValue(imported.mods[1]).name, "Valid remote title");
    assert.deepEqual(imported.missingMetadataIds, ["1"]);
    assert.match(imported.warnings.join("\n"), /Workshop 1:.*invalid Workshop app ID/);

    const missingAppIdentity = await importInstalledSteamMods(
      await discoverWorkshopFolders([directory]),
      undefined,
      async () =>
        Response.json({
          response: {
            publishedfiledetails: [
              { publishedfileid: "1", result: 1, title: "Identity-free remote title" },
              {
                publishedfileid: "2",
                result: 1,
                consumer_app_id: 294100,
                title: "Still valid remote title",
              },
            ],
          },
        }),
    );
    assert.equal(requireValue(missingAppIdentity.mods[0]).name, "Local fallback");
    assert.deepEqual(missingAppIdentity.missingMetadataIds, ["1"]);
    assert.match(missingAppIdentity.warnings.join("\n"), /Workshop 1:.*incomplete/);
  }));

void test("junk and malformed core entries do not discard valid bulk metadata siblings", async () =>
  temporary(async (directory) => {
    const fallback = join(root(directory), "1");
    await mkdir(join(fallback, "About"), { recursive: true });
    await mkdir(join(root(directory), "2"), { recursive: true });
    await writeFile(
      join(fallback, "About", "About.xml"),
      "<ModMetaData><name>Local core fallback</name><packageId>local.core</packageId></ModMetaData>",
    );
    const imported = await importInstalledSteamMods(
      await discoverWorkshopFolders([directory]),
      undefined,
      async () =>
        Response.json({
          response: {
            publishedfiledetails: [
              null,
              [],
              { publishedfileid: "invalid", result: 1 },
              { publishedfileid: "999", result: 1, title: "Unrequested" },
              {
                publishedfileid: "1",
                result: "1",
                consumer_app_id: 294100,
                title: "Malformed core title",
              },
              {
                publishedfileid: "2",
                result: 1,
                consumer_app_id: 294100,
                title: "Valid sibling title",
              },
            ],
          },
        }),
    );

    assert.equal(requireValue(imported.mods[0]).name, "Local core fallback");
    assert.equal(requireValue(imported.mods[1]).name, "Valid sibling title");
    assert.deepEqual(imported.missingMetadataIds, ["1"]);
    assert.match(imported.warnings.join("\n"), /Workshop 1:.*invalid Workshop metadata/);
  }));

void test("private web entries and malformed About.xml do not abort discovery or erase existing saved metadata", async () =>
  temporary(async (directory) => {
    await mkdir(join(root(directory), "1", "About"), { recursive: true });
    await writeFile(join(root(directory), "1", "About", "About.xml"), "broken XML");
    const discovery = await discoverWorkshopFolders([directory]);
    const imported = await importInstalledSteamMods(discovery, undefined, async () =>
      Response.json({ response: { publishedfiledetails: [{ publishedfileid: "1", result: 15 }] } }),
    );
    assert.deepEqual(imported.subscribedIds, ["1"]);
    const original = normalizeVault({
      mods: [mod("1"), mod("2")],

      userTags: [{ id: "qol", name: "QoL", color: "green" }],
    });
    const result = mergeSteamSync(original, imported);
    assert.equal(result.mods.length, 2);
    assert.equal(requireValue(result.mods[0]).name, "Saved 1");
    assert.equal(requireValue(result.mods[0]).author, "Saved author");
    assert.equal(requireValue(result.mods[0]).packageId, "author.mod1");
    assert.deepEqual(requireValue(result.mods[0]).screenshots, ["saved-preview"]);
    assert.deepEqual(requireValue(result.mods[0]).userTagIds, ["qol"]);
    assert.equal(requireValue(result.mods[1]).subscribed, false);
    assert.equal(requireValue(result.mods[1]).notes, "Keep my notes");
  }));

void test("concurrent installed reads preserve folder, warning and progress order", async () =>
  temporary(async (directory) => {
    await mkdir(root(directory), { recursive: true });
    for (let id = 1; id <= 21; id += 1) {
      const path = join(root(directory), String(id), "About");
      await mkdir(path, { recursive: true });
      await writeFile(join(path, "About.xml"), "broken XML");
    }
    const discovery = await discoverWorkshopFolders([directory]);
    const progress: { message: string; completed: number }[] = [];
    const imported = await importInstalledSteamMods(
      discovery,
      ({ message, completed }) => {
        progress.push({ message, completed });
      },
      async () =>
        Response.json({
          response: {
            publishedfiledetails: discovery.folders.map(({ workshopId }) => ({
              publishedfileid: workshopId,
              result: 15,
            })),
          },
        }),
    );
    const ids = discovery.folders.map(({ workshopId }) => workshopId);
    assert.deepEqual(
      imported.mods.map(({ workshopId }) => workshopId),
      ids,
    );
    assert.deepEqual(
      imported.warnings
        .filter(
          (warning) =>
            warning.startsWith("Workshop ") && !warning.includes("metadata is unavailable"),
        )
        .map((warning) => requireValue(/^Workshop (\d+):/.exec(warning))[1]),
      ids,
    );
    assert.deepEqual(
      imported.warnings
        .filter((warning) => warning.includes("metadata is unavailable"))
        .map((warning) => requireValue(/^Workshop (\d+):/.exec(warning))[1]),
      ids,
    );
    assert.deepEqual(
      progress
        .filter(({ message }) => message === "Reading installed mod metadata")
        .map(({ completed }) => completed),
      [0, 20],
    );
  }));

void test("partial scans preserve statuses from disconnected libraries and unknown paths, but not similarly prefixed readable paths", () => {
  const first = join(tmpdir(), "steam-first");
  const external = join(tmpdir(), "steam-first-external");
  const original = normalizeVault({
    mods: [mod("1", join(root(first), "1")), mod("2", join(root(external), "2")), mod("3")],
    localSteamState: { observedIds: ["1", "2", "3", "4"], pending: {} },
  });
  const discovery = {
    ...snapshot([]),
    scannedLibraryPaths: [first],
    unavailableLibraryPaths: [external],
  };
  assert.deepEqual(workshopFolderStatus(original, discovery).effectiveIds, ["2", "3", "4"]);
  assert.deepEqual(original.localSteamState.observedIds, ["1", "2", "3", "4"]);
});

void test("confirmed actions override lingering or pending folders until the filesystem agrees, then ordinary folder detection resumes", () => {
  const original = normalizeVault({
    mods: [mod("1"), mod("2")],
    localSteamState: {
      observedIds: ["1"],
      pending: { "1": "unsubscribe", "2": "subscribe" },
    },
  });
  const pending = workshopFolderStatus(original, snapshot(["1"]));
  assert.deepEqual(pending.effectiveIds, ["2"]);
  assert.deepEqual(pending.pending, { "1": "unsubscribe", "2": "subscribe" });
  const settled = workshopFolderStatus(
    { ...original, localSteamState: { ...original.localSteamState, pending: pending.pending } },
    snapshot(["2"]),
  );
  assert.deepEqual(settled.effectiveIds, ["2"]);
  assert.deepEqual(settled.pending, {});
  assert.deepEqual(
    workshopFolderStatus(
      { ...original, localSteamState: { ...original.localSteamState, pending: settled.pending } },
      snapshot(["1", "2"]),
    ).effectiveIds,
    ["1", "2"],
  );
});

void test("refresh and import work with Steam disconnected and retain absent records, tags, notes and game config", async () =>
  temporary(async (directory) => {
    const path = join(directory, "vault.json");
    const game = join(directory, "ModsConfig.xml");
    const rawConfig =
      "<ModsConfigData><activeMods><li>author.mod1</li></activeMods></ModsConfigData>";
    await writeFile(game, rawConfig);
    await writeFile(
      path,
      JSON.stringify(
        serializeVault(
          normalizeVault({
            mods: [mod("1"), mod("2")],

            userTags: [{ id: "qol", name: "QoL", color: "green" }],
            settings: { rimWorldConfigPath: game },
          }),
        ),
      ),
    );
    const store = new VaultStore(path);
    let discoveries = 0;
    const service = new SteamOperations(
      store,
      () => undefined,
      () => assert.fail("Folder discovery must not connect to Steam"),
      {
        discover: async () => {
          discoveries++;
          return snapshot(["1", "3"]);
        },
        activeMods: async () => ({ packageIds: ["author.mod1"] }),
        importMods: async (discovery) => ({
          mods: discovery.folders.map((entry) => mod(entry.workshopId)),
          subscribedIds: ["1", "3"],
          discoveredIds: ["1", "3"],
          manifestPaths: [],
          missingMetadataIds: [],
          steamLibraryPaths: [],
          warnings: [],
        }),
      },
    );
    const refreshed = await service.refreshSubscriptions();
    assert.equal(refreshed.vault.mods.length, 2);
    assert.equal(requireValue(refreshed.vault.mods[1]).subscribed, false);
    const bytes = await readFile(path, "utf8");
    await service.refreshSubscriptions();
    assert.equal(await readFile(path, "utf8"), bytes);
    const synced = await service.syncSubscribedMods();
    assert.equal(discoveries, 4);
    assert.equal(synced.vault.mods.length, 3);
    assert.equal(requireValue(synced.vault.mods[1]).notes, "Keep my notes");
    assert.deepEqual(requireValue(synced.vault.mods[1]).userTagIds, ["qol"]);
    assert.equal(synced.vault.localSteamState.source, "workshop-folders");
    assert.equal(await readFile(game, "utf8"), rawConfig);
    assert.deepEqual((await new VaultStore(path).load()).userTags, refreshed.vault.userTags);
  }));

void test("a confirmed unsubscribe stays in Library through focus scans and reopening while Steam keeps the folder", async () =>
  temporary(async (directory) => {
    const path = join(directory, "vault.json");
    await writeFile(
      path,
      JSON.stringify(
        serializeVault(
          normalizeVault({
            mods: [mod("1")],

            userTags: [{ id: "qol", name: "QoL", color: "green" }],
          }),
        ),
      ),
    );
    const ids = new Set(["1"]);
    const client: SteamClient = {
      refreshSubscribedIds: async () => [...ids],
      subscribedIds: () => [...ids],
      installPath: () => "folder-1",
      subscribe: async (id) => {
        ids.add(id);
      },
      unsubscribe: async (id) => {
        ids.delete(id);
      },
    };
    let folders = ["1"];
    const dependencies = {
      discover: async () => snapshot(folders),
      activeMods: async () => ({ packageIds: [] }),
      assertClosed: async () => undefined,
      about: async () => ({ packageId: "author.mod1" }),
    };
    const store = new VaultStore(path);
    const service = new SteamOperations(
      store,
      () => undefined,
      () => client,
      dependencies,
    );
    await service.refreshSubscriptions();
    const removed = await service.setSubscription("steam-1", false);
    assert.equal(requireValue(removed.vault.mods[0]).subscribed, false);
    assert.deepEqual(removed.vault.localSteamState.pending, { "1": "unsubscribe" });
    const reopened = new SteamOperations(
      new VaultStore(path),
      () => undefined,
      () => client,
      dependencies,
    );
    const pending = await reopened.refreshSubscriptions();
    assert.equal(requireValue(pending.vault.mods[0]).subscribed, false);
    assert.equal(requireValue(pending.vault.mods[0]).notes, "Keep my notes");
    folders = [];
    assert.deepEqual((await reopened.refreshSubscriptions()).vault.localSteamState.pending, {});
    folders = ["1"];
    assert.equal(
      requireValue((await reopened.refreshSubscriptions()).vault.mods[0]).subscribed,
      true,
    );
  }));

void test("a confirmed subscribe stays on the right while downloading, without requiring the folder yet", async () =>
  temporary(async (directory) => {
    const path = join(directory, "vault.json");
    await writeFile(
      path,
      JSON.stringify(
        serializeVault(normalizeVault({ mods: [{ ...mod("1"), subscribed: false }] })),
      ),
    );
    const ids = new Set<string>();
    const client: SteamClient = {
      refreshSubscribedIds: async () => [...ids],
      subscribedIds: () => [...ids],
      installPath: () => undefined,
      subscribe: async (id) => {
        ids.add(id);
      },
      unsubscribe: async (id) => {
        ids.delete(id);
      },
    };
    const service = new SteamOperations(
      new VaultStore(path),
      () => undefined,
      () => client,
      { discover: async () => snapshot([]), activeMods: async () => ({ packageIds: [] }) },
    );
    await service.refreshSubscriptions();
    await service.setSubscription("steam-1", true);
    const result = await service.refreshSubscriptions();
    assert.equal(requireValue(result.vault.mods[0]).subscribed, true);
    assert.deepEqual(result.vault.localSteamState.pending, { "1": "subscribe" });
  }));
