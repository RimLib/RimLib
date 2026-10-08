import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  createWorkspaceStore,
  type WorkspaceState,
} from "../src/renderer/src/stores/workspaceStore";
import {
  useWorkspaceStore,
  WorkspaceStoreProvider,
} from "../src/renderer/src/stores/WorkspaceStoreProvider";
import { modPanelModes, modSorts, searchScopes } from "../src/renderer/src/utils/uiConstants";

const library = modPanelModes.unsubscribed;
const workshop = modPanelModes.subscribed;
const rows = ["a", "b", "c", "d"];
const point = { x: 12, y: 24 };

void test("workspace stores have independent session defaults and expose only observation and actions", () => {
  const first = createWorkspaceStore();
  const second = createWorkspaceStore();
  const initial = first.getState();
  assert.equal(first.getInitialState(), initial);
  assert.deepEqual(initial.views, {
    unsubscribed: { search: "", searchScope: searchScopes.all, sort: modSorts.newest },
    subscribed: { search: "", searchScope: searchScopes.all, sort: modSorts.active },
  });
  assert.equal(initial.focusedModId, undefined);
  assert.deepEqual(initial.selection, { ids: [] });
  assert.equal(initial.contextMenu, undefined);
  assert.equal("setState" in first, false);
  assert.notEqual(initial.selection.ids, second.getState().selection.ids);
  first.getState().actions.setSearch(library, "Changed");
  first.getState().actions.select(library, rows, "a");
  first.getState().actions.openContext(library, rows, "a", point);
  assert.equal(second.getState().views.unsubscribed.search, "");
  assert.deepEqual(second.getState().selection.ids, []);
  assert.equal(second.getState().contextMenu, undefined);
  const reopened = createWorkspaceStore();
  assert.deepEqual(reopened.getState().views, initial.views);
  assert.deepEqual(reopened.getState().selection.ids, []);
  assert.equal(reopened.getState().contextMenu, undefined);
  second.getState().actions.select(library, rows, "a");
  const emptyPanels = { unsubscribed: [], subscribed: [] };
  first.getState().actions.reconcile(emptyPanels);
  second.getState().actions.reconcile(emptyPanels);
  assert.notEqual(first.getState().selection.ids, second.getState().selection.ids);
});

void test("panel actions preserve other panel references, selection and stable action identities", () => {
  const store = createWorkspaceStore();
  const initial = store.getState();
  const { actions } = initial;
  actions.setSearch(library, "Camera");
  actions.setSort(library, modSorts.oldest);
  actions.setSearchScope(library, searchScopes.tags);
  assert.deepEqual(store.getState().views.unsubscribed, {
    search: "Camera",
    searchScope: searchScopes.tags,
    sort: modSorts.oldest,
  });
  assert.equal(store.getState().views.subscribed, initial.views.subscribed);
  assert.equal(store.getState().selection, initial.selection);
  assert.equal(store.getState().actions, actions);
  assert.equal(initial.views.unsubscribed.search, "");
});

void test("unchanged workspace actions do not notify subscribers and unsubscription stops delivery", () => {
  const store = createWorkspaceStore();
  const { actions } = store.getState();
  let calls = 0;
  const stop = store.subscribe(() => {
    calls++;
  });
  const initial = store.getState();
  actions.setSearch(library, "");
  actions.setSort(workshop, modSorts.active);
  actions.setSearchScope(workshop, searchScopes.all);
  actions.closeContext();
  actions.reconcile({ unsubscribed: [], subscribed: [] });
  assert.equal(calls, 0);
  assert.equal(store.getState(), initial);
  actions.setSearch(library, "Camera");
  assert.equal(calls, 1);
  stop();
  actions.setSearch(library, "Another query");
  assert.equal(calls, 1);
});

void test("changing a search scope updates one panel without clearing other controls", () => {
  const store = createWorkspaceStore();
  const { actions } = store.getState();
  actions.setSearch(library, "one");
  actions.setSearch(workshop, "two");
  actions.setSort(library, modSorts.oldest);
  actions.openContext(library, rows, "a", point);
  const transitions: WorkspaceState[] = [];
  const stop = store.subscribe((state) => {
    transitions.push(state);
  });
  actions.setSearchScope(library, searchScopes.tags);
  actions.setSearchScope(library, searchScopes.tags);
  stop();
  assert.equal(transitions.length, 1);
  assert.deepEqual(store.getState().views, {
    unsubscribed: { search: "one", searchScope: searchScopes.tags, sort: modSorts.oldest },
    subscribed: { search: "two", searchScope: searchScopes.all, sort: modSorts.active },
  });
  assert.equal(store.getState().contextMenu, undefined);
  assert.deepEqual(store.getState().selection.ids, ["a"]);
});

void test("search scope changes leave the unrelated panel view unchanged", () => {
  const store = createWorkspaceStore();
  const { actions } = store.getState();
  const other = store.getState().views.subscribed;
  actions.setSearchScope(library, searchScopes.description);
  assert.equal(store.getState().views.subscribed, other);
  assert.equal(other.searchScope, searchScopes.all);
});

void test("rapid selection actions use the latest anchor without waiting for React to render", () => {
  const store = createWorkspaceStore();
  const { actions } = store.getState();
  actions.select(library, rows, "b");
  assert.equal(store.getState().focusedModId, "b");
  const first = store.getState().selection;
  actions.select(library, rows, "d", { shiftKey: true });
  assert.deepEqual(store.getState().selection.ids, ["b", "c", "d"]);
  assert.deepEqual(first.ids, ["b"]);
  actions.select(library, rows, "c", { ctrlKey: true });
  assert.deepEqual(store.getState().selection.ids, ["b", "d"]);
  actions.select(workshop, rows, "a", { shiftKey: true });
  assert.equal(store.getState().focusedModId, "a");
  assert.deepEqual(store.getState().selection, { panel: workshop, ids: ["a"], anchorId: "a" });
});

void test("selection actions use current visible order even before reconciliation effects", () => {
  const store = createWorkspaceStore();
  const { actions } = store.getState();
  actions.select(library, rows, "b");
  actions.select(library, ["d", "c", "b"], "d", { shiftKey: true });
  assert.deepEqual(store.getState().selection.ids, ["d", "c", "b"]);
  actions.select(library, ["d", "c"], "c", { shiftKey: true });
  assert.deepEqual(store.getState().selection, { panel: library, ids: ["c"], anchorId: "c" });
});

void test("context opening atomically preserves the selected group with an independent target snapshot", () => {
  const store = createWorkspaceStore();
  const { actions } = store.getState();
  actions.select(library, rows, "b");
  actions.select(library, rows, "d", { shiftKey: true });
  const transitions: WorkspaceState[] = [];
  const stop = store.subscribe((state) => {
    transitions.push(state);
  });
  assert.equal(actions.openContext(library, rows, "c", point), true);
  stop();
  assert.equal(transitions.length, 1);
  const state = store.getState();
  assert.equal(state.focusedModId, "c");
  assert.deepEqual(state.contextMenu, { ...point, panel: library, modIds: ["b", "c", "d"] });
  assert.notEqual(state.contextMenu.modIds, state.selection.ids);
  actions.openContext(workshop, rows, "a", point);
  assert.equal(store.getState().focusedModId, "a");
  assert.deepEqual(store.getState().selection.ids, ["a"]);
  assert.deepEqual(store.getState().contextMenu?.modIds, ["a"]);
});

void test("stale hidden row actions cannot change selection or open a menu", () => {
  const store = createWorkspaceStore();
  const { actions } = store.getState();
  actions.select(library, rows, "b");
  const before = store.getState();
  assert.equal(actions.select(workshop, ["a"], "b"), false);
  assert.equal(actions.openContext(library, ["a"], "b", point), false);
  assert.equal(store.getState(), before);
});

void test("reconciliation drops hidden selection and invalid menu together and is idempotent", () => {
  const store = createWorkspaceStore();
  const { actions } = store.getState();
  actions.select(library, rows, "b");
  actions.select(library, rows, "d", { shiftKey: true });
  actions.openContext(library, rows, "c", point);
  const before = store.getState();
  const transitions: WorkspaceState[] = [];
  const stop = store.subscribe((state) => {
    transitions.push(state);
  });
  const visible = { unsubscribed: ["d", "c"], subscribed: rows };
  actions.reconcile(visible);
  actions.reconcile(visible);
  stop();
  assert.equal(transitions.length, 1);
  assert.deepEqual(store.getState().selection, {
    panel: library,
    ids: ["d", "c"],
    anchorId: undefined,
  });
  assert.equal(store.getState().contextMenu, undefined);
  assert.deepEqual(before.selection.ids, ["b", "c", "d"]);
  assert.deepEqual(before.contextMenu?.modIds, ["b", "c", "d"]);
  actions.reconcile({ unsubscribed: [], subscribed: rows });
  assert.deepEqual(store.getState().selection, { ids: [] });
});

void test("panel changes and new clicks close stale context menus without discarding selected mods", () => {
  const store = createWorkspaceStore();
  const { actions } = store.getState();
  actions.openContext(library, rows, "a", point);
  const menu = store.getState().contextMenu;
  actions.setSearch(workshop, "Other panel");
  assert.equal(store.getState().contextMenu, menu);
  actions.setSearchScope(library, searchScopes.tags);
  assert.equal(store.getState().contextMenu, undefined);
  assert.deepEqual(store.getState().selection.ids, ["a"]);
  actions.openContext(library, rows, "a", point);
  actions.closeContext();
  assert.deepEqual(store.getState().selection.ids, ["a"]);
  actions.openContext(library, rows, "a", point);
  actions.select(library, rows, "c");
  assert.equal(store.getState().contextMenu, undefined);
});

void test("reordering visible rows retains valid context targets while reconciling selected order", () => {
  const store = createWorkspaceStore();
  const { actions } = store.getState();
  actions.select(library, rows, "a");
  actions.select(library, rows, "d", { shiftKey: true });
  actions.openContext(library, rows, "b", point);
  const menu = store.getState().contextMenu;
  actions.reconcile({ unsubscribed: [...rows].reverse(), subscribed: [] });
  assert.equal(store.getState().contextMenu, menu);
  assert.deepEqual(store.getState().selection.ids, [...rows].reverse());
});

void test("React workspace bindings require a provider and create a fresh scoped store per mount", () => {
  const states: WorkspaceState[] = [];
  function Probe() {
    const selection = useWorkspaceStore((state) => state.selection);
    const actions = useWorkspaceStore((state) => state.actions);
    const views = useWorkspaceStore((state) => state.views);
    states.push({ selection, actions, views });
    return <span>{views.subscribed.sort}</span>;
  }
  assert.throws(() => renderToStaticMarkup(<Probe />), /require WorkspaceStoreProvider/);
  assert.equal(
    renderToStaticMarkup(
      <WorkspaceStoreProvider>
        <Probe />
      </WorkspaceStoreProvider>,
    ),
    "<span>active</span>",
  );
  assert.equal(
    renderToStaticMarkup(
      <WorkspaceStoreProvider>
        <Probe />
      </WorkspaceStoreProvider>,
    ),
    "<span>active</span>",
  );
  assert.equal(states.length, 2);
  assert.notEqual(states[0]?.selection, states[1]?.selection);
  assert.notEqual(states[0]?.actions, states[1]?.actions);
});
