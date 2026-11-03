import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { SettingsModal } from "../src/renderer/src/components/modals/SettingsModal";
import { TagEditorModal } from "../src/renderer/src/components/modals/TagEditorModal";
import { ModInfoPanel } from "../src/renderer/src/components/panels/ModInfoPanel";
import { ModsPanelView as ModsPanel } from "../src/renderer/src/components/panels/ModsPanel";
import { SubscribedModsPanelView as SubscribedModsPanel } from "../src/renderer/src/components/panels/SubscribedModsPanel";
import { persistSettings } from "../src/renderer/src/services/settings";
import { draftActions } from "../src/renderer/src/utils/drafts";
import { filterLibrary, filterModsByTag } from "../src/renderer/src/utils/library";
import { modTagFilters, searchScopes } from "../src/renderer/src/utils/uiConstants";
import { mergePortableMod, parsePortableMod, toPortableMod } from "../src/shared/cloudVault";
import { assignTagsToMods, tagNameExists } from "../src/shared/tags";
import type { FirebaseSyncSettings, Mod, ModVault } from "../src/shared/types";
import { requireValue } from "../src/shared/validation";
import {
  deleteLibraryModsExplicitly,
  mergeSteamSync,
  mergeVaultSave,
  normalizeVault,
} from "../src/shared/vault";

const makeMod = (id: string, subscribed = true): Mod => ({
  id: `steam-${id}`,
  workshopId: id,
  name: `Mod ${id}`,
  author: "Author",
  source: "steam",
  summary: "Saved description",
  tags: ["Steam category"],
  gameVersions: ["1.6"],
  screenshots: ["preview"],
  subscribed,
  downloadedAt: `2026-01-0${id}`,
  addedAt: "2025-01-01",
  notes: "My note",
});
const noop = () => undefined;

void test("desktop Settings exposes database folder before logs as separate actions without submitting config changes", () => {
  const html = renderToStaticMarkup(
    <SettingsModal
      configPath=""
      workshopPath=""
      onWorkshopPathChange={() => undefined}
      onDetectWorkshopPath={() => undefined}
      onTestWorkshopPath={() => undefined}
      onBrowseWorkshopPath={() => undefined}
      onBrowseConfigPath={() => undefined}
      onOpenDatabaseFolder={() => undefined}
      onOpenLogs={() => undefined}
      onClose={() => undefined}
      onConfigPathChange={() => undefined}
      onSubmit={() => undefined}
    />,
  );
  assert.match(html, /User database/);
  assert.match(html, /type="button"[^>]*>.*Open database folder<\/button>/);
  assert.match(html, /Debug logs/);
  assert.match(html, /type="button"[^>]*>.*Open logs<\/button>/);
  assert.ok(html.indexOf("Open database folder") < html.indexOf("Debug logs"));
});

void test("Settings accepts a personal Firebase web configuration without persisting a password field", () => {
  const firebaseSettings: FirebaseSyncSettings = {
    enabled: true,
    projectId: "personal-project",
    apiKey: "public-web-key",
    authDomain: "personal-project.firebaseapp.com",
    appId: "1:123:web:abc",
    email: "owner@example.com",
  };
  const html = renderToStaticMarkup(
    <SettingsModal
      configPath=""
      workshopPath=""
      firebaseSettings={firebaseSettings}
      firebasePassword=""
      firebaseStatus={{ phase: "signed-out", message: "Connect this device" }}
      onFirebaseSettingsChange={noop}
      onFirebasePasswordChange={noop}
      onBrowseConfigPath={noop}
      onWorkshopPathChange={noop}
      onDetectWorkshopPath={noop}
      onTestWorkshopPath={noop}
      onBrowseWorkshopPath={noop}
      onClose={noop}
      onConfigPathChange={noop}
      onSubmit={noop}
    />,
  );
  assert.match(html, /Firebase sync \(beta\)/);
  assert.match(html, /type="password"/);
  assert.match(html, /never saved by RimLib/i);
  assert.match(html, /Never paste a service-account key or private key/);
  assert.match(html, /Save and sync/);
});
const savedVault: ModVault = {
  schemaVersion: 3,
  mods: [
    { ...makeMod("1"), userTagIds: ["qol", "sw"] },
    { ...makeMod("2", false), userTagIds: ["sw"] },
  ],
  userTags: [
    { id: "qol", name: "QoL", color: "#7fbf90" },
    { id: "sw", name: "Star Wars", color: "#73a8d8" },
  ],
  settings: {},
  localSteamState: { observedIds: ["1"], pending: {} },
};
void test("Settings shows the editable effective folder, direct access testing and auto-detection without an override-disabling checkbox", () => {
  const props = {
    configPath: "",
    workshopPath: "/Volumes/Samsung drive/SteamLibrary/steamapps/workshop/content/294100",
    onWorkshopPathChange: noop,
    onDetectWorkshopPath: noop,
    onTestWorkshopPath: noop,
    onBrowseWorkshopPath: noop,
    onBrowseConfigPath: noop,
    onClose: noop,
    onConfigPathChange: noop,
    onSubmit: noop,
  };
  const html = renderToStaticMarkup(
    <SettingsModal {...props} workshopAccessPath={props.workshopPath} />,
  );
  assert.match(html, /Workshop mods folder \(294100\)/);
  assert.match(html, /aria-label="Workshop mods folder path"[^>]*value="\/Volumes\/Samsung drive/);
  assert.doesNotMatch(html, /aria-label="Workshop mods folder path"[^>]*disabled|type="checkbox"/);
  assert.match(html, /aria-label="Browse Workshop folder"/);
  assert.match(html, /aria-label="Auto-detect Workshop folder"/);
  assert.match(html, /aria-label="Test Workshop folder access"/);
  assert.match(html, /Folder is readable/);
  const invalid = renderToStaticMarkup(
    <SettingsModal {...props} settingsError="Configured folder is unavailable" />,
  );
  assert.match(invalid, /role="alert">Configured folder is unavailable/);
  const detecting = renderToStaticMarkup(<SettingsModal {...props} isDetectingPath />);
  assert.match(detecting, /class="primary-action" type="submit" disabled/);
  const testing = renderToStaticMarkup(<SettingsModal {...props} isTestingPath />);
  assert.match(testing, /Checking folder access/);
  assert.match(
    testing,
    /aria-label="Test Workshop folder access"[^>]*disabled|disabled[^>]*aria-label="Test Workshop folder access"/,
  );
  const empty = renderToStaticMarkup(<SettingsModal {...props} workshopPath="" />);
  assert.match(empty, /disabled[^>]*aria-label="Test Workshop folder access"/);
});

void test("saving the displayed prefilled folder pins it without an extra mode toggle, retains user data and reloads it", async () => {
  let current = normalizeVault(savedVault);
  const folder = "/Volumes/Samsung drive/SteamLibrary/steamapps/workshop/content/294100";
  const validated: string[] = [];
  const api = {
    load: async () => current,
    validateWorkshopModsPath: async (path: string) => {
      validated.push(path);
      return path.trim();
    },
    save: async (next: ModVault) => {
      current = mergeVaultSave(current, next);
      return current;
    },
  };
  const result = await persistSettings(api, "", folder);
  assert.deepEqual(validated, [folder]);
  assert.equal(result.workshopPathChanged, true);
  assert.equal(result.vault.settings?.workshopModsPath, folder);
  assert.equal(
    normalizeVault(JSON.parse(JSON.stringify(current))).settings?.workshopModsPath,
    folder,
  );
  assert.deepEqual(result.vault.mods, normalizeVault(savedVault).mods);

  const unchanged = await persistSettings(api, "", folder);
  assert.equal(unchanged.workshopPathChanged, false);
  const automatic = await persistSettings(api, "", "  ");
  assert.equal(automatic.workshopPathChanged, true);
  assert.equal(automatic.vault.settings?.workshopModsPath, undefined);
  assert.equal(validated.length, 2);
});

void test("Firebase settings are normalized and stored while the account password stays outside the vault", async () => {
  let current = normalizeVault(savedVault);
  const api = {
    load: async () => current,
    validateWorkshopModsPath: async (path: string) => path.trim(),
    save: async (next: ModVault) => {
      current = mergeVaultSave(current, next);
      return current;
    },
  };
  const result = await persistSettings(api, "", "", {
    enabled: true,
    projectId: " personal-project ",
    apiKey: " public-web-key ",
    authDomain: " personal-project.firebaseapp.com ",
    appId: " 1:123:web:abc ",
    email: " owner@example.com ",
  });
  assert.deepEqual(result.vault.settings?.firebaseSync, {
    enabled: true,
    projectId: "personal-project",
    apiKey: "public-web-key",
    authDomain: "personal-project.firebaseapp.com",
    appId: "1:123:web:abc",
    email: "owner@example.com",
  });
  assert.doesNotMatch(JSON.stringify(result.vault), /password/i);
});

void test("portable Firebase records exclude device state and preserve it when merging a download", () => {
  const local: Mod = {
    ...makeMod("9"),
    localPath: "/device/workshop/9",
    fileSize: 42,
    subscribed: true,
    downloadedAt: "2026-09-01",
  };
  const portable = toPortableMod(local);
  assert.equal(Object.hasOwn(portable, "localPath"), false);
  assert.equal(Object.hasOwn(portable, "fileSize"), false);
  assert.equal(Object.hasOwn(portable, "subscribed"), false);
  assert.equal(Object.hasOwn(portable, "downloadedAt"), false);
  const remote = parsePortableMod({ ...portable, notes: "Changed elsewhere" });
  const merged = mergePortableMod(local, remote);
  assert.equal(merged.notes, "Changed elsewhere");
  assert.equal(merged.localPath, local.localPath);
  assert.equal(merged.fileSize, local.fileSize);
  assert.equal(merged.subscribed, local.subscribed);
  assert.equal(merged.downloadedAt, local.downloadedAt);
});

void test("a failed direct folder validation blocks Settings persistence before loading or writing the database", async () => {
  await assert.rejects(
    persistSettings(
      {
        validateWorkshopModsPath: async () => {
          throw new Error("Permission denied (EACCES)");
        },
        load: async () => assert.fail("Do not load or write settings after a failed access test"),
        save: async () => assert.fail("Do not write settings after a failed access test"),
      },
      "",
      "/unreadable/294100",
    ),
    /EACCES/,
  );
});

void test("Workshop settings survive normalization and malformed paths are rejected", () => {
  const next = normalizeVault({
    ...savedVault,
    settings: { ...savedVault.settings, workshopModsPath: "/custom/294100" },
  });
  assert.equal(
    normalizeVault(JSON.parse(JSON.stringify(next))).settings?.workshopModsPath,
    "/custom/294100",
  );

  assert.throws(
    () => normalizeVault({ ...savedVault, settings: { workshopModsPath: 123 } }),
    /Invalid Workshop mods folder setting/,
  );
});

void test("validation rejects malformed tags and assignments instead of silently dropping user data", () => {
  assert.throws(
    () => normalizeVault({ ...savedVault, mods: [{ ...makeMod("1"), userTagIds: "bad" }] }),
    /userTagIds/,
  );
  assert.throws(
    () => normalizeVault({ ...savedVault, userTags: [{ id: "tag", name: "", color: "red" }] }),
    /Invalid user tags/,
  );
  assert.throws(
    () =>
      normalizeVault({
        ...savedVault,
        userTags: [
          { id: "duplicate", name: "First", color: "red" },
          { id: "duplicate", name: "Second", color: "blue" },
        ],
      }),
    /Duplicate tag identifiers/,
  );
  assert.throws(
    () =>
      normalizeVault({
        ...savedVault,
        localSteamState: { observedIds: ["bad"], pending: {} },
      }),
    /Invalid Steam/,
  );
  assert.throws(() => normalizeVault({ ...savedVault, schemaVersion: 4 }), /newer app version/);
});

void test("tag assignments allow zero or many tags, without touching Steam category metadata", () => {
  let next = normalizeVault(savedVault);
  next = assignTagsToMods(next, ["steam-2"], ["qol"], true);
  next = assignTagsToMods(next, ["steam-2"], ["qol"], true);
  assert.deepEqual(requireValue(next.mods[1]).userTagIds, ["sw", "qol"]);
  next = assignTagsToMods(next, ["steam-2"], ["sw"], false);
  next = assignTagsToMods(next, ["steam-2"], ["qol"], false);
  assert.deepEqual(requireValue(next.mods[1]).userTagIds, []);
  assert.deepEqual(requireValue(next.mods[1]).tags, ["Steam category"]);
  assert.throws(
    () => assignTagsToMods(next, ["steam-2"], ["unknown"], true),
    /No tags were edited/,
  );
  assert.equal(tagNameExists(requireValue(next.userTags), "  QOL "), true);
  assert.equal(tagNameExists(requireValue(next.userTags), "qol", "qol"), false);
});

void test("search scopes title, author, description and tags without mutating the library", () => {
  const next = normalizeVault(savedVault);
  next.mods.push({
    ...makeMod("3", false),
    author: "Another person",
    summary: "A unique colony description",
    tags: ["Storyteller"],
    userTagIds: [],
  });
  const before = JSON.stringify(next.mods);
  assert.deepEqual(
    filterLibrary(next.mods, "person", searchScopes.author, "newest", next.userTags).map(
      (mod) => mod.id,
    ),
    ["steam-3"],
  );
  assert.deepEqual(
    filterLibrary(next.mods, "MOD", searchScopes.title, "oldest", next.userTags).map(
      (mod) => mod.id,
    ),
    ["steam-1", "steam-2", "steam-3"],
  );
  assert.deepEqual(
    filterLibrary(next.mods, "colony", searchScopes.description, "newest", next.userTags).map(
      (mod) => mod.id,
    ),
    ["steam-3"],
  );
  assert.deepEqual(
    filterLibrary(next.mods, "Story", searchScopes.tags, "newest", next.userTags).map(
      (mod) => mod.id,
    ),
    ["steam-3"],
  );
  assert.deepEqual(
    filterLibrary(next.mods, "QoL", searchScopes.tags, "newest", next.userTags).map(
      (mod) => mod.id,
    ),
    ["steam-1"],
  );
  assert.equal(JSON.stringify(next.mods), before);
});

void test("tag filters select one personal tag or untagged mods and compose with search", () => {
  const mods = [
    ...normalizeVault(savedVault).mods,
    { ...makeMod("3", false), userTagIds: [] },
    { ...makeMod("4", false), userTagIds: undefined },
  ];
  const before = JSON.stringify(mods);

  assert.deepEqual(
    filterModsByTag(mods, modTagFilters.all).map((mod) => mod.id),
    ["steam-1", "steam-2", "steam-3", "steam-4"],
  );
  assert.deepEqual(
    filterModsByTag(mods, "qol").map((mod) => mod.id),
    ["steam-1"],
  );
  assert.deepEqual(
    filterModsByTag(mods, modTagFilters.untagged).map((mod) => mod.id),
    ["steam-3", "steam-4"],
  );
  assert.deepEqual(filterModsByTag(mods, "missing-tag"), []);
  assert.deepEqual(
    filterLibrary(
      filterModsByTag(mods, "sw"),
      "2",
      searchScopes.title,
      "newest",
      savedVault.userTags,
    ).map((mod) => mod.id),
    ["steam-2"],
  );
  assert.equal(JSON.stringify(mods), before);
});

void test("ordinary omission preserves tags; explicit tag deletion clears saved mod assignments", () => {
  const original = deleteLibraryModsExplicitly(
    mergeSteamSync(normalizeVault(savedVault), {
      mods: [],
      subscribedIds: [],
      discoveredIds: [],
      warnings: [],
      manifestPaths: [],
      missingMetadataIds: [],
      steamLibraryPaths: [],
    }),
    ["steam-1"],
  );
  const omitted = mergeVaultSave(original, { ...original, userTags: [] });
  assert.equal(omitted.userTags.length, 2);
  const deleted = mergeVaultSave(
    original,
    { ...original, userTags: [] },
    { deletedTagIds: ["qol"] },
  );
  assert.equal(deleted.userTags.length, 1);
  assert.deepEqual(deleted.mods[0]?.userTagIds, ["sw"]);

  assert.deepEqual(normalizeVault(deleted).userTags, deleted.userTags);
});

void test("Library panel keeps scoped search while subscription controls live in Mod Info", () => {
  const next = normalizeVault(savedVault);
  const html = renderToStaticMarkup(
    <ModsPanel
      mode="unsubscribed"
      mods={next.mods}
      totalCount={next.mods.length}
      tags={requireValue(next.userTags)}
      search=""
      searchScope="all"
      sort="newest"
      tagFilter={modTagFilters.untagged}
      activeIds={new Set()}
      activeOrder={new Map()}
      onSearch={noop}
      onSearchScope={noop}
      onSort={noop}
      onTagFilter={noop}
      onSelect={noop}
      onSubscribe={noop}
      onUnsubscribe={noop}
    />,
  );
  assert.match(html, /<h2[^>]*>Library<\/h2>/);
  assert.match(html, /aria-label="Library mods"/);
  assert.match(html, /Search library mods by/);
  assert.match(html, />Description<\/option>/);
  assert.match(html, />Tags<\/option>/);
  assert.match(html, /aria-label="Filter library mods by tag"/);
  assert.match(html, />All tags<\/option>/);
  assert.match(html, />QoL<\/option>/);
  assert.match(html, />Star Wars<\/option>/);
  assert.match(html, /<option[^>]*selected=""[^>]*>Untagged<\/option>/);
  assert.doesNotMatch(html, /Manage tags|Sync Steam subscriptions/);
  assert.doesNotMatch(html, /Subscribe to Mod 1|Subscribe to Mod 2|Unsubscribe from/);
  assert.match(html, /Double-click to stage activation/);
  assert.doesNotMatch(html, /Steam category|Create modlist/);
  const info = renderToStaticMarkup(
    <ModInfoPanel
      mod={next.mods[0]}
      tags={requireValue(next.userTags)}
      onSubscribe={noop}
      onUnsubscribe={noop}
      onRemoveModFromLibrary={noop}
      onAssignTag={noop}
      onCreateTag={noop}
    />,
  );
  assert.equal((info.match(/type="checkbox"/g) ?? []).length, 2);
  assert.equal((info.match(/checked=""/g) ?? []).length, 2);
  assert.match(info, />Subscribe<\/span>/);
  assert.match(info, />Unsubscribe<\/button>/);
  assert.match(info, />Removed<\/button>/);
  assert.ok(info.indexOf(">Unsubscribe</button>") < info.indexOf(">Removed</button>"));
  const compoundInfo = renderToStaticMarkup(
    <ModInfoPanel
      mod={next.mods[0]}
      tags={requireValue(next.userTags)}
      removalRequiresUnsubscribe
      onSubscribe={noop}
      onUnsubscribe={noop}
      onRemoveModFromLibrary={noop}
      onAssignTag={noop}
      onCreateTag={noop}
    />,
  );
  assert.match(compoundInfo, /title="Unsubscribe and remove from library"/);
  assert.match(compoundInfo, />Removed<\/button>/);
  const pendingRemovalInfo = renderToStaticMarkup(
    <ModInfoPanel
      mod={next.mods[0]}
      tags={requireValue(next.userTags)}
      pendingActions={[draftActions.unsubscribe, draftActions.remove]}
      onSubscribe={noop}
      onUnsubscribe={noop}
      onAddModToLibrary={noop}
      onRemoveModFromLibrary={noop}
      onAssignTag={noop}
      onCreateTag={noop}
    />,
  );
  assert.match(pendingRemovalInfo, />Add back<\/button>/);
  assert.match(pendingRemovalInfo, /other pending actions are unchanged/);
  assert.doesNotMatch(pendingRemovalInfo, />Removed<\/button>/);
  const notSubscribedInfo = renderToStaticMarkup(
    <ModInfoPanel
      mod={next.mods[1]}
      tags={requireValue(next.userTags)}
      onSubscribe={noop}
      onUnsubscribe={noop}
      onRemoveModFromLibrary={noop}
      onAssignTag={noop}
      onCreateTag={noop}
    />,
  );
  assert.match(notSubscribedInfo, />Not subscribe<\/span>/);
  assert.match(notSubscribedInfo, />Subscribe<\/button>/);
  assert.match(info, /Create tag/);
});

void test("right panel shows only active mods with load order and no subscription controls", () => {
  const next = normalizeVault(savedVault);
  const html = renderToStaticMarkup(
    <SubscribedModsPanel
      mods={[requireValue(next.mods[0])]}
      totalCount={1}
      tags={requireValue(next.userTags)}
      search=""
      searchScope="all"
      sort="load-order"
      activeIds={new Set(["steam-1"])}
      activeOrder={new Map([["steam-1", 4]])}
      onSearch={noop}
      onSearchScope={noop}
      onSort={noop}
      onSelect={noop}
      onSubscribe={noop}
      onUnsubscribe={noop}
      onAutoSort={noop}
    />,
  );
  assert.match(html, /<h2[^>]*>Active<\/h2>/);
  assert.match(html, /aria-label="Active mods"/);
  assert.doesNotMatch(html, /Unsubscribe all non-active mods|Delete all library mods/);
  assert.doesNotMatch(html, /Subscribe to|Unsubscribe from/);
  assert.match(html, /Search active mods/);
  assert.match(html, /Search active mods by/);
  assert.doesNotMatch(html, /Filter active by tag/);
  assert.match(html, /QoL|qol/);
  assert.match(html, /class="load-order-number" aria-label="Load order 4">4<\/span>/);
  assert.match(html, /Auto-sort/);
  assert.match(html, /Double-click to stage deactivation/);
  assert.doesNotMatch(html, /Active first|Create modlist|Apply Active/);
});

void test("DaisyUI tag editor blocks duplicate names and offers palette plus custom color", () => {
  const next = normalizeVault(savedVault);
  const html = renderToStaticMarkup(
    <TagEditorModal
      initialName="qol"
      tags={requireValue(next.userTags)}
      onClose={noop}
      onSave={noop}
    />,
  );
  assert.match(html, /modal modal-open/);
  assert.match(html, /already exists/);
  assert.match(html, /type="submit" disabled/);
  assert.match(html, /type="color"/);
});
