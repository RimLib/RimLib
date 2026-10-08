import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { AppHeader } from "../src/renderer/src/components/AppHeader";
import { ErrorNotification } from "../src/renderer/src/components/common/ErrorNotification";
import { ModRowView as ModRow } from "../src/renderer/src/components/common/ModRow";
import { ModInfoPanel } from "../src/renderer/src/components/panels/ModInfoPanel";
import {
  ModsPanelView as ModsPanel,
  type ModsPanelViewProps as ModsPanelProps,
} from "../src/renderer/src/components/panels/ModsPanel";
import { SubscribedModsPanelView as SubscribedModsPanel } from "../src/renderer/src/components/panels/SubscribedModsPanel";
import { buildActiveMods } from "../src/renderer/src/utils/activeMods";
import { errorMessage } from "../src/renderer/src/utils/errors";
import {
  applyWorkshopStatus,
  filterLibrary,
  subscriptionPanels,
} from "../src/renderer/src/utils/library";
import { formatDate } from "../src/renderer/src/utils/mods";
import { searchScopes } from "../src/renderer/src/utils/uiConstants";
import { getModActivity } from "../src/shared/subscriptions";
import { assignTagsToMods } from "../src/shared/tags";
import type { ActiveModsState, Mod } from "../src/shared/types";
import { requireValue } from "../src/shared/validation";
import { deleteLibraryModsExplicitly, normalizeVault } from "../src/shared/vault";

const noop = () => undefined;
const mod = (id: string, subscribed = false): Mod => ({
  id: `steam-${id}`,
  workshopId: id,
  packageId: `author.mod${id}`,
  name: `Mod ${id}`,
  author: "Author",
  source: "steam",
  summary: "Keep my metadata",
  tags: [],
  userTagIds: ["qol"],
  gameVersions: [],
  screenshots: [],
  subscribed,
  downloadedAt: `2026-01-0${id}`,
  addedAt: "",
  notes: "Keep my note",
});
const vault = normalizeVault({
  mods: [mod("1", true), mod("2", true), mod("3"), mod("4", true)],

  userTags: [{ id: "qol", name: "Quality of life", color: "#7fbf90" }],
});
const active: ActiveModsState = {
  configPath: "config",
  packageIds: ["Author.Mod2_steam", "ludeon.rimworld", "author.mod1"],
};
const build = (value = vault, state = active) =>
  subscriptionPanels(value, value.mods, state, buildActiveMods(state, value.mods).entries);
const props: Omit<ModsPanelProps, "mode"> = {
  mods: [],
  totalCount: 0,
  tags: requireValue(vault.userTags),
  search: "",
  searchScope: searchScopes.all,
  sort: "newest",
  activeIds: new Set(),
  activeOrder: new Map(),
  onSearch: noop,
  onSearchScope: noop,
  onSort: noop,
  onSelect: noop,
  onSubscribe: noop,
  onUnsubscribe: noop,
};

void test("offline or busy Steam disables row and bulk actions, not mod selection or filters", () => {
  for (const reason of [
    "Start Steam before changing subscriptions",
    "An operation is in progress",
  ]) {
    const disabledProps = {
      ...props,
      subscriptionDisabled: true,
      subscriptionDisabledReason: reason,
    };
    const html = renderToStaticMarkup(
      <>
        <AppHeader
          notice="Ready"
          disabled={false}
          cleanupDisabledReason={reason}
          onOpenSettings={noop}
          onManageTags={noop}
          onSync={noop}
          onUnsubscribeInactive={noop}
        />
        <ModsPanel {...disabledProps} mode="unsubscribed" mods={[mod("3")]} totalCount={1} />
        <SubscribedModsPanel {...disabledProps} mods={[mod("1", true)]} totalCount={1} />
      </>,
    );
    const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);
    const subscriptionButtons = buttons.filter((button) =>
      /aria-label="(?:Subscribe|Unsubscribe)/.test(button),
    );
    assert.equal(subscriptionButtons.length, 3);
    assert.ok(subscriptionButtons.every((button) => button.includes('disabled=""')));
    assert.doesNotMatch(html, /Delete all library mods/);
    const selectionButtons = buttons.filter((button) => button.includes('class="mod-row-main"'));
    assert.equal(selectionButtons.length, 2);
    assert.ok(selectionButtons.every((button) => !button.includes("disabled")));
    assert.doesNotMatch(html, /<(?:input|select)[^>]*disabled/);
    assert.match(html, new RegExp(`data-tip="${reason}"`));
    assert.match(html, /Quality of life/);
  }
});

void test("subscription buttons reenable when Steam is running", () => {
  const html = renderToStaticMarkup(
    <>
      <AppHeader
        notice="Ready"
        disabled={false}
        onOpenSettings={noop}
        onManageTags={noop}
        onSync={noop}
        onUnsubscribeInactive={noop}
      />
      <ModsPanel {...props} mode="unsubscribed" mods={[mod("3")]} />
      <SubscribedModsPanel {...props} mods={[mod("1", true)]} />
    </>,
  );
  const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);
  const subscriptionButtons = buttons.filter((button) =>
    /aria-label="(?:Subscribe|Unsubscribe)/.test(button),
  );
  assert.equal(subscriptionButtons.length, 3);
  assert.ok(subscriptionButtons.every((button) => !button.includes("disabled")));
});

void test("offline Steam does not block Undo but applying drafts locks it", () => {
  for (const draftDisabled of [false, true]) {
    const html = renderToStaticMarkup(
      <ModRow
        mod={mod("3")}
        tags={[]}
        selected={false}
        subscriptionAction="subscribe"
        subscriptionDisabled
        subscriptionDisabledReason="Start Steam first"
        draftDisabled={draftDisabled}
        pendingAction="unsubscribe"
        onUndoDraft={noop}
        onSelect={noop}
        onToggle={noop}
      />,
    );
    const button = requireValue(
      /<button[^>]*aria-label="Undo pending change for Mod 3"[^>]*>/.exec(html),
    )[0];
    assert.equal(button.includes('disabled=""'), draftDisabled);
  }
});

void test("Steam errors use a bounded dismissible toast outside the layout, safely escaping their contents", () => {
  const message = "Steam unavailable <script>alert(1)</script> ".repeat(300);
  const html = renderToStaticMarkup(<ErrorNotification message={message} onDismiss={noop} />);
  assert.match(html, /toast toast-end toast-bottom pointer-events-none z-\[1100\]/);
  assert.match(html, /alert alert-error pointer-events-auto/);
  assert.match(html, /role="alert"/);
  assert.match(html, /max-w-\[calc\(100vw-32px\)\]/);
  assert.match(html, /max-h-\[min\(240px,40vh\)\] overflow-auto/);
  assert.match(html, /aria-label="Dismiss notification"/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|aria-modal="true"/);
});

void test("error messages hide Electron transport details and safely handle unexpected failures", () => {
  assert.equal(
    errorMessage(
      new Error("Error invoking remote method 'steam:set-subscription': Error: Start Steam first"),
    ),
    "Start Steam first",
  );
  assert.equal(
    errorMessage(
      "Error invoking remote method 'steam:preview-library-subscriptions': Steam refused",
    ),
    "Steam refused",
  );
  assert.equal(errorMessage(new Error("Not signed in")), "Not signed in");
  assert.match(errorMessage(undefined), /could not be completed/);
  assert.match(errorMessage({ message: "unsafe object" }), /could not be completed/);
});

void test("center and right partition by actual subscription status, not the old Active draft or selection", () => {
  const before = JSON.stringify(vault);
  const panels = build();
  assert.deepEqual(
    panels.unsubscribed.map((entry) => entry.id),
    ["steam-3"],
  );
  assert.deepEqual(
    panels.subscribed.map((entry) => entry.id),
    ["steam-1", "steam-2", "steam-4"],
  );
  assert.deepEqual(
    filterLibrary(panels.subscribed, "", searchScopes.all, "active", [], panels.activeOrder).map(
      (entry) => entry.id,
    ),
    ["steam-2", "steam-1", "steam-4"],
  );
  assert.deepEqual([...panels.activeOrder.values()], [1, 3]);
  assert.equal(JSON.stringify(vault), before);
});

void test("unsubscribed library mods never inherit Active from Harmony packages, even when installed metadata is unavailable", () => {
  const harmony = { ...mod("2009463077", true), name: "Harmony", packageId: "brrainz.harmony" };
  const saved = [
    { ...mod("867467808"), name: "Camera+", packageId: "brrainz.harmony" },
    { ...mod("2949320350"), name: "Guns Galore - Core", packageId: "brrainz.harmony" },
    { ...mod("3306119571", true), name: "Voice Acted Colonists", packageId: "brrainz.harmony" },
  ];
  const current = {
    ...vault,
    mods: [...saved, harmony],
    localSteamState: {
      ...vault.localSteamState,
      observedIds: [requireValue(harmony.workshopId)],
    },
  };
  const state: ActiveModsState = {
    packageIds: ["brrainz.harmony", "ludeon.rimworld"],
    metadataError: "Workshop drive disconnected",
  };
  const before = JSON.stringify(current);
  const panels = build(current, state);
  assert.deepEqual(
    panels.unsubscribed.map((entry) => entry.id),
    saved.map((entry) => entry.id),
  );
  assert.deepEqual([...panels.activeIds], [harmony.id]);
  assert.deepEqual([...panels.activeOrder], [[harmony.id, 1]]);
  const center = renderToStaticMarkup(
    <ModsPanel
      {...props}
      mode="unsubscribed"
      mods={panels.unsubscribed}
      activeIds={panels.activeIds}
      activeOrder={panels.activeOrder}
    />,
  );
  assert.doesNotMatch(center, /class="active-pill"/);
  for (const entry of panels.unsubscribed) {
    assert.equal(entry.subscribed, false);
    const info = renderToStaticMarkup(
      <ModInfoPanel
        mod={entry}
        active={panels.activeIds.has(entry.id)}
        tags={requireValue(vault.userTags)}
        onRemoveModFromLibrary={noop}
        onAssignTag={noop}
        onCreateTag={noop}
      />,
    );
    assert.doesNotMatch(info, /Active in RimWorld/);
  }
  assert.equal(JSON.stringify(current), before);
});

void test("moving an enabled mod to Library clears its Active badge and order without changing the game configuration", () => {
  const before = build();
  assert.ok(before.activeIds.has("steam-2"));
  const current = {
    ...vault,
    localSteamState: { ...vault.localSteamState, observedIds: ["1", "4"] },
  };
  const after = build(current);
  assert.ok(after.unsubscribed.some((entry) => entry.id === "steam-2"));
  assert.equal(after.activeIds.has("steam-2"), false);
  assert.equal(after.activeOrder.has("steam-2"), false);
  assert.deepEqual([...after.activeOrder], [["steam-1", 3]]);
  assert.deepEqual(active.packageIds, ["Author.Mod2_steam", "ludeon.rimworld", "author.mod1"]);
  assert.deepEqual(
    build({
      ...current,
      localSteamState: { ...current.localSteamState, observedIds: ["1", "2", "4"] },
    }).activeOrder,
    before.activeOrder,
  );
});

void test("unsubscribing moves to the center without losing tags, notes or metadata, including on reopen", () => {
  const updated = normalizeVault({
    ...vault,
    localSteamState: { ...vault.localSteamState, observedIds: ["1", "2"] },
  });
  const panels = build(updated);
  assert.deepEqual(
    panels.unsubscribed.map((entry) => entry.id),
    ["steam-3", "steam-4"],
  );
  assert.equal(requireValue(panels.unsubscribed[1]).subscribed, false);
  assert.equal(requireValue(panels.unsubscribed[1]).notes, "Keep my note");
  assert.deepEqual(requireValue(panels.unsubscribed[1]).userTagIds, ["qol"]);
  const reopened = build(normalizeVault(JSON.parse(JSON.stringify(updated))));
  assert.deepEqual(reopened.unsubscribed, panels.unsubscribed);
  assert.equal(updated.mods.length, vault.mods.length);
});

void test("both subscription lists support scoped search and download sorting independently", () => {
  const untagged = { ...mod("5", true), author: "Other author", userTagIds: [] };
  const updated = normalizeVault({
    ...vault,
    mods: [...vault.mods, untagged],
    localSteamState: {
      ...vault.localSteamState,
      observedIds: ["1", "2", "4", "5"],
    },
  });
  const panels = build(updated);
  assert.deepEqual(
    filterLibrary(panels.subscribed, "Other", searchScopes.author, "newest").map(
      (entry) => entry.id,
    ),
    ["steam-5"],
  );
  assert.deepEqual(
    filterLibrary(panels.subscribed, "Quality", searchScopes.tags, "oldest", updated.userTags).map(
      (entry) => entry.id,
    ),
    ["steam-1", "steam-2", "steam-4"],
  );
  assert.deepEqual(
    filterLibrary(panels.unsubscribed, "Author", searchScopes.author, "newest").map(
      (entry) => entry.id,
    ),
    ["steam-3"],
  );
});

void test("both panels show assigned tags, directional Steam actions and consistent filtered counts", () => {
  const panels = build();
  const center = renderToStaticMarkup(
    <ModsPanel {...props} mode="unsubscribed" mods={panels.unsubscribed} totalCount={1} />,
  );
  const right = renderToStaticMarkup(
    <SubscribedModsPanel
      {...props}
      mods={panels.subscribed}
      totalCount={3}
      sort="active"
      activeIds={panels.activeIds}
      activeOrder={panels.activeOrder}
    />,
  );
  assert.match(center, /Unsubscribed library mods/);
  assert.match(center, /Quality of life/);
  assert.match(center, /Subscribe to Mod 3/);
  assert.match(right, /Quality of life/);
  assert.match(right, /Unsubscribe from Mod 4/);
  assert.match(right, /2 active/);
  assert.doesNotMatch(right, /Load order|>#\d+</);
  assert.doesNotMatch(center + right, /Unsubscribe all non-active mods|Delete all library mods/);
  assert.doesNotMatch(center + right, /Apply Active|Unapplied draft|Add .* to Active/);
});

void test("subscribe actions are last in Library rows and unsubscribe actions are first in subscribed rows", () => {
  const center = renderToStaticMarkup(
    <ModsPanel {...props} mode="unsubscribed" mods={[mod("3")]} totalCount={1} />,
  );
  const right = renderToStaticMarkup(
    <SubscribedModsPanel {...props} mods={[mod("1", true)]} totalCount={1} />,
  );
  const libraryRow = center.slice(center.indexOf('role="listitem"'));
  const subscribedRow = right.slice(right.indexOf('role="listitem"'));
  assert.ok(
    libraryRow.indexOf('class="mod-row-main"') <
      libraryRow.indexOf('aria-label="Subscribe to Mod 3"'),
  );
  assert.ok(
    subscribedRow.indexOf('aria-label="Unsubscribe from Mod 1"') <
      subscribedRow.indexOf('class="mod-row-main"'),
  );
  assert.match(right, /class="mod-row action-start/);
  assert.doesNotMatch(center, /class="mod-row action-start/);
  assert.match(right, /lucide-arrow-left/);
  assert.match(center, /lucide-arrow-right/);
});

void test("both lists omit dates and position numbers while Mod Info retains the download date", () => {
  const entry = { ...mod("3"), downloadedAt: "2026-02-17T12:00:00Z" };
  const date = formatDate(entry.downloadedAt);
  const lists = renderToStaticMarkup(
    <>
      <ModsPanel {...props} mode="unsubscribed" mods={[entry]} totalCount={1} />
      <SubscribedModsPanel {...props} mods={[{ ...entry, subscribed: true }]} totalCount={1} />
    </>,
  );
  assert.ok(!lists.includes(date));
  assert.doesNotMatch(lists, /date-pill|Load order|>#\d+</);
  const info = renderToStaticMarkup(
    <ModInfoPanel
      mod={entry}
      tags={[]}
      onRemoveModFromLibrary={noop}
      onAssignTag={noop}
      onCreateTag={noop}
    />,
  );
  assert.match(info, /Downloaded/);
  assert.ok(info.includes(date));
});

void test("unreadable Active does not turn every subscription into an inactive mod or block tag management", () => {
  const state = { ...active, packageIds: [], error: "Config unreadable" };
  const panels = build(vault, state);
  assert.equal(panels.activeIds.size, 0);
  const html = renderToStaticMarkup(
    <SubscribedModsPanel
      {...props}
      mods={panels.subscribed}
      totalCount={3}
      activeError={state.error}
    />,
  );
  assert.doesNotMatch(html, /Active status could not be fully verified/);
  const header = renderToStaticMarkup(
    <AppHeader
      notice="Ready"
      activeError={state.error}
      disabled={false}
      onOpenSettings={noop}
      onManageTags={noop}
      onSync={noop}
      onUnsubscribeInactive={noop}
    />,
  );
  assert.match(header, /Active status could not be fully verified. Cleanup is disabled/);
  assert.ok(header.indexOf("Ready") < header.indexOf("Active status could not be fully verified"));
  assert.match(
    header,
    /Unsubscribe all non-active mods[^>]*><button[^>]*disabled|disabled[^>]*Unsubscribe all non-active mods/,
  );
  assert.equal(getModActivity(mod("4"), state), "unknown");
});

void test("passive Workshop status changes only membership, retaining edits made while it was reading", () => {
  const base = { ...vault, revision: "current" };
  const edited = {
    ...assignTagsToMods(base, ["steam-3"], ["qol"], false),
    selectedModId: "steam-3",
  };
  const snapshot = {
    revision: "current",
    observedIds: ["1", "4"],
    observedAt: "2026-01-01T00:00:00.000Z",
    pending: {},
    warnings: [],
  };
  const updated = applyWorkshopStatus(edited, snapshot);
  assert.deepEqual(
    updated.mods.map((mod) => mod.subscribed),
    [true, false, false, true],
  );
  assert.deepEqual(requireValue(updated.mods[2]).userTagIds, []);
  assert.equal(updated.selectedModId, "steam-3");
  assert.equal(requireValue(updated.mods[2]).notes, "Keep my note");
  assert.equal(updated.mods.length, edited.mods.length);
  assert.deepEqual(updated.userTags, edited.userTags);
  assert.equal(applyWorkshopStatus(updated, snapshot), updated);
});

void test("stale passive results cannot overwrite a newer database revision or changed Workshop folder", () => {
  const current = { ...vault, revision: "new", settings: { workshopModsPath: "/new/294100" } };
  const snapshot = {
    revision: "old",
    workshopModsPath: "/new/294100",
    observedIds: [],
    observedAt: "2026-01-01T00:00:00.000Z",
    pending: {},
    warnings: [],
  };
  assert.equal(applyWorkshopStatus(current, snapshot), current);
  assert.equal(
    applyWorkshopStatus(current, { ...snapshot, revision: "new", workshopModsPath: "/old/294100" }),
    current,
  );
});

void test("long disconnected-drive errors stay in tooltips, keep both mod panels rendered, and do not disable tag management", () => {
  const details =
    "Cannot read /Volumes/Very long disconnected drive/SteamLibrary/steamapps/workshop/content/294100. ".repeat(
      30,
    );
  const state = { ...active, metadataError: details };
  const panels = build(vault, state);
  assert.equal(panels.activeIds.size, 2);
  assert.deepEqual([...panels.activeOrder.values()], [1, 3]);
  const html = renderToStaticMarkup(
    <>
      <AppHeader
        notice="Ready"
        workshopError={details}
        activeError={details}
        disabled={false}
        onOpenSettings={noop}
        onManageTags={noop}
        onSync={noop}
        onUnsubscribeInactive={noop}
      />
      <ModsPanel {...props} mode="unsubscribed" mods={panels.unsubscribed} totalCount={1} />
      <SubscribedModsPanel
        {...props}
        mods={panels.subscribed}
        totalCount={3}
        activeError={details}
        activeIds={panels.activeIds}
        activeOrder={panels.activeOrder}
      />
    </>,
  );
  const warning = /<p class="header-active-warning"[^>]*>([^<]*)<\/p>/.exec(html)?.[1];
  assert.ok(warning && warning.length < 100);
  assert.match(html, /title="Cannot read \/Volumes\/Very long/);
  assert.match(html, /Workshop unavailable/);
  assert.match(html, /Search library mods/);
  assert.match(html, /Search subscribed mods/);
  assert.doesNotMatch(html, /<button[^>]*disabled[^>]*aria-label="Manage Tags"/);
});

void test("global tag management, Steam synchronization and cleanup appear once in the app header, not in either list", () => {
  const header = renderToStaticMarkup(
    <AppHeader
      notice="Ready"
      disabled={false}
      onOpenSettings={noop}
      onManageTags={noop}
      onSync={noop}
      onUnsubscribeInactive={noop}
    />,
  );
  assert.equal((header.match(/aria-label="Manage Tags"/g) ?? []).length, 1);
  assert.equal((header.match(/aria-label="Sync Workshop"/g) ?? []).length, 1);
  assert.equal((header.match(/aria-label="Unsubscribe all non-active mods"/g) ?? []).length, 1);
  const panels = renderToStaticMarkup(
    <>
      <ModsPanel {...props} mode="unsubscribed" />
      <SubscribedModsPanel {...props} activeError="Unreadable config" />
    </>,
  );
  assert.doesNotMatch(
    panels,
    /Manage Tags|Sync Workshop|Unsubscribe all non-active mods|Delete all library mods/,
  );
  const busy = renderToStaticMarkup(
    <AppHeader
      notice="Checking subscriptions"
      disabled
      onOpenSettings={noop}
      onManageTags={noop}
      onSync={noop}
      onUnsubscribeInactive={noop}
    />,
  );
  assert.equal((busy.match(/<button[^>]*disabled/g) ?? []).length, 3);
});

void test("folder-derived panels retain their scope and subscription actions without redundant per-row status labels", () => {
  const right = renderToStaticMarkup(
    <SubscribedModsPanel {...props} folderBased mods={[mod("1", true)]} totalCount={1} />,
  );
  assert.match(right, /Local Workshop mods/);
  assert.match(right, />Workshop<\/h2>/);
  assert.doesNotMatch(right, />Installed<\/span>|>Subscribed<\/span>/);
  const center = renderToStaticMarkup(
    <ModsPanel {...props} mode="unsubscribed" folderBased mods={[mod("2")]} totalCount={1} />,
  );
  assert.doesNotMatch(center, />Not installed<\/span>|>Not subscribed<\/span>/);
  assert.match(center, /Subscribe to Mod 2/);
});

void test("uncached subscriptions use current installed metadata or placeholders without restoring deleted records", () => {
  const deleted = deleteLibraryModsExplicitly(
    {
      ...vault,
      localSteamState: { ...vault.localSteamState, observedIds: ["2", "4"] },
      mods: vault.mods.map((entry) =>
        entry.id === "steam-1" ? { ...entry, subscribed: false } : entry,
      ),
    },
    ["steam-1"],
  );
  const panels = build(
    {
      ...deleted,
      localSteamState: {
        ...deleted.localSteamState,
        observedIds: ["1", "2", "4", "9"],
      },
    },
    {
      ...active,
      installedMods: [
        {
          packageId: "author.mod1",
          workshopId: "1",
          localPath: "/mods/1",
          name: "Current installed name",
        },
      ],
    },
  );
  assert.equal(requireValue(panels.subscribed[0]).name, "Current installed name");
  assert.equal(requireValue(panels.subscribed[0]).subscribed, true);
  assert.ok(panels.activeIds.has("steam-1"));
  assert.equal(requireValue(panels.subscribed[3]).name, "Workshop item 9");
  assert.equal(requireValue(panels.subscribed[3]).workshopId, "9");
  assert.equal(
    deleted.mods.some((entry) => entry.id === "steam-1"),
    false,
  );
  assert.equal(
    panels.unsubscribed.some((entry) => entry.id === "steam-1"),
    false,
  );
});

void test("installed Workshop identity marks Active even when cached saved packages are wrong", () => {
  const wrong = { ...mod("1", true), packageId: "stale.package" };
  const state = {
    ...active,
    installedMods: [{ packageId: "author.mod1", workshopId: "1", localPath: "/mods/1" }],
  };
  assert.equal(getModActivity(wrong, state), "active");
  const falsePositive = { ...mod("4", true), packageId: "author.mod1" };
  assert.equal(getModActivity(falsePositive, state), "inactive");
});
