import assert from "node:assert/strict";
import { test } from "node:test";

import fc from "fast-check";

import { createWorkspaceStore } from "../src/renderer/src/stores/workspaceStore";
import {
  type ModPanelMode,
  modPanelModes,
  type ModSort,
  modSorts,
  type SearchScope,
  searchScopes,
} from "../src/renderer/src/utils/uiConstants";
import { requireValue } from "../src/shared/validation";
import { propertyOptions, sequenceLimit, textArbitrary } from "./helpers/properties";

const panelArbitrary = fc.constantFrom(...Object.values(modPanelModes));
const viewActions = Object.freeze({
  search: "search",
  sort: "sort",
  scope: "scope",
} as const);
const viewActionArbitrary = fc.oneof(
  fc.record({ type: fc.constant(viewActions.search), panel: panelArbitrary, value: textArbitrary }),
  fc.record({
    type: fc.constant(viewActions.sort),
    panel: panelArbitrary,
    value: fc.constantFrom(...Object.values(modSorts)),
  }),
  fc.record({
    type: fc.constant(viewActions.scope),
    panel: panelArbitrary,
    value: fc.constantFrom(...Object.values(searchScopes)),
  }),
);

void test("property: workspace view action sequences match an independent per-panel model", () => {
  fc.assert(
    fc.property(fc.array(viewActionArbitrary, { maxLength: sequenceLimit }), (operations) => {
      const store = createWorkspaceStore();
      const isolated = createWorkspaceStore();
      const initialIsolated = isolated.getState();
      const { actions } = store.getState();
      const model: Record<
        ModPanelMode,
        { search: string; searchScope: SearchScope; sort: ModSort }
      > = {
        unsubscribed: {
          search: "",
          searchScope: searchScopes.all,
          sort: modSorts.newest,
        },
        subscribed: {
          search: "",
          searchScope: searchScopes.all,
          sort: modSorts.active,
        },
      };
      for (const operation of operations) {
        switch (operation.type) {
          case viewActions.search:
            model[operation.panel].search = operation.value;
            actions.setSearch(operation.panel, operation.value);
            break;
          case viewActions.sort:
            model[operation.panel].sort = operation.value;
            actions.setSort(operation.panel, operation.value);
            break;
          case viewActions.scope:
            model[operation.panel].searchScope = operation.value;
            actions.setSearchScope(operation.panel, operation.value);
            break;
        }
        assert.deepEqual(store.getState().views, model);
        assert.equal(isolated.getState(), initialIsolated);
        assert.deepEqual(store.getState().selection.ids, []);
        assert.equal(store.getState().actions, actions);
      }
    }),
    propertyOptions,
  );
});

void test("property: consecutive Zustand selection and context actions preserve ranges and panel boundaries", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 30 }),
      fc.nat(),
      fc.nat(),
      panelArbitrary,
      (ids, first, last, panel) => {
        const store = createWorkspaceStore();
        const { actions } = store.getState();
        const start = first % ids.length;
        const end = last % ids.length;
        const target = requireValue(ids[end]);
        actions.select(panel, ids, requireValue(ids[start]));
        actions.select(panel, ids, target, { shiftKey: true });
        const expected = ids.slice(Math.min(start, end), Math.max(start, end) + 1);
        assert.deepEqual(store.getState().selection.ids, expected);
        actions.openContext(panel, ids, target, { x: 0, y: 0 });
        assert.deepEqual(store.getState().contextMenu?.modIds, expected);
        const other =
          panel === modPanelModes.subscribed
            ? modPanelModes.unsubscribed
            : modPanelModes.subscribed;
        actions.select(other, ids, target, { shiftKey: true });
        assert.deepEqual(store.getState().selection.ids, [target]);
        assert.equal(store.getState().selection.panel, other);
        assert.equal(store.getState().contextMenu, undefined);
      },
    ),
    propertyOptions,
  );
});

void test("property: workspace reconciliation never leaves hidden selection or stale menu targets", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 30 }),
      fc.nat(),
      fc.nat(),
      panelArbitrary,
      (ids, anchorIndex, mask, panel) => {
        const store = createWorkspaceStore();
        const { actions } = store.getState();
        const anchor = requireValue(ids[anchorIndex % ids.length]);
        actions.select(panel, ids, requireValue(ids[0]));
        actions.select(panel, ids, requireValue(ids.at(-1)), { shiftKey: true });
        actions.openContext(panel, ids, anchor, { x: 0, y: 0 });
        const before = store.getState();
        const visible = ids.filter((_, index) => ((mask >>> index) & 1) !== 0).reverse();
        actions.reconcile({
          unsubscribed: panel === modPanelModes.unsubscribed ? visible : [],
          subscribed: panel === modPanelModes.subscribed ? visible : [],
        });
        const after = store.getState();
        assert.deepEqual(after.selection.ids, visible);
        assert.equal(
          after.selection.anchorId,
          visible.includes(requireValue(ids[0])) ? ids[0] : undefined,
        );
        assert.equal(after.contextMenu !== undefined, visible.length === ids.length);
        assert.deepEqual(before.selection.ids, ids);
        assert.deepEqual(before.contextMenu?.modIds, ids);
        actions.reconcile({
          unsubscribed: panel === modPanelModes.unsubscribed ? visible : [],
          subscribed: panel === modPanelModes.subscribed ? visible : [],
        });
        assert.equal(store.getState(), after);
      },
    ),
    propertyOptions,
  );
});
