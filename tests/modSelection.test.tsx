import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { VaultStore } from "../src/main/vaultStore";
import { ModContextMenuContent } from "../src/renderer/src/components/common/ModContextMenu";
import { ModRowView as ModRow } from "../src/renderer/src/components/common/ModRow";
import { TagAssignments } from "../src/renderer/src/components/common/TagAssignments";
import { TooltipIconButton } from "../src/renderer/src/components/common/TooltipIconButton";
import { BulkTagsModal } from "../src/renderer/src/components/modals/BulkTagsModal";
import { ModInfoPanel } from "../src/renderer/src/components/panels/ModInfoPanel";
import {
  ModsPanelView as ModsPanel,
  type ModsPanelViewProps as ModsPanelProps,
} from "../src/renderer/src/components/panels/ModsPanel";
import { performUiAction } from "../src/renderer/src/services/uiActions";
import { modBatchAvailability } from "../src/renderer/src/utils/library";
import {
  contextModSelection,
  emptyModSelection,
  menuFocusIndex,
  type MenuPoint,
  modTagTargets,
  positionContextMenu,
  reconcileModSelection,
  type SelectionModifiers,
  selectModRow,
} from "../src/renderer/src/utils/modSelection";
import { assignTagsToMods } from "../src/shared/tags";
import type { Mod, ModTag, ModVault } from "../src/shared/types";
import { requireValue } from "../src/shared/validation";
import { deleteLibraryModsExplicitly, normalizeVault, serializeVault } from "../src/shared/vault";
import { sourceCallArguments } from "./helpers/sourceCalls";

const noop = () => undefined;
const ordered = ["a", "b", "c", "d", "e"];
const tags: ModTag[] = [
  { id: "qol", name: "Quality of life", color: "#7fbf90" },
  { id: "tribal", name: "Tribal", color: "#d7a84f" },
  { id: "starwars", name: "Star Wars", color: "#73a8d8" },
];
const mod = (id: string, userTagIds: string[] = []): Mod => ({
  id: `steam-${id}`,
  workshopId: id,
  name: `Mod ${id}`,
  author: "Author",
  source: "steam",
  summary: "Saved description",
  tags: ["Steam category"],
  userTagIds,
  gameVersions: ["1.6"],
  screenshots: [],
  subscribed: false,
  addedAt: "2025-01-01",
  downloadedAt: "2025-01-02",
  notes: "Keep notes",
});
const makeVault = (): ModVault =>
  normalizeVault({
    mods: [mod("1", ["qol"]), mod("2", ["tribal"]), mod("3", ["qol", "starwars"])],

    userTags: tags,
    selectedModId: "steam-2",
    localSteamState: { observedIds: [], pending: {} },
    settings: { workshopModsPath: "/unavailable" },
    customExtension: "Keep",
  });

void test("normal click selects one row, and forward/backward Shift ranges retain their original anchor", () => {
  const first = selectModRow(emptyModSelection, "unsubscribed", ordered, "c");
  assert.deepEqual(first, { panel: "unsubscribed", ids: ["c"], anchorId: "c" });
  const forward = selectModRow(first, "unsubscribed", ordered, "e", { shiftKey: true });
  assert.deepEqual(forward.ids, ["c", "d", "e"]);
  const backward = selectModRow(forward, "unsubscribed", ordered, "a", { shiftKey: true });
  assert.deepEqual(backward.ids, ["a", "b", "c"]);
  assert.equal(backward.anchorId, "c");
  assert.deepEqual(selectModRow(backward, "unsubscribed", ordered, "d").ids, ["d"]);
  assert.deepEqual(
    selectModRow(emptyModSelection, "subscribed", ordered, "d", { shiftKey: true }).ids,
    ["d"],
  );
});

void test("Shift selection uses the full filtered/sorted order, not just virtualized DOM rows", () => {
  const ids = Array.from({ length: 2100 }, (_, index) => `steam-${index + 1}`);
  const first = selectModRow(emptyModSelection, "subscribed", ids, requireValue(ids[0]));
  const all = selectModRow(first, "subscribed", ids, requireValue(ids[2099]), { shiftKey: true });
  assert.deepEqual(all.ids, ids);
  const filtered = [
    requireValue(ids[100]),
    requireValue(ids[99]),
    requireValue(ids[98]),
    requireValue(ids[90]),
  ];
  const selection = selectModRow(
    emptyModSelection,
    "unsubscribed",
    filtered,
    requireValue(filtered[0]),
  );
  assert.deepEqual(
    selectModRow(selection, "unsubscribed", filtered, requireValue(filtered[3]), { shiftKey: true })
      .ids,
    filtered,
  );
});

void test("Command/Control toggles individual rows and Shift with Command/Control adds a range", () => {
  for (const key of ["metaKey", "ctrlKey"] as const) {
    const first = selectModRow(emptyModSelection, "unsubscribed", ordered, "a");
    const second = selectModRow(first, "unsubscribed", ordered, "c", { [key]: true });
    assert.deepEqual(second.ids, ["a", "c"]);
    const range = selectModRow(second, "unsubscribed", ordered, "e", {
      [key]: true,
      shiftKey: true,
    });
    assert.deepEqual(range.ids, ["a", "c", "d", "e"]);
    assert.deepEqual(selectModRow(range, "unsubscribed", ordered, "c", { [key]: true }).ids, [
      "a",
      "d",
      "e",
    ]);
  }
});

void test("switching panels or losing the filtered anchor never creates a cross-panel or hidden selection", () => {
  const selection = selectModRow(
    selectModRow(emptyModSelection, "unsubscribed", ordered, "b"),
    "unsubscribed",
    ordered,
    "d",
    { shiftKey: true },
  );
  assert.deepEqual(selectModRow(selection, "subscribed", ordered, "e", { shiftKey: true }).ids, [
    "e",
  ]);
  const reconciled = reconcileModSelection(selection, ["d", "c"]);
  assert.deepEqual(reconciled.ids, ["d", "c"]);
  assert.equal(reconciled.anchorId, undefined);
  assert.deepEqual(
    selectModRow(reconciled, "unsubscribed", ["d", "c"], "c", { shiftKey: true }).ids,
    ["c"],
  );
  assert.equal(reconcileModSelection(selection, []), emptyModSelection);
  assert.equal(selectModRow(selection, "unsubscribed", ordered, "missing"), selection);
});

void test("right-click preserves the selected group and anchor, but replaces it for an unselected row or another panel", () => {
  const selection = selectModRow(
    selectModRow(emptyModSelection, "subscribed", ordered, "b"),
    "subscribed",
    ordered,
    "d",
    { shiftKey: true },
  );
  assert.equal(contextModSelection(selection, "subscribed", ordered, "c"), selection);
  assert.deepEqual(contextModSelection(selection, "subscribed", ordered, "e").ids, ["e"]);
  assert.deepEqual(contextModSelection(selection, "unsubscribed", ordered, "c").ids, ["c"]);
  assert.deepEqual(contextModSelection(selection, "subscribed", ["c", "d"], "c").ids, ["c", "d"]);
});

void test("Mod Info tag targets use the selected group only when the displayed mod belongs to it", () => {
  const selection = {
    panel: "unsubscribed" as const,
    ids: ["steam-1", "steam-2"],
    anchorId: "steam-1",
  };
  const targets = modTagTargets(selection, "steam-2");
  assert.deepEqual(targets, selection.ids);
  assert.notEqual(targets, selection.ids);
  targets.push("steam-3");
  assert.deepEqual(selection.ids, ["steam-1", "steam-2"]);
  assert.deepEqual(modTagTargets(selection, "steam-3"), ["steam-3"]);
  assert.deepEqual(modTagTargets(emptyModSelection, "steam-2"), ["steam-2"]);
  const deselected = selectModRow(
    selection,
    "unsubscribed",
    ["steam-1", "steam-2", "steam-3"],
    "steam-2",
    { metaKey: true },
  );
  assert.deepEqual(modTagTargets(deselected, "steam-2"), ["steam-2"]);
});

void test("bulk add/remove tags operates on exactly the selected records, preserving unrelated tags and every other field", () => {
  const original = makeVault();
  const before = JSON.stringify(original);
  const added = assignTagsToMods(
    original,
    ["steam-1", "steam-2", "steam-1"],
    ["starwars", "qol", "starwars"],
    true,
  );
  assert.deepEqual(requireValue(added.mods[0]).userTagIds, ["qol", "starwars"]);
  assert.deepEqual(requireValue(added.mods[1]).userTagIds, ["tribal", "starwars", "qol"]);
  assert.deepEqual(added.mods[2], original.mods[2]);
  const removed = assignTagsToMods(added, ["steam-1", "steam-2"], ["qol"], false);
  assert.deepEqual(requireValue(removed.mods[0]).userTagIds, ["starwars"]);
  assert.deepEqual(requireValue(removed.mods[1]).userTagIds, ["tribal", "starwars"]);
  for (let index = 0; index < 3; index++) {
    const { userTagIds: _old, ...old } = requireValue(original.mods[index]);
    const { userTagIds: _next, ...next } = requireValue(removed.mods[index]);
    assert.deepEqual(next, old);
  }
  assert.deepEqual(removed.userTags, original.userTags);
  assert.deepEqual(removed.settings, original.settings);
  assert.deepEqual(removed.localSteamState, original.localSteamState);
  assert.equal(JSON.stringify(original), before);
});

void test("bulk tags are all-or-nothing when a selected mod or tag has been deleted; deleted records are never restored", async () => {
  const original = deleteLibraryModsExplicitly(makeVault(), ["steam-1"]);
  const before = JSON.stringify(original);
  const errors: string[] = [];
  await performUiAction(
    () => assignTagsToMods(original, ["steam-1", "steam-2"], ["qol"], true),
    (error) => errors.push(String(error)),
  );
  assert.equal(errors.length, 1);
  assert.match(requireValue(errors[0]), /No tags were edited/);
  assert.throws(
    () => assignTagsToMods(original, ["steam-2"], ["qol", "deleted-tag"], false),
    /No tags were edited/,
  );
  assert.equal(assignTagsToMods(original, [], ["qol"], true), original);
  assert.equal(assignTagsToMods(original, ["steam-2"], [], true), original);
  assert.equal(JSON.stringify(original), before);
});

void test("bulk tag edits survive the ordinary save/reopen flow without requiring Steam or an available mod folder", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bulk-tags-"));
  try {
    const store = new VaultStore(join(directory, "vault.json"));
    await writeFile(store.path, JSON.stringify(serializeVault(makeVault())));
    const original = await store.load();
    const updated = assignTagsToMods(original, ["steam-1", "steam-2"], ["starwars"], true);
    await store.save(updated);
    const reopened = await new VaultStore(store.path).load();
    assert.deepEqual(
      reopened.mods.map((mod) => mod.userTagIds),
      [
        ["qol", "starwars"],
        ["tribal", "starwars"],
        ["qol", "starwars"],
      ],
    );
    assert.deepEqual(reopened.userTags, tags);
    assert.deepEqual(reopened.localSteamState.observedIds, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("Steam availability disables only subscription menu actions; local and unsaved items remain protected", () => {
  const mods = makeVault().mods;
  const saved = new Set(mods.map((mod) => mod.id));
  const offline = modBatchAvailability(mods, saved, false, true, "Start Steam first");
  assert.equal(offline.tagsDisabledReason, undefined);
  assert.equal(offline.subscriptionDisabledReason, "Start Steam first");
  assert.equal(
    modBatchAvailability(mods, saved, false, false).subscriptionDisabledReason,
    undefined,
  );
  const local = { ...requireValue(mods[0]), workshopId: undefined, source: "local" as const };
  const availability = modBatchAvailability([local], saved, false, false);
  assert.equal(availability.tagsDisabledReason, undefined);
  assert.match(requireValue(availability.subscriptionDisabledReason), /Local mods/);
  const unsaved = modBatchAvailability(mods, new Set(), false, false);
  assert.match(requireValue(unsaved.tagsDisabledReason), /save these mods/);
  assert.equal(unsaved.subscriptionDisabledReason, unsaved.tagsDisabledReason);
  assert.ok(modBatchAvailability(mods, saved, true, false).tagsDisabledReason);
});

function findElement(
  node: ReactNode,
  predicate: (node: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Record<string, unknown>>(child)) {
      continue;
    }
    if (predicate(child)) {
      return child;
    }
    const found = findElement(child.props.children as ReactNode, predicate);
    if (found) {
      return found;
    }
  }
  return undefined;
}

void test("Mod Info tag toggles add and remove tags across the selected group in either panel, without changing focus", () => {
  for (const panel of ["unsubscribed", "subscribed"] as const) {
    let current = makeVault();
    const original = JSON.stringify(current);
    const ids = current.mods.map((entry) => entry.id);
    const selection = selectModRow(
      selectModRow(emptyModSelection, panel, ids, "steam-1"),
      panel,
      ids,
      "steam-2",
      { shiftKey: true },
    );
    const tree = ModInfoPanel({
      mod: current.mods[1],
      tags,
      onRemoveModFromLibrary: noop,
      onCreateTag: noop,
      onAssignTag: (modId, tagId, assigned) => {
        current = assignTagsToMods(current, modTagTargets(selection, modId), [tagId], assigned);
      },
    });
    const assignments = findElement(tree, (element) => element.type === TagAssignments);
    assert.ok(assignments);
    const toggle = assignments.props.onToggle as (tagId: string, assigned: boolean) => void;
    toggle("starwars", true);
    assert.deepEqual(
      current.mods.map((entry) => entry.userTagIds),
      [
        ["qol", "starwars"],
        ["tribal", "starwars"],
        ["qol", "starwars"],
      ],
    );
    toggle("tribal", false);
    assert.deepEqual(
      current.mods.map((entry) => entry.userTagIds),
      [["qol", "starwars"], ["starwars"], ["qol", "starwars"]],
    );
    assert.equal(current.selectedModId, "steam-2");
    assert.deepEqual(selection.ids, ["steam-1", "steam-2"]);
    assert.deepEqual(current.mods[2], normalizeVault(JSON.parse(original)).mods[2]);
    assert.deepEqual(current.localSteamState.observedIds, []);
  }
});

void test("tag creation from Mod Info captures its selection and persists assignments on that group", async () => {
  const directory = await mkdtemp(join(tmpdir(), "selected-tag-creation-"));
  try {
    const current = makeVault();
    const ids = current.mods.map((entry) => entry.id);
    let selection = selectModRow(
      selectModRow(emptyModSelection, "unsubscribed", ids, "steam-1"),
      "unsubscribed",
      ids,
      "steam-2",
      { shiftKey: true },
    );
    const targets = modTagTargets(selection, "steam-2");
    selection = selectModRow(selection, "unsubscribed", ids, "steam-3");
    const tag = { id: "new-tag", name: "New tag", color: "#73a8d8" };
    const store = new VaultStore(join(directory, "vault.json"));
    await writeFile(store.path, JSON.stringify(serializeVault(current)));
    const loaded = await store.load();
    const next = assignTagsToMods(
      { ...loaded, userTags: [...requireValue(loaded.userTags), tag] },
      targets,
      [tag.id],
      true,
    );
    await store.save(next);
    const reopened = await new VaultStore(store.path).load();
    assert.deepEqual(
      reopened.mods.map((entry) => entry.userTagIds?.includes(tag.id)),
      [true, true, false],
    );
    assert.deepEqual(selection.ids, ["steam-3"]);
    assert.deepEqual(reopened.localSteamState, current.localSteamState);
    assert.equal(reopened.mods.length, current.mods.length);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("row clicks forward modifiers and focus the last clicked mod without collapsing a Shift range", () => {
  const renderRow = (ModRow as unknown as { type: (props: object) => ReactNode }).type;
  let selection = emptyModSelection;
  let focused: string | undefined;
  const ids = ["steam-1", "steam-2", "steam-3"];
  const onSelect = (id: string, modifiers?: SelectionModifiers) => {
    selection = selectModRow(selection, "unsubscribed", ids, id, modifiers);
    focused = id;
  };
  for (const [id, shiftKey] of [
    ["1", false],
    ["3", true],
  ] as const) {
    const tree = renderRow({
      mod: mod(id),
      tags,
      selected: false,
      subscriptionAction: "subscribe",
      onSelect,
      onToggle: noop,
    });
    const button = findElement(tree, (node) => node.props.className === "mod-row-main");
    assert.ok(button);
    (button.props.onClick as (event: SelectionModifiers) => void)({ shiftKey });
  }
  assert.deepEqual(selection.ids, ids);
  assert.equal(focused, "steam-3");
});

void test("row context events suppress the browser menu and retain the clicked mod and pointer/keyboard position", () => {
  const renderRow = (ModRow as unknown as { type: (props: object) => ReactNode }).type;
  const points: MenuPoint[] = [];
  let prevented = 0;
  let focused = 0;
  const tree = renderRow({
    mod: mod("1"),
    tags,
    selected: true,
    focused: true,
    subscriptionAction: "subscribe",
    onSelect: noop,
    onToggle: noop,
    onContextMenu: (id: string, point: MenuPoint) => {
      assert.equal(id, "steam-1");
      points.push(point);
    },
  });
  const row = findElement(tree, (node) => node.props.role === "listitem");
  assert.ok(row);
  const target = {
    querySelector: () => ({
      focus: () => {
        focused++;
      },
    }),
    getBoundingClientRect: () => ({ left: 10, top: 20, height: 88 }),
  };
  const onContext = row.props.onContextMenu as (event: object) => void;
  onContext({
    clientX: 400,
    clientY: 300,
    currentTarget: target,
    preventDefault: () => {
      prevented++;
    },
  });
  onContext({
    clientX: 0,
    clientY: 0,
    currentTarget: target,
    preventDefault: () => {
      prevented++;
    },
  });
  assert.deepEqual(points, [
    { x: 400, y: 300 },
    { x: 50, y: 64 },
  ]);
  assert.equal(focused, 2);
  assert.equal(prevented, 2);
});

void test("list rows place Active first and tags on the same chip line, without redundant installed or subscription labels", () => {
  const html = renderToStaticMarkup(
    <ModRow
      mod={mod("1", ["qol", "tribal", "starwars"])}
      tags={tags}
      selected
      active
      subscriptionAction="unsubscribe"
      onSelect={noop}
      onToggle={noop}
    />,
  );
  assert.ok(html.indexOf('class="active-pill"') < html.indexOf('class="user-tag"'));
  assert.match(html, /class="mod-row-status"[^>]*>.*Active.*Quality of life.*Tribal.*\+1/s);
  assert.doesNotMatch(html, /row-tags|>Installed<|>Not installed<|>Subscribed<|>Not subscribed</);
  assert.match(html, /aria-pressed="true"/);
});

void test("multi-selected rows are highlighted independently of the last focused Mod Info row", () => {
  const props: ModsPanelProps = {
    mode: "unsubscribed",
    mods: makeVault().mods,
    tags,
    totalCount: 3,
    selectedModId: "steam-3",
    selectedModIds: new Set(["steam-1", "steam-2"]),
    search: "",
    searchScope: "all",
    sort: "newest",
    activeIds: new Set(),
    activeOrder: new Map(),
    onSelect: noop,
    onSearch: noop,
    onSearchScope: noop,
    onSort: noop,
    onSubscribe: noop,
    onUnsubscribe: noop,
  };
  const html = renderToStaticMarkup(<ModsPanel {...props} />);
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 2);
  assert.equal((html.match(/aria-current="true"/g) ?? []).length, 1);
  assert.match(html, /2 selected/);
});

void test("context menu exposes tag, subscription and selection-aware library removal actions", () => {
  const calls: string[] = [];
  const props = {
    count: 3,
    subscribed: false,
    onAddTags: () => calls.push("add"),
    onRemoveTags: () => calls.push("remove"),
    onSubscription: () => calls.push("subscribe"),
    onRemoveFromLibrary: () => calls.push("remove-library"),
  };
  const html = renderToStaticMarkup(<ModContextMenuContent {...props} />);
  assert.match(html, /role="menu"/);
  assert.equal((html.match(/role="menuitem"/g) ?? []).length, 4);
  assert.match(html, /3 mods selected/);
  assert.match(html, /Add tags/);
  assert.match(html, /Remove tags/);
  assert.match(html, />Subscribe<\/button>/);
  assert.doesNotMatch(html, />Unsubscribe<\/button>/);
  const tree = ModContextMenuContent(props);
  for (const label of ["Add tags", "Remove tags", "Subscribe", "Remove from library"]) {
    const button = findElement(
      tree,
      (node) =>
        node.props.role === "menuitem" &&
        Children.toArray(node.props.children as ReactNode).includes(label),
    );
    assert.ok(button);
    (button.props.onClick as () => void)();
  }
  assert.deepEqual(calls, ["add", "remove", "subscribe", "remove-library"]);
  assert.match(
    renderToStaticMarkup(<ModContextMenuContent {...props} subscribed />),
    />Unsubscribe<\/button>/,
  );
});

void test("disabled menu commands never invoke actions even if their callbacks are called programmatically", () => {
  let actions = 0;
  const tree = ModContextMenuContent({
    count: 2,
    subscribed: true,
    tagsDisabledReason: "Not saved",
    subscriptionDisabledReason: "Steam is closed",
    onAddTags: () => actions++,
    onRemoveTags: () => actions++,
    onSubscription: () => actions++,
    onRemoveFromLibrary: () => actions++,
  });
  for (const label of ["Add tags", "Remove tags", "Unsubscribe", "Remove from library"]) {
    const button = findElement(
      tree,
      (node) =>
        node.props.role === "menuitem" &&
        Children.toArray(node.props.children as ReactNode).includes(label),
    );
    assert.ok(button);
    assert.equal(button.props.disabled, true);
    (button.props.onClick as () => void)();
  }
  assert.equal(actions, 0);
});

void test("Active rows and a selected group containing Active mods disable unsubscribe while tags remain editable", () => {
  const renderRow = (ModRow as unknown as { type: (props: object) => ReactNode }).type;
  let actions = 0;
  const tree = renderRow({
    mod: { ...mod("1"), subscribed: true },
    active: true,
    tags,
    selected: true,
    subscriptionAction: "unsubscribe",
    onSelect: noop,
    onToggle: () => actions++,
  });
  const button = findElement(tree, (node) => node.type === TooltipIconButton);
  assert.ok(button);
  assert.equal(button.props.disabled, true);
  assert.equal(button.props.label, "Active mods cannot be unsubscribed");
  (button.props.onClick as () => void)();
  assert.equal(actions, 0);
  const mods = [mod("1"), mod("2")].map((mod) => ({ ...mod, subscribed: true }));
  const availability = modBatchAvailability(
    mods,
    new Set(mods.map((mod) => mod.id)),
    false,
    false,
    undefined,
    new Set(["steam-1"]),
  );
  assert.equal(availability.tagsDisabledReason, undefined);
  assert.equal(availability.subscriptionDisabledReason, "Active mods cannot be unsubscribed");
  assert.match(requireValue(availability.removalDisabledReason), /Unsubscribe these mods/);
  const menu = ModContextMenuContent({
    count: 2,
    subscribed: true,
    ...availability,
    onAddTags: noop,
    onRemoveTags: noop,
    onSubscription: () => actions++,
    onRemoveFromLibrary: () => actions++,
  });
  for (const label of ["Unsubscribe", "Remove from library"]) {
    const action = findElement(
      menu,
      (node) =>
        node.props.role === "menuitem" &&
        Children.toArray(node.props.children as ReactNode).includes(label),
    );
    assert.ok(action);
    assert.equal(action.props.disabled, true);
    (action.props.onClick as () => void)();
  }
  assert.equal(actions, 0);
});

void test("unreadable or loading Active disables every right-panel row unsubscribe without blocking selection", () => {
  const props: ModsPanelProps = {
    mode: "subscribed",
    mods: [{ ...mod("1"), subscribed: true }],
    totalCount: 1,
    tags,
    search: "",
    searchScope: "all",
    sort: "active",
    activeIds: new Set(),
    activeOrder: new Map(),
    onSearch: noop,
    onSearchScope: noop,
    onSort: noop,
    onSelect: noop,
    onSubscribe: noop,
    onUnsubscribe: noop,
  };
  for (const extra of [{ activeLoading: true }, { activeError: "Config unavailable" }]) {
    const html = renderToStaticMarkup(<ModsPanel {...props} {...extra} />);
    assert.match(html, /<button[^>]*disabled=""[^>]*aria-label="Unsubscribe from Mod 1"/);
    assert.doesNotMatch(html, /<button[^>]*class="mod-row-main"[^>]*disabled/);
  }
  assert.match(
    requireValue(
      modBatchAvailability(
        props.mods,
        new Set(["steam-1"]),
        false,
        false,
        undefined,
        new Set(),
        "Unavailable",
      ).subscriptionDisabledReason,
    ),
    /Unsubscribe is disabled/,
  );
});

void test("Mod Info hides removal for subscribed mods and blocks invalid removal selections", () => {
  const props = { tags, onAssignTag: noop, onCreateTag: noop, onRemoveModFromLibrary: noop };
  assert.doesNotMatch(
    renderToStaticMarkup(<ModInfoPanel {...props} mod={{ ...mod("1"), subscribed: true }} />),
    /Remove from library|Remove saved mod/,
  );
  const removed: string[] = [];
  const tree = ModInfoPanel({
    ...props,
    mod: mod("1"),
    removalCount: 2,
    removalDisabledReason: "Selection contains subscribed mods",
    onRemoveModFromLibrary: (id) => removed.push(id),
  });
  const button = findElement(
    tree,
    (node) => node.type === "button" && node.props.className === "danger-action",
  );
  assert.ok(button);
  assert.equal(button.props.disabled, true);
  (button.props.onClick as () => void)();
  assert.deepEqual(removed, []);
});

void test("library removal stays available with Steam closed, but subscribed menu items can never invoke it", () => {
  let removed = 0;
  for (const subscribed of [false, true]) {
    const menu = ModContextMenuContent({
      count: 2,
      subscribed,
      subscriptionDisabledReason: "Steam unavailable",
      onAddTags: noop,
      onRemoveTags: noop,
      onSubscription: noop,
      onRemoveFromLibrary: () => removed++,
    });
    const action = findElement(
      menu,
      (node) =>
        node.props.role === "menuitem" &&
        Children.toArray(node.props.children as ReactNode).includes("Remove from library"),
    );
    assert.ok(action);
    assert.equal(action.props.disabled, subscribed);
    (action.props.onClick as () => void)();
  }
  assert.equal(removed, 1);
});

void test("context menu positioning clamps all viewport edges and keyboard navigation wraps enabled items", () => {
  const viewport = { width: 1180, height: 720 };
  const size = { width: 240, height: 160 };
  for (const point of [
    { x: 0, y: 0 },
    { x: 1180, y: 720 },
    { x: -200, y: 9999 },
    { x: 400, y: 300 },
  ]) {
    const position = positionContextMenu(point, size, viewport);
    assert.ok(position.left >= 8 && position.top >= 8);
    assert.ok(position.left + size.width <= viewport.width - 8);
    assert.ok(position.top + size.height <= viewport.height - 8);
  }
  assert.equal(menuFocusIndex("ArrowDown", 2, 3), 0);
  assert.equal(menuFocusIndex("ArrowUp", 0, 3), 2);
  assert.equal(menuFocusIndex("Home", 2, 3), 0);
  assert.equal(menuFocusIndex("End", 0, 3), 2);
  assert.equal(menuFocusIndex("ArrowDown", -1, 3), 0);
  assert.equal(menuFocusIndex("ArrowUp", -1, 3), 2);
  assert.equal(menuFocusIndex("ArrowUp", -1, 0), undefined);
});

void test("bulk tag choosers require explicit tag choices, support creation on add, and list only assigned tags on removal", () => {
  const props = {
    mods: [mod("1", ["qol"]), mod("2", ["tribal"])],
    tags,
    onClose: noop,
    onConfirm: noop,
    onCreateTag: noop,
  };
  const add = renderToStaticMarkup(<BulkTagsModal {...props} assigned />);
  assert.match(add, /Search tags for selected mods/);
  assert.match(add, /Star Wars/);
  assert.match(add, /Create tag/);
  assert.match(add, /type="submit" disabled=""/);
  const remove = renderToStaticMarkup(<BulkTagsModal {...props} assigned={false} />);
  assert.match(remove, /Quality of life/);
  assert.match(remove, /Tribal/);
  assert.doesNotMatch(remove, /Star Wars|Create tag/);
  const original = JSON.stringify(props.mods);
  renderToStaticMarkup(<BulkTagsModal {...props} assigned hidden />);
  assert.equal(JSON.stringify(props.mods), original);
});

void test("context menus escape panel clipping and App routes the full selection to tag, subscription and removal workflows", async () => {
  const menu = await readFile("src/renderer/src/components/common/ModContextMenu.tsx", "utf8");
  const css = await readFile("src/renderer/src/styles/selection.css", "utf8");
  const app = await readFile("src/renderer/src/App.tsx", "utf8");
  assert.match(menu, /createPortal\([\s\S]*document.body/);
  assert.match(css, /\.mod-context-menu\s*\{[^}]*fixed z-\[1050\]/);
  assert.match(app, /modTagTargets\(selection, modId\)/);
  assert.match(app, /modIds: modTagTargets\(selection, modId\)/);
  const assignments = await sourceCallArguments("src/renderer/src/App.tsx", "assignTags");
  assert.ok(
    assignments.some(
      (args) => args[0] === "modIds" && args[1] === "[tagId]" && args[2] === "assigned",
    ),
  );
  const calls = await sourceCallArguments("src/renderer/src/App.tsx", "stageChanges");
  assert.ok(
    calls.some(
      (args) =>
        args[0] ===
          "panel === modPanelModes.subscribed ? draftActions.unsubscribe : draftActions.subscribe" &&
        args[1] === "modIds",
    ),
  );
  const removals = await sourceCallArguments("src/renderer/src/App.tsx", "requestLibraryRemoval");
  assert.ok(removals.some((args) => args[0] === "modTagTargets(selection, id)"));
  assert.ok(removals.some((args) => args[0] === "contextMenu.modIds"));
  assert.match(app, /<DraftChangesModal/);
  assert.doesNotMatch(app, /getStore\(\)\.(?:deleteLibraryMods|setSubscription)/);
});
