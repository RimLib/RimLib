import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { InstalledModIndex } from "../src/main/installedMods";
import { getActiveMods } from "../src/main/rimWorldConfig";
import type { SteamClient } from "../src/main/steamClient";
import { SteamOperations } from "../src/main/steamOperations";
import { parseVdf, readAboutXml, type WorkshopFolderDiscovery } from "../src/main/steamWorkshop";
import { VaultStore } from "../src/main/vaultStore";
import { subscriptionPanels } from "../src/renderer/src/utils/library";
import { steamStatusSources, subscriptionCommands } from "../src/shared/domainConstants";
import type { Mod, ModVault, SteamImportResult, SteamOperationProgress } from "../src/shared/types";
import { requireValue } from "../src/shared/validation";
import { deleteLibraryModsExplicitly, normalizeVault, serializeVault } from "../src/shared/vault";

const makeMod = (id: string, packageId = `author.mod${id}`): Mod => ({
  id: `steam-${id}`,
  workshopId: id,
  packageId,
  name: `Mod ${id}`,
  author: "Author",
  source: "steam",
  summary: "Summary",
  tags: [],
  gameVersions: [],
  subscribed: true,
  downloadedAt: "",
  addedAt: "",
  screenshots: [],
});
const config =
  '<?xml version="1.0" encoding="utf-8"?><ModsConfigData><version>1.6</version><activeMods><li>brrainz.harmony</li><li>ludeon.rimworld</li><li>ludeon.rimworld.royalty</li><li>Author.Mod1_steam</li></activeMods><knownExpansions><li>ludeon.rimworld.royalty</li></knownExpansions><custom flag="retained">value</custom></ModsConfigData>';
const discovered = (ids: string[]): WorkshopFolderDiscovery => ({
  folders: ids.map((workshopId) => ({ workshopId, path: workshopId })),
  steamLibraryPaths: [],
  scannedLibraryPaths: ["test-library"],
  unavailableLibraryPaths: [],
  manifestPaths: [],
  warnings: [],
});

void test("a draft binds its Workshop identity and cannot change a replacement record's subscription", async () => {
  await setup(async (store, _client, calls, create) => {
    const before = JSON.stringify(await store.load());
    const service = create();
    await assert.rejects(service.setSubscription("steam-2", false, "999"), /identity changed/);
    assert.deepEqual(calls, []);
    assert.equal(JSON.stringify(await store.load()), before);
    const result = await service.setSubscription("steam-2", false, "2");
    assert.equal(result.unsubscribed, 1);
    assert.deepEqual(calls, ["unsubscribe:2"]);
  });
});

void test("read config supports custom location and reports missing/corrupt config without assuming an empty active list", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rimworld-config-"));
  const path = join(directory, "ModsConfig.xml");
  try {
    await writeFile(path, config);
    const active = await getActiveMods({ rimWorldConfigPath: path });
    assert.equal(active.gameVersion, "1.6");
    assert.deepEqual(active.packageIds, [
      "brrainz.harmony",
      "ludeon.rimworld",
      "ludeon.rimworld.royalty",
      "Author.Mod1_steam",
    ]);
    await writeFile(path, "broken");
    assert.ok((await getActiveMods({ rimWorldConfigPath: path })).error);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("local metadata uses package and author from About.xml, case-insensitive folder names", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rimworld-about-"));
  try {
    await mkdir(join(directory, "ABOUT"));
    await writeFile(
      join(directory, "ABOUT", "about.XML"),
      "<ModMetaData><name>Local metadata</name><authors><li>Alice</li><li>Bob</li></authors><packageId>author.mod</packageId><supportedVersions><li>1.6</li></supportedVersions></ModMetaData>",
    );
    const mod = await readAboutXml(directory);
    assert.equal(mod.author, "Alice, Bob");
    assert.equal(mod.packageId, "author.mod");
    assert.deepEqual(mod.gameVersions, ["1.6"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("local metadata reads and deduplicates declared dependencies, including version-specific entries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rimworld-dependencies-"));
  try {
    await mkdir(join(directory, "About"));
    await writeFile(
      join(directory, "About", "About.xml"),
      `<ModMetaData>
        <packageId>author.mod</packageId>
        <modDependencies>
          <li><packageId>brrainz.harmony</packageId><displayName>Harmony</displayName></li>
          <li><packageId>AUTHOR.FRAMEWORK</packageId></li>
        </modDependencies>
        <modDependenciesByVersion>
          <v1.6>
            <li><packageId>author.framework</packageId><displayName>Framework</displayName></li>
            <li><packageId>author.library</packageId><displayName>Library</displayName></li>
          </v1.6>
        </modDependenciesByVersion>
      </ModMetaData>`,
    );
    assert.deepEqual((await readAboutXml(directory)).dependencies, [
      { packageId: "brrainz.harmony", displayName: "Harmony" },
      { packageId: "author.framework", displayName: "Framework" },
      { packageId: "author.library", displayName: "Library", gameVersions: ["1.6"] },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("Steam library VDF preserves empty labels and still reads subsequent external libraries", () => {
  const parsed = parseVdf(
    '"libraryfolders" { "0" { "path" "/home/Steam" "label" "" "apps" {} } "1" { "path" "/external/SteamLibrary" "label" "" "apps" { "294100" "123" } } }',
  );
  assert.deepEqual(parsed.libraryfolders, {
    "0": { path: "/home/Steam", label: "", apps: {} },
    "1": { path: "/external/SteamLibrary", label: "", apps: { "294100": "123" } },
  });
});

void test("About.xml cache detects changed package metadata rather than keeping stale identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rimworld-about-cache-"));
  try {
    await mkdir(join(directory, "About"));
    const path = join(directory, "About", "About.xml");
    await writeFile(
      path,
      "<ModMetaData><packageId>author.first</packageId><name>First mod</name></ModMetaData>",
    );
    assert.equal((await readAboutXml(directory)).packageId, "author.first");
    assert.equal((await readAboutXml(directory)).name, "First mod");
    await writeFile(
      path,
      "<ModMetaData><packageId>author.changed</packageId><name>Changed mod</name></ModMetaData>",
    );
    assert.equal((await readAboutXml(directory)).packageId, "author.changed");
    assert.equal((await readAboutXml(directory)).name, "Changed mod");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("installed metadata finds Workshop, local mods and Core/DLC in Steam's actual library and macOS bundle", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rimworld-installed-"));
  try {
    const steamapps = join(directory, "steamapps");
    const game = join(steamapps, "common", "Custom RimWorld", "RimWorldMac.app");
    const workshop = join(steamapps, "workshop", "content", "294100", "123");
    const definitions = [
      [join(game, "Data", "Core"), "ludeon.rimworld", "Core"],
      [join(game, "Data", "Royalty"), "ludeon.rimworld.royalty", "Royalty"],
      [join(game, "Mods", "MyLocalMod"), "author.local", "Local mod"],
      [workshop, "brrainz.achtung", "Achtung!"],
    ];
    for (const [path, packageId, name] of definitions) {
      await mkdir(join(requireValue(path), "About"), { recursive: true });
      await writeFile(
        join(requireValue(path), "About", "About.xml"),
        `<ModMetaData><name>${name}</name><modDependencies><li><packageId>brrainz.harmony</packageId></li></modDependencies><packageId>${packageId}</packageId></ModMetaData>`,
      );
    }
    await writeFile(
      join(steamapps, "appmanifest_294100.acf"),
      '"AppState" { "installdir" "Custom RimWorld" }',
    );
    const index = new InstalledModIndex();
    const first = index.read([directory]);
    assert.equal(index.read([directory]), first);
    const mods = await first;
    assert.deepEqual(
      new Set(mods.map((mod) => mod.packageId)),
      new Set(["ludeon.rimworld", "ludeon.rimworld.royalty", "author.local", "brrainz.achtung"]),
    );
    assert.equal(mods.find((mod) => mod.packageId === "brrainz.achtung")?.workshopId, "123");
    assert.deepEqual(mods.find((mod) => mod.packageId === "brrainz.achtung")?.dependencies, [
      { packageId: "brrainz.harmony" },
    ]);
    assert.equal(mods.find((mod) => mod.packageId === "ludeon.rimworld")?.workshopId, undefined);
    assert.equal(mods.find((mod) => mod.workshopId === "123")?.name, "Achtung!");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function setup(
  run: (
    store: VaultStore,
    client: SteamClient,
    calls: string[],
    create: (
      overrides?: NonNullable<ConstructorParameters<typeof SteamOperations>[3]>,
      progress?: (value: SteamOperationProgress) => void,
    ) => SteamOperations,
  ) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "steam-operations-"));
  const entries = [makeMod("1"), makeMod("2"), makeMod("3", "Unknown")];
  const vault: ModVault = normalizeVault({
    mods: entries,
  });
  const subscribed = new Set(["1", "2", "3"]);
  const calls: string[] = [];
  const client: SteamClient = {
    refreshSubscribedIds: async () => [...subscribed],
    subscribedIds: () => [...subscribed],
    installPath: (id) => id,
    subscribe: async (id) => {
      calls.push(`subscribe:${id}`);
      subscribed.add(id);
    },
    unsubscribe: async (id) => {
      calls.push(`unsubscribe:${id}`);
      subscribed.delete(id);
    },
  };
  try {
    const path = join(directory, "vault.json");
    await writeFile(path, JSON.stringify(serializeVault(vault)));
    const store = new VaultStore(path);
    await store.load();
    const create = (
      overrides: NonNullable<ConstructorParameters<typeof SteamOperations>[3]> = {},
      progress: (value: SteamOperationProgress) => void = () => undefined,
    ) =>
      new SteamOperations(store, progress, () => client, {
        discover: async () => discovered([...subscribed]),
        activeMods: async () => ({
          packageIds: ["ludeon.rimworld", "author.mod1"],
          configPath: "config",
        }),
        assertClosed: async () => undefined,
        importMods: async () =>
          ({
            mods: entries,
            subscribedIds: [...subscribed],
            discoveredIds: [],
            missingMetadataIds: [],
            manifestPaths: [],
            steamLibraryPaths: [],
            warnings: [],
          }) satisfies SteamImportResult,
        about: async (id) => ({ packageId: `author.mod${id}`, author: undefined }),
        ...overrides,
      });
    await run(store, client, calls, create);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

void test("sync persists and publishes folder-derived flags before slow or failed metadata enrichment", async () =>
  setup(async (store, client, calls) => {
    await store.update((vault) => ({
      ...vault,
      mods: vault.mods.map((mod) => ({ ...mod, userTagIds: ["tag"], notes: "Keep me" })),
      userTags: [...vault.userTags, { id: "tag", name: "QoL", color: "#7fbf90" }],
    }));
    const original = await store.load();
    await client.unsubscribe("3");
    calls.length = 0;
    const progress: SteamOperationProgress[] = [];
    const service = new SteamOperations(
      store,
      (value) => progress.push(value),
      () => client,
      {
        discover: async () => discovered(client.subscribedIds()),
        importMods: async () => {
          const published = progress.find((value) => value.vault)?.vault;
          assert.ok(published);
          const entry = requireValue(published.mods.find((mod) => mod.id === "steam-3"));
          assert.equal(entry.subscribed, false);
          assert.deepEqual(entry.userTagIds, ["tag"]);
          assert.equal(entry.notes, "Keep me");
          assert.equal(published.mods.length, original.mods.length);
          assert.equal(requireValue((await store.load()).mods[2]).subscribed, false);
          const panels = subscriptionPanels(published, published.mods, { packageIds: [] }, []);
          assert.ok(panels.unsubscribed.some((mod) => mod.id === entry.id));
          assert.ok(!panels.subscribed.some((mod) => mod.id === entry.id));
          throw new Error("Metadata unavailable");
        },
      },
    );
    await assert.rejects(service.syncSubscribedMods(), /Metadata unavailable/);
    const saved = await store.load();
    assert.equal(saved.mods.length, original.mods.length);
    assert.deepEqual(saved.userTags, original.userTags);
    assert.equal(requireValue(saved.mods[2]).subscribed, false);
    assert.deepEqual(calls, []);
  }));

void test("sync rescans folders after metadata import rather than restoring stale flags", async () =>
  setup(async (store, client, calls, create) => {
    await store.update((vault) => ({
      ...vault,
      mods: vault.mods.map((mod) => ({ ...mod, notes: "Retained" })),
    }));
    const original = await store.load();
    const checks: (boolean | undefined)[] = [];
    const refresh = client.refreshSubscribedIds.bind(client);
    client.refreshSubscribedIds = async (progress, force) => {
      checks.push(force);
      return refresh(progress, force);
    };
    const service = create({
      importMods: async () => {
        const subscribedIds = client.subscribedIds();
        await client.unsubscribe("2");
        calls.length = 0;
        return {
          mods: [...original.mods, makeMod("4")],
          subscribedIds,
          discoveredIds: [],
          missingMetadataIds: [],
          manifestPaths: [],
          steamLibraryPaths: [],
          warnings: [],
        } satisfies SteamImportResult;
      },
    });
    const result = await service.syncSubscribedMods();
    assert.deepEqual(checks, []);
    assert.equal(result.vault.mods.find((mod) => mod.id === "steam-2")?.subscribed, false);
    assert.equal(result.vault.mods.find((mod) => mod.id === "steam-4")?.subscribed, false);
    assert.deepEqual(result.vault.localSteamState.observedIds, ["1", "3"]);
    assert.equal(requireValue(result.vault.mods[1]).notes, "Retained");
    assert.equal(result.vault.mods.length, 4);
    assert.deepEqual(calls, []);
  }));

void test("failed folder discovery leaves the database byte-for-byte intact and skips metadata import", async () =>
  setup(async (store, client, calls, create) => {
    const before = await readFile(store.path, "utf8");
    client.refreshSubscribedIds = async () => {
      throw new Error("Incomplete subscription list");
    };
    const service = create({
      discover: async () => {
        throw new Error("Unreadable Workshop folders");
      },
      importMods: async () => {
        assert.fail("Metadata import must wait for folder discovery");
      },
    });
    await assert.rejects(service.syncSubscribedMods(), /Unreadable/);
    await assert.rejects(service.refreshSubscriptions(), /Unreadable/);
    assert.equal(await readFile(store.path, "utf8"), before);
    assert.deepEqual(calls, []);
  }));

void test("failed Steam initialization preserves saved mods and tags and releases the action lock for a later retry", async () =>
  setup(async (store, client, calls) => {
    await store.update((vault) => ({
      ...vault,
      selectedModId: "steam-2",
      userTags: [{ id: "qol", name: "QoL", color: "#7fbf90" }],
      mods: vault.mods.map((mod) => ({ ...mod, userTagIds: ["qol"], notes: "Keep my note" })),
    }));
    let running = false;
    const service = new SteamOperations(
      store,
      () => undefined,
      () => {
        if (!running) {
          throw new Error("Cannot connect to Steam: client not running");
        }
        return client;
      },
      {
        activeMods: async () => ({ packageIds: ["author.mod1"], configPath: "config" }),
        assertClosed: async () => undefined,
        about: async (id) => ({ packageId: `author.mod${id}` }),
      },
    );
    const original = await readFile(store.path, "utf8");
    await assert.rejects(service.setSubscription("steam-2", false), /Cannot connect/);
    await assert.rejects(
      service.previewLibrarySubscriptions("subscribe-mods", ["steam-2"]),
      /Cannot connect/,
    );
    assert.equal(await readFile(store.path, "utf8"), original);
    assert.deepEqual(calls, []);

    running = true;
    const removed = await service.setSubscription("steam-2", false);
    assert.equal(removed.unsubscribed, 1);
    const restored = await service.setSubscription("steam-2", true);
    assert.equal(restored.subscribed, 1);
    assert.deepEqual(calls, ["unsubscribe:2", "subscribe:2"]);
    assert.equal(restored.vault.selectedModId, "steam-2");
    assert.equal(restored.vault.mods.length, 3);
    assert.deepEqual(restored.vault.userTags, [{ id: "qol", name: "QoL", color: "#7fbf90" }]);
    assert.ok(
      restored.vault.mods.every(
        (mod) => mod.notes === "Keep my note" && mod.userTagIds?.[0] === "qol",
      ),
    );
  }));

void test("a timed-out mutation blocks retries until its late result is refreshed and persisted", async () =>
  setup(async (store, client, calls, create) => {
    await store.update((current) => ({
      ...current,
      localSteamState: {
        ...current.localSteamState,
        source: steamStatusSources.workshopFolders,
      },
    }));
    let release: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let nativeCalls = 0;
    const unsubscribe = client.unsubscribe.bind(client);
    client.unsubscribe = async (id) => {
      nativeCalls++;
      await waiting;
      await unsubscribe(id);
    };
    const refresh = client.refreshSubscribedIds.bind(client);
    const refreshForces: (boolean | undefined)[] = [];
    client.refreshSubscribedIds = async (progress, force) => {
      refreshForces.push(force);
      return refresh(progress, force);
    };
    const progress: SteamOperationProgress[] = [];
    const service = create({ subscriptionTimeoutMs: 1 }, (value) => {
      progress.push(value);
      if (value.message === "Timed-out Steam request reconciled") {
        throw new Error("Renderer disappeared");
      }
    });

    const timedOut = await service.setSubscription("steam-2", false);
    assert.equal(timedOut.unsubscribed, 0);
    assert.match(requireValue(timedOut.failures[0]), /timed out/);
    assert.equal(nativeCalls, 1);
    await assert.rejects(service.setSubscription("steam-2", false), /already running/);
    assert.equal(nativeCalls, 1);

    requireValue(release)();
    let reconciled = await store.load();
    for (let attempt = 0; attempt < 20 && reconciled.mods[1]?.subscribed; attempt++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      reconciled = await store.load();
    }
    assert.equal(requireValue(reconciled.mods[1]).subscribed, false);
    assert.equal(reconciled.localSteamState.pending["2"], subscriptionCommands.unsubscribe);
    assert.ok(refreshForces.includes(true));
    assert.equal(
      progress.find((entry) => entry.message === "Timed-out Steam request reconciled")?.vault
        ?.mods[1]?.subscribed,
      false,
    );

    await new Promise<void>((resolve) => setImmediate(resolve));
    const verifiedRetry = await service.setSubscription("steam-2", false);
    assert.equal(verifiedRetry.failures.length, 0);
    assert.equal(nativeCalls, 1);
    assert.deepEqual(calls, ["unsubscribe:2"]);
  }));

void test("failed timeout reconciliation keeps subscription mutations blocked until restart", async () =>
  setup(async (_store, client, _calls, create) => {
    let rejectMutation: ((error: Error) => void) | undefined;
    const settlement = new Promise<void>((_resolve, reject) => {
      rejectMutation = reject;
    });
    let nativeCalls = 0;
    client.unsubscribe = async () => {
      nativeCalls++;
      await settlement;
    };
    let reconciliationStarted: (() => void) | undefined;
    const reconciling = new Promise<void>((resolve) => {
      reconciliationStarted = resolve;
    });
    const refresh = client.refreshSubscribedIds.bind(client);
    client.refreshSubscribedIds = async (progress, force) => {
      if (force) {
        requireValue(reconciliationStarted)();
        throw new Error("Steam refresh unavailable");
      }
      return refresh(progress, force);
    };
    const service = create({ subscriptionTimeoutMs: 1 });

    const timedOut = await service.setSubscription("steam-2", false);
    assert.match(requireValue(timedOut.failures[0]), /timed out/);
    assert.equal(nativeCalls, 1);

    requireValue(rejectMutation)(new Error("Late native failure"));
    await reconciling;
    await new Promise<void>((resolve) => setImmediate(resolve));
    await assert.rejects(
      service.setSubscription("steam-2", false),
      /could not be reconciled.*Restart/,
    );
    assert.equal(nativeCalls, 1);
  }));

void test("unavailable installed metadata blocks non-active cleanup without changing subscriptions or the library", async () =>
  setup(async (store, _client, calls, create) => {
    const before = await store.load();
    const service = create({
      activeMods: async () => ({
        packageIds: ["ludeon.rimworld", "author.mod1"],
        metadataError: "Workshop drive disconnected",
      }),
    });
    await assert.rejects(
      service.previewLibrarySubscriptions("unsubscribe-mods", ["steam-2"]),
      /Workshop drive disconnected/,
    );
    assert.deepEqual(calls, []);
    assert.deepEqual(await store.load(), before);
  }));

void test("unreadable or unresolved Active blocks new cleanup before changing Steam or the database", async () =>
  setup(async (store, _client, calls, create) => {
    const original = await readFile(store.path, "utf8");
    await assert.rejects(
      create({
        activeMods: async () => ({ packageIds: [], error: "Unreadable config" }),
      }).previewLibrarySubscriptions("unsubscribe-mods", ["steam-2"]),
      /Unreadable/,
    );
    await assert.rejects(
      create({
        about: async () => ({ packageId: undefined, author: undefined }),
      }).previewLibrarySubscriptions("unsubscribe-mods", ["steam-2"]),
      /Active status could not be verified/,
    );
    assert.deepEqual(calls, []);
    assert.equal(await readFile(store.path, "utf8"), original);
  }));

void test("single Active unsubscribe is rejected without touching Steam, the database or game configuration", async () =>
  setup(async (store, _client, calls, create) => {
    const service = create();
    const before = await readFile(store.path, "utf8");
    await assert.rejects(
      service.previewLibrarySubscriptions("unsubscribe-mods", ["steam-1"]),
      /Active mods cannot be unsubscribed/,
    );
    await assert.rejects(
      service.setSubscription("steam-1", false),
      /Active mods cannot be unsubscribed/,
    );
    assert.deepEqual(calls, []);
    assert.equal(await readFile(store.path, "utf8"), before);
  }));

void test("multi-selected unsubscribe rejects a group containing Active mods atomically and retains every tag", async () =>
  setup(async (store, _client, calls, create) => {
    await store.update((vault) => ({
      ...vault,
      userTags: [...vault.userTags, { id: "tag", name: "QoL", color: "#7fbf90" }],
      mods: vault.mods.map((mod) => ({ ...mod, userTagIds: ["tag"] })),
    }));
    const service = create();
    const before = await readFile(store.path, "utf8");
    await assert.rejects(
      service.previewLibrarySubscriptions("unsubscribe-mods", ["steam-2", "steam-1"]),
      /Active mods cannot be unsubscribed/,
    );
    assert.deepEqual(calls, []);
    assert.equal(await readFile(store.path, "utf8"), before);
    assert.deepEqual(
      (await store.load()).mods.map((mod) => mod.userTagIds),
      [["tag"], ["tag"], ["tag"]],
    );
  }));

void test("single unsubscribe is blocked when a mod's enabled status cannot be determined", async () =>
  setup(async (store, _client, calls, create) => {
    const before = await readFile(store.path, "utf8");
    const service = create({ about: async () => ({}) });
    await assert.rejects(
      service.previewLibrarySubscriptions("unsubscribe-mods", ["steam-3"]),
      /Active status could not be verified/,
    );
    await assert.rejects(
      service.setSubscription("steam-3", false),
      /Active status could not be verified/,
    );
    assert.equal(await readFile(store.path, "utf8"), before);
    assert.deepEqual(calls, []);
  }));

void test("cached packages cannot authorize unsubscribing when the installed mod folder cannot be found", async () =>
  setup(async (store, client, calls, create) => {
    client.installPath = () => undefined;
    const before = await readFile(store.path, "utf8");
    const service = create();
    await assert.rejects(
      service.setSubscription("steam-2", false),
      /Active status could not be verified/,
    );
    await assert.rejects(
      service.previewLibrarySubscriptions("unsubscribe-mods", ["steam-2"]),
      /Active status could not be verified/,
    );
    assert.deepEqual(calls, []);
    assert.equal(await readFile(store.path, "utf8"), before);
  }));

void test("direct unsubscribe rechecks Active after its preflight before invoking Steam", async () =>
  setup(async (store, _client, calls, create) => {
    let reads = 0;
    const service = create({
      activeMods: async () => ({
        packageIds: ++reads === 1 ? ["author.mod1"] : ["author.mod1", "author.mod2"],
      }),
    });
    const result = await service.setSubscription("steam-2", false);
    assert.equal(result.unsubscribed, 0);
    assert.match(requireValue(result.failures[0]), /Active mods cannot be unsubscribed/);
    assert.deepEqual(calls, []);
    assert.equal(requireValue((await store.load()).mods[1]).subscribed, true);
  }));

void test("lightweight subscription refresh preserves saved records, tags and explicit deletions, and does not write unchanged flags", async () =>
  setup(async (store, client, calls, create) => {
    const service = create();
    await service.setSubscription("steam-2", false);
    await store.update((vault) => deleteLibraryModsExplicitly(vault, ["steam-2"]));
    const first = await service.refreshSubscriptions();
    const before = await readFile(store.path, "utf8");
    const again = await service.refreshSubscriptions();
    assert.equal(again.vault.revision, first.vault.revision);
    assert.equal(await readFile(store.path, "utf8"), before);
    assert.equal(again.vault.mods.length, 2);

    await client.unsubscribe("1");
    calls.length = 0;
    const refreshed = await service.refreshSubscriptions();
    assert.equal(refreshed.vault.mods.length, 2);
    assert.equal(requireValue(refreshed.vault.mods[0]).subscribed, false);
    assert.deepEqual(refreshed.vault.userTags, first.vault.userTags);
    assert.deepEqual(calls, []);
  }));

void test("single subscribe moves flags only, is idempotent, and never writes the game's enabled configuration", async () =>
  setup(async (_store, client, calls, create) => {
    await client.unsubscribe("2");
    calls.length = 0;
    const service = create();
    const result = await service.setSubscription("steam-2", true);
    assert.equal(result.subscribed, 1);
    assert.equal(result.vault.mods.length, 3);
    assert.equal(requireValue(result.vault.mods[1]).subscribed, true);
    assert.deepEqual(result.activeMods.packageIds, ["ludeon.rimworld", "author.mod1"]);
    const again = await service.setSubscription("steam-2", true);
    assert.equal(again.subscribed, 0);
    assert.deepEqual(calls, ["subscribe:2"]);
  }));

void test("preflight deduplicates explicit saved targets without changing subscriptions", async () =>
  setup(async (store, client, calls, create) => {
    const service = create();
    const before = await readFile(store.path, "utf8");
    const checked = await service.previewLibrarySubscriptions("unsubscribe-mods", [
      "steam-2",
      "steam-2",
    ]);
    assert.deepEqual(
      checked.mods.map((mod) => mod.id),
      ["steam-2"],
    );
    assert.equal("token" in checked, false);

    assert.deepEqual(calls, []);
    assert.equal(await readFile(store.path, "utf8"), before);
    await client.unsubscribe("2");
    calls.length = 0;
    const result = await service.setSubscription("steam-2", false, "2");
    assert.equal(result.unsubscribed, 0);
    assert.deepEqual(calls, []);
  }));

void test("a target becoming Active after preflight cannot reach Steam during draft execution", async () =>
  setup(async (store, _client, calls, create) => {
    let active = false;
    const service = create({
      activeMods: async () => ({ packageIds: active ? ["author.mod2"] : [] }),
    });
    await service.previewLibrarySubscriptions("unsubscribe-mods", ["steam-2"]);
    active = true;
    const before = await readFile(store.path, "utf8");
    await assert.rejects(service.setSubscription("steam-2", false, "2"), /Active mods cannot/);
    assert.equal(await readFile(store.path, "utf8"), before);
    assert.deepEqual(calls, []);
  }));

void test("preflight rejects an invalid group or running game before any subscription change", async () =>
  setup(async (store, _client, calls, create) => {
    const before = await readFile(store.path, "utf8");
    const service = create();
    for (const ids of [[], ["steam-2", "missing"], ["steam-2", ""]]) {
      await assert.rejects(
        service.previewLibrarySubscriptions("unsubscribe-mods", ids),
        /Invalid|requested mod/,
      );
    }
    const running = create({
      assertClosed: async () => {
        throw new Error("Close RimWorld");
      },
    });
    await assert.rejects(
      running.previewLibrarySubscriptions("unsubscribe-mods", ["steam-2"]),
      /Close RimWorld/,
    );
    assert.deepEqual(calls, []);
    assert.equal(await readFile(store.path, "utf8"), before);
  }));
