import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { deleteLibraryMods } from "../src/main/libraryActions";
import { VaultStore } from "../src/main/vaultStore";
import {
  fetchWorkshopDetails,
  normalizeWorkshopDetail,
  refreshModMetadata,
} from "../src/main/workshopMetadata";
import { ErrorNotification } from "../src/renderer/src/components/common/ErrorNotification";
import { ModImage } from "../src/renderer/src/components/common/ModImage";
import { ModInfoPanel } from "../src/renderer/src/components/panels/ModInfoPanel";
import {
  ModsPanelView as ModsPanel,
  type ModsPanelViewProps as ModsPanelProps,
} from "../src/renderer/src/components/panels/ModsPanel";
import { getStore } from "../src/renderer/src/services/modStore";
import { modImageUrl } from "../src/renderer/src/utils/images";
import type { Mod, ModVault } from "../src/shared/types";
import { requireValue } from "../src/shared/validation";
import { deleteLibraryModsExplicitly, normalizeVault, serializeVault } from "../src/shared/vault";
import { sourceCallArguments } from "./helpers/sourceCalls";

const noop = () => undefined;
const mod = (id: string, subscribed = false): Mod => ({
  id: `steam-${id}`,
  workshopId: id,
  packageId: `author.mod${id}`,
  name: `Mod ${id}`,
  author: "Actual author",
  source: "steam",
  summary: "Old description",
  tags: ["Old category"],
  userTagIds: ["qol"],
  gameVersions: ["1.5"],
  subscribed,
  downloadedAt: "2025-01-01",
  addedAt: "2025-01-01",
  thumbnail: "https://steamusercontent.com/old.jpg",
  screenshots: ["https://steamusercontent.com/old.jpg", "https://example.com/keep.jpg"],
  notes: "Keep notes",
  localPath: "/disconnected/missing/mod",
});
function vault(): ModVault {
  return normalizeVault({
    mods: [mod("1", true), mod("2"), mod("3")],

    userTags: [{ id: "qol", name: "QoL", color: "#7fbf90" }],
    localSteamState: { observedIds: ["1"], pending: {} },
    settings: { workshopModsPath: "/disconnected/294100" },
    customExtension: { preserve: true },
  });
}
async function temporaryStore(
  action: (store: VaultStore, original: ModVault, directory: string) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "mod-library-actions-"));
  try {
    const store = new VaultStore(join(directory, "vault.json"));
    await writeFile(store.path, JSON.stringify(serializeVault(vault())));
    await action(store, await store.load(), directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
const detail = {
  publishedfileid: "2",
  result: 1,
  consumer_app_id: 294100,
  title: "Updated Workshop title",
  description: "Updated description",
  preview_url: "http://steamusercontent.com/new.jpg",
  creator: "76561198000000001",
  time_created: 1600000000,
  time_updated: 1700000000,
  file_size: "1024",
  tags: [{ tag: "Mod" }, { tag: "1.6" }, { tag: "Weapons" }],
};
const response = (value: unknown) => Response.json({ response: { publishedfiledetails: value } });
const request =
  (value: unknown = [detail]): typeof fetch =>
  async () =>
    response(value);

void test("bulk library deletion is linear, explicit and preserves subscribed records, tag definitions and remaining metadata", () => {
  const original = vault();
  const before = JSON.stringify(original);
  const next = deleteLibraryModsExplicitly(original, ["steam-2", "steam-3", "steam-2"]);
  assert.deepEqual(next.mods, [original.mods[0]]);
  assert.deepEqual(next.userTags, original.userTags);
  assert.deepEqual(next.localSteamState.observedIds, ["1"]);
  assert.deepEqual(next.settings, original.settings);

  assert.equal(JSON.stringify(original), before);
  assert.deepEqual((next as ModVault & { customExtension: unknown }).customExtension, {
    preserve: true,
  });
});

void test("bulk deletion rejects subscribed, newly subscribed, missing and malformed selections without partial deletion", () => {
  const original = vault();
  const before = JSON.stringify(original);
  for (const ids of [
    ["steam-2", "steam-1"],
    ["steam-2", "missing"],
    [],
    [42] as unknown as string[],
    null as unknown as string[],
  ]) {
    assert.throws(() => deleteLibraryModsExplicitly(original, ids));
  }
  assert.throws(
    () =>
      deleteLibraryModsExplicitly(
        {
          ...original,
          localSteamState: { ...original.localSteamState, observedIds: ["1", "2"] },
        },
        ["steam-2"],
      ),
    /Nothing was deleted/,
  );
  assert.throws(
    () =>
      deleteLibraryModsExplicitly(
        {
          ...original,
          localSteamState: {
            ...original.localSteamState,
            pending: { "2": "subscribe" },
          },
        },
        ["steam-2"],
      ),
    /Subscribed mods/,
  );
  assert.equal(JSON.stringify(original), before);
  assert.throws(() => deleteLibraryModsExplicitly(original, ["steam-1"]), /Subscribed mods/);
});

void test("bulk deletion writes a persistent backup, commits atomically and stays deleted on reopen and ordinary saves", async () => {
  await temporaryStore(async (store, original, directory) => {
    const next = await deleteLibraryMods(store, ["steam-2", "steam-3"]);
    const files = await readdir(join(directory, "backups"));
    const backup = files.find((file) => file.includes("delete-library-mods"));
    assert.ok(backup);
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, "backups", backup), "utf8")),
      serializeVault(original),
    );
    assert.equal(next.mods.length, 1);
    const saved = await store.save({ ...next, mods: [] });
    assert.equal(saved.mods.length, 1);
    assert.deepEqual((await new VaultStore(store.path).load()).mods, saved.mods);
  });
});

void test("bulk deletion preserves the entire database on invalid selection or external edits", async () => {
  await temporaryStore(async (store, _original, directory) => {
    const before = await readFile(store.path, "utf8");
    await assert.rejects(deleteLibraryMods(store, ["steam-2", "steam-1"]), /Subscribed mods/);
    assert.equal(await readFile(store.path, "utf8"), before);
    assert.equal((await readdir(directory)).includes("backups"), false);
    const external = before + "\n";
    await writeFile(store.path, external);
    await assert.rejects(deleteLibraryMods(store, ["steam-2"]), /changed outside/);
    assert.equal(await readFile(store.path, "utf8"), external);
  });
});

void test("single and selected deletion reject subscriptions that appear after confirmation without any partial removal", async () => {
  await temporaryStore(async (store, _original) => {
    await assert.rejects(
      deleteLibraryMods(store, ["steam-1"]),
      /Subscribed mods cannot be removed/,
    );
    await store.update((vault) => ({
      ...vault,
      localSteamState: {
        ...vault.localSteamState,
        observedIds: [...vault.localSteamState.observedIds, "2"],
      },
    }));
    const before = await readFile(store.path, "utf8");
    await assert.rejects(deleteLibraryMods(store, ["steam-2", "steam-3"]), /Nothing was deleted/);
    assert.equal(await readFile(store.path, "utf8"), before);
    assert.equal((await store.load()).mods.length, 3);
  });
});

void test("single deletion in desktop IPC and browser storage uses the same subscribed-mod guard as selection deletion", async () => {
  const handlers = await sourceCallArguments("src/main/index.ts", "handle");
  assert.ok(
    handlers.some(
      (args) =>
        args[0] === "ipcChannels.deleteLibraryMods" &&
        args[1] === "(ids: string[]) => deleteLibraryMods(store, ids)",
    ),
  );
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>();
  const key = "rimlib:vault";
  const unrelatedKey = "another-app:vault";
  const unrelatedData = "preserved unrelated data";
  const raw = JSON.stringify(serializeVault(vault()));
  values.set(unrelatedKey, unrelatedData);
  Object.assign(globalThis, {
    window: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
      },
    },
  });
  try {
    const store = getStore();
    const empty = await store.load();
    assert.deepEqual(empty.mods, []);
    assert.deepEqual(empty.userTags, []);
    assert.equal(values.has(key), false);
    values.set(key, raw);
    assert.deepEqual((await store.load()).mods, vault().mods);
    await assert.rejects(store.deleteLibraryMods(["steam-1"]), /Subscribed mods cannot be removed/);
    await assert.rejects(store.deleteLibraryMods(["steam-2", "steam-1"]), /Nothing was deleted/);
    assert.equal(values.get(key), raw);
    assert.equal(values.has(`${key}:backup`), false);
    const saved = await store.deleteLibraryMods(["steam-2"]);
    assert.deepEqual(
      saved.mods.map((mod) => mod.id),
      ["steam-1", "steam-3"],
    );
    assert.equal(values.get(`${key}:backup`), raw);
    assert.deepEqual(saved.userTags, vault().userTags);
    assert.deepEqual(saved.localSteamState.observedIds, ["1"]);
    assert.equal(values.get(unrelatedKey), unrelatedData);
  } finally {
    if (!original) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", original);
    }
  }
});

void test("a failed bulk deletion checkpoint blocks all record removal", async () => {
  await temporaryStore(async (store, original, directory) => {
    const before = await readFile(store.path, "utf8");
    await writeFile(join(directory, "backups"), "not a directory");
    await assert.rejects(deleteLibraryMods(store, ["steam-2", "steam-3"]));
    assert.equal(await readFile(store.path, "utf8"), before);
    assert.deepEqual((await store.load()).mods, original.mods);
  });
});

void test("deleting over 2000 saved mods preserves subscribed records and tags", () => {
  const original = vault();
  const mods = Array.from({ length: 2100 }, (_, index) => mod(String(index + 2)));
  const next = deleteLibraryModsExplicitly(
    {
      ...original,
      mods: [requireValue(original.mods[0]), ...mods],
    },
    mods.map((entry) => entry.id),
  );
  assert.equal(next.mods.length, 1);
  assert.deepEqual(next.mods, [original.mods[0]]);
  assert.deepEqual(next.userTags, original.userTags);
  assert.deepEqual(next.localSteamState, original.localSteamState);
});

void test("Library never exposes a bulk-delete or non-active cleanup button", () => {
  const props: ModsPanelProps = {
    mode: "unsubscribed",
    mods: [],
    totalCount: 2,
    tags: [],
    search: "no match",
    searchScope: "all",
    sort: "newest",
    activeIds: new Set(),
    activeOrder: new Map(),
    subscriptionDisabled: true,
    onSearch: noop,
    onSearchScope: noop,
    onSort: noop,
    onSelect: noop,
    onSubscribe: noop,
    onUnsubscribe: noop,
  };
  const html = renderToStaticMarkup(<ModsPanel {...props} />);
  assert.doesNotMatch(html, /Delete all library mods|Unsubscribe all non-active mods/);
  assert.doesNotMatch(html, /Subscribe to .*visible mods/);
  for (const totalCount of [0, 2_000]) {
    assert.doesNotMatch(
      renderToStaticMarkup(<ModsPanel {...props} totalCount={totalCount} />),
      /Delete all library mods|Unsubscribe all non-active mods/,
    );
  }
});

void test("public metadata uses only the requested Workshop ID, a no-cache POST and a bounded HTTP request", async () => {
  let called = 0;
  let signal: AbortSignal | undefined;
  const mocked: typeof fetch = async (url, options) => {
    called++;
    assert.equal(
      url,
      "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/",
    );
    assert.equal(options?.method, "POST");
    assert.equal((options.body as URLSearchParams).get("itemcount"), "1");
    assert.equal((options.body as URLSearchParams).get("publishedfileids[0]"), "2");
    assert.deepEqual(options.headers, { "Cache-Control": "no-cache" });
    signal = options.signal ?? undefined;
    return response([detail, { ...detail, publishedfileid: "9" }]);
  };
  assert.deepEqual(await fetchWorkshopDetails(["2"], mocked), [detail]);
  assert.equal(called, 1);
  assert.equal(signal?.aborted, true);
  for (const ids of [[], ["invalid"], Array.from({ length: 101 }, () => "2")]) {
    await assert.rejects(fetchWorkshopDetails(ids, mocked), /Invalid Workshop/);
  }
  assert.equal(called, 1);
});

void test("metadata refresh works with unsubscribed mods and disconnected folders, preserving all user-owned identity and state", async () => {
  await temporaryStore(async (store, original) => {
    const originalRaw = await readFile(store.path, "utf8");
    const next = await refreshModMetadata(store, "steam-2", request());
    const updated = requireValue(next.mods[1]);
    assert.equal(updated.name, detail.title);
    assert.equal(updated.summary, detail.description);
    assert.equal(updated.thumbnail, "https://steamusercontent.com/new.jpg");
    assert.deepEqual(updated.screenshots, [
      "https://steamusercontent.com/new.jpg",
      "https://example.com/keep.jpg",
    ]);
    assert.deepEqual(updated.tags, ["Steam", "Weapons"]);
    assert.deepEqual(updated.gameVersions, ["1.6"]);
    assert.equal(updated.fileSize, 1024);
    assert.ok(updated.metadataUpdatedAt);
    for (const key of [
      "packageId",
      "author",
      "subscribed",
      "downloadedAt",
      "addedAt",
      "notes",
      "localPath",
      "source",
    ] as const) {
      assert.equal(updated[key], requireValue(original.mods[1])[key]);
    }
    assert.deepEqual(updated.userTagIds, ["qol"]);
    assert.deepEqual(next.userTags, original.userTags);
    assert.deepEqual(next.localSteamState, original.localSteamState);
    assert.deepEqual(next.settings, original.settings);
    assert.deepEqual(next.mods[0], original.mods[0]);
    assert.equal(await readFile(`${store.path}.bak`, "utf8"), originalRaw);
  });
});

void test("optional unavailable public fields retain saved previews, versions and times rather than deleting information", async () => {
  await temporaryStore(async (store, original) => {
    const next = await refreshModMetadata(
      store,
      "steam-2",
      request([
        {
          ...detail,
          preview_url: "javascript:alert(1)",
          time_created: Infinity,
          time_updated: -1,
          file_size: "not a number",
          description: undefined,
          tags: [],
        },
      ]),
    );
    assert.equal(requireValue(next.mods[1]).thumbnail, requireValue(original.mods[1]).thumbnail);
    assert.deepEqual(
      requireValue(next.mods[1]).screenshots,
      requireValue(original.mods[1]).screenshots,
    );
    assert.deepEqual(
      requireValue(next.mods[1]).gameVersions,
      requireValue(original.mods[1]).gameVersions,
    );
    assert.equal(requireValue(next.mods[1]).summary, requireValue(original.mods[1]).summary);
    assert.equal(requireValue(next.mods[1]).fileSize, undefined);
    assert.equal(requireValue(next.mods[1]).steamUpdatedAt, undefined);
  });
});

void test("private, deleted, wrong-game, incomplete and malformed metadata preserve the exact saved database", async () => {
  await temporaryStore(async (store, _original, directory) => {
    const before = await readFile(store.path, "utf8");
    for (const value of [
      [{ ...detail, result: 9 }],
      [{ ...detail, consumer_app_id: 123 }],
      [{ ...detail, consumer_app_id: "294100" }],
      [{ ...detail, consumer_app_id: undefined }],
      [{ ...detail, title: "" }],
      [{ ...detail, publishedfileid: "9" }],
      [{ ...detail, result: "1" }],
      [],
      "invalid",
    ]) {
      await assert.rejects(refreshModMetadata(store, "steam-2", request(value)));
      assert.equal(await readFile(store.path, "utf8"), before);
    }
    await assert.rejects(refreshModMetadata(store, "missing", request()), /saved Workshop/);
    await assert.rejects(
      refreshModMetadata(store, "steam-2", async () => new Response("bad", { status: 503 })),
      /HTTP 503/,
    );
    await assert.rejects(
      refreshModMetadata(store, "steam-2", async () => {
        throw new Error("Offline");
      }),
      /Offline/,
    );
    assert.equal(await readFile(store.path, "utf8"), before);
    assert.deepEqual(await readdir(directory), ["vault.json"]);
  });
});

void test("metadata timeouts abort the request, release the caller and cannot commit a late response", async () => {
  await temporaryStore(async (store) => {
    const before = await readFile(store.path, "utf8");
    let resolve!: (response: Response) => void;
    let signal: AbortSignal | undefined;
    const pending = new Promise<Response>((done) => {
      resolve = done;
    });
    const mocked = (async (_url, options) => {
      signal = options?.signal ?? undefined;
      return pending;
    }) as typeof fetch;
    await assert.rejects(refreshModMetadata(store, "steam-2", mocked, 5), /timed out/);
    assert.equal(signal?.aborted, true);
    resolve(response([detail]));
    await new Promise((done) => setTimeout(done, 10));
    assert.equal(await readFile(store.path, "utf8"), before);
    const hangingJson = (async () => ({
      ok: true,
      status: 200,
      json: () => new Promise(() => undefined),
    })) as unknown as typeof fetch;
    await assert.rejects(refreshModMetadata(store, "steam-2", hangingJson, 5), /timed out/);
    assert.equal(await readFile(store.path, "utf8"), before);
  });
});

void test("metadata merging uses the latest tag and note edits made during a pending request", async () => {
  await temporaryStore(async (store) => {
    let resolve!: (response: Response) => void;
    let started!: () => void;
    const ready = new Promise<void>((done) => {
      started = done;
    });
    const pending = new Promise<Response>((done) => {
      resolve = done;
    });
    const refresh = refreshModMetadata(store, "steam-2", async () => {
      started();
      return pending;
    });
    await ready;
    await store.update((value) => ({
      ...value,
      mods: value.mods.map((mod) =>
        mod.id === "steam-2" ? { ...mod, notes: "New note", userTagIds: [] } : mod,
      ),
    }));
    resolve(response([detail]));
    const next = await refresh;
    assert.equal(requireValue(next.mods[1]).notes, "New note");
    assert.deepEqual(requireValue(next.mods[1]).userTagIds, []);
  });
});

void test("deleting a saved mod during metadata refresh cannot recreate it or write its stale response", async () => {
  await temporaryStore(async (store) => {
    let resolve!: (response: Response) => void;
    let started!: () => void;
    const ready = new Promise<void>((done) => {
      started = done;
    });
    const pending = new Promise<Response>((done) => {
      resolve = done;
    });
    const refresh = refreshModMetadata(store, "steam-2", async () => {
      started();
      return pending;
    });
    await ready;
    const deleted = await deleteLibraryMods(store, ["steam-2"]);
    const raw = await readFile(store.path, "utf8");
    resolve(response([detail]));
    await assert.rejects(refresh, /saved mod changed/);
    assert.equal(await readFile(store.path, "utf8"), raw);
    assert.deepEqual((await store.load()).mods, deleted.mods);
  });
});

void test("external database changes during metadata refresh cannot be overwritten", async () => {
  await temporaryStore(async (store) => {
    const external = JSON.stringify({ ...vault(), mods: [...vault().mods, mod("4")] });
    const nextResponse = (async () => {
      await writeFile(store.path, external);
      return response([detail]);
    }) as typeof fetch;
    await assert.rejects(refreshModMetadata(store, "steam-2", nextResponse), /changed outside/);
    assert.equal(await readFile(store.path, "utf8"), external);
  });
});

void test("public response parsing ignores malformed optional fields rather than handing unsafe data to installed imports", async () => {
  const values = await fetchWorkshopDetails(
    ["2"],
    request([
      {
        ...detail,
        title: { invalid: true },
        description: false,
        preview_url: ["invalid"],
        time_created: 1e100,
        time_updated: "invalid",
        file_size: 1024,
        tags: [{ tag: "1.6" }, null, { tag: { invalid: true } }],
      },
    ]),
  );
  assert.equal(requireValue(values[0]).title, undefined);
  assert.equal(requireValue(values[0]).preview_url, undefined);
  assert.equal(requireValue(values[0]).time_created, undefined);
  assert.equal(requireValue(values[0]).file_size, "1024");
  assert.deepEqual(requireValue(values[0]).tags, [{ tag: "1.6" }]);
  const malformedApp = requireValue(
    (await fetchWorkshopDetails(["2"], request([{ ...detail, consumer_app_id: "294100" }])))[0],
  );
  const normalized = normalizeWorkshopDetail(malformedApp);
  assert.equal(normalized.status, "invalid");
  assert.match(normalized.message, /invalid Workshop app ID/);
});

void test("public metadata envelopes stay strict while entries with unusable identities are isolated", async () => {
  for (const payload of [
    null,
    42,
    [],
    { response: [] },
    { response: { publishedfiledetails: null } },
  ]) {
    await assert.rejects(
      fetchWorkshopDetails(["2"], () => Promise.resolve(Response.json(payload))),
      /invalid Workshop metadata/,
    );
  }
  const details = await fetchWorkshopDetails(
    ["2"],
    request([
      null,
      [],
      { publishedfileid: "invalid", result: 1 },
      { publishedfileid: "9", result: 1 },
    ]),
  );
  assert.deepEqual(details, []);
});

void test("fresh Steam previews retry via a versioned HTTPS URL without modifying unrelated signed image URLs", () => {
  assert.equal(
    modImageUrl("http://steamuserimages-a.akamaihd.net/a.jpg", "new"),
    "https://steamuserimages-a.akamaihd.net/a.jpg?modvault_refresh=new",
  );
  assert.notEqual(
    modImageUrl("https://images.steamusercontent.com/a.jpg", "old"),
    modImageUrl("https://images.steamusercontent.com/a.jpg", "new"),
  );
  const signed = "https://example.com/a.jpg?signature=123";
  assert.equal(modImageUrl(signed, "new"), signed);
  for (const value of [
    undefined,
    "not a url",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://user:password@example.com/image.jpg",
  ]) {
    assert.equal(modImageUrl(value), undefined);
  }
  assert.doesNotMatch(renderToStaticMarkup(<ModImage src="invalid" />), /<img/);
  assert.match(
    renderToStaticMarkup(
      <ModImage src="https://steamusercontent.com/a.jpg" refreshedAt="new" lazy />,
    ),
    /loading="lazy".*src="https:\/\/steamusercontent.com\/a.jpg\?modvault_refresh=new"|src="https:\/\/steamusercontent.com\/a.jpg\?modvault_refresh=new".*loading="lazy"/,
  );
});

void test("Mod Info offers a desktop-only refresh independent of subscription state and folder availability", () => {
  const props = {
    mod: mod("2"),
    tags: requireValue(vault().userTags),
    onRemoveModFromLibrary: noop,
    onAssignTag: noop,
    onCreateTag: noop,
    onRefreshMetadata: noop,
  };
  const html = renderToStaticMarkup(<ModInfoPanel {...props} />);
  assert.match(html, /aria-label="Refresh mod metadata"/);
  assert.doesNotMatch(
    requireValue(/<button[^>]*aria-label="Refresh mod metadata"[^>]*>/.exec(html))[0],
    /disabled/,
  );
  for (const extra of [
    { isSaved: false },
    { isRefreshingMetadata: true },
    { onRefreshMetadata: undefined },
    { mod: { ...props.mod, workshopId: undefined, url: undefined } },
  ]) {
    assert.match(
      renderToStaticMarkup(<ModInfoPanel {...props} {...extra} />),
      /<button[^>]*disabled=""[^>]*aria-label="Refresh mod metadata"/,
    );
  }
  assert.match(
    renderToStaticMarkup(<ErrorNotification message="Failure" onDismiss={noop} />),
    /<strong class="error-notification-title">Action failed/,
  );
});

void test("tag search resets modal input decoration in the higher-priority utilities layer, and row actions occupy the right grid column", async () => {
  const tags = await readFile("src/renderer/src/styles/tags.css", "utf8");
  const custom = await readFile("src/renderer/src/styles/custom.css", "utf8");
  assert.match(
    tags,
    /@layer utilities\s*\{\s*\.app-modal \.search-box > input:not\(\[type="checkbox"\]\):not\(\[type="color"\]\)\s*\{[^}]*border: 0;[^}]*border-radius: 0;[^}]*padding: 0;[^}]*box-shadow: none;/s,
  );
  assert.match(tags, /\.tag-manager-modal \.search-box\s*\{\s*@apply h-9 flex-none/);
  assert.match(
    custom,
    /\.mod-row > \.tooltip-action\s*\{\s*@apply col-start-2 row-start-1 self-center/,
  );
  assert.match(custom, /grid-rows-\[40px_auto_minmax\(0,1fr\)_auto\]/);
});
