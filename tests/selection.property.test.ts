import assert from "node:assert/strict";
import { test } from "node:test";

import fc from "fast-check";

import {
  contextModSelection,
  emptyModSelection,
  type ModSelection,
  modTagTargets,
  reconcileModSelection,
  selectModRow,
} from "../src/renderer/src/utils/modSelection";
import { modPanelModes } from "../src/renderer/src/utils/uiConstants";
import { requireValue } from "../src/shared/validation";
import { assertUnchanged, propertyOptions, sequenceLimit } from "./helpers/properties";

const rowIdsArbitrary = fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 30 });
const indexArbitrary = fc.nat({ max: 100 });

void test("property: shift selection contains exactly the visible range in display order", () => {
  fc.assert(
    fc.property(rowIdsArbitrary, indexArbitrary, indexArbitrary, (ids, first, last) => {
      const start = first % ids.length;
      const end = last % ids.length;
      const initial = selectModRow(
        emptyModSelection,
        modPanelModes.subscribed,
        ids,
        requireValue(ids[start]),
      );
      const selected = selectModRow(
        initial,
        modPanelModes.subscribed,
        ids,
        requireValue(ids[end]),
        { shiftKey: true },
      );
      assert.deepEqual(selected.ids, ids.slice(Math.min(start, end), Math.max(start, end) + 1));
      assert.equal(selected.anchorId, ids[start]);
      assert.deepEqual(modTagTargets(selected, requireValue(ids[end])), selected.ids);
    }),
    propertyOptions,
  );
});

void test("property: control and command click toggles follow a set model without duplicate selection", () => {
  fc.assert(
    fc.property(
      rowIdsArbitrary,
      fc.array(fc.tuple(indexArbitrary, fc.boolean()), { maxLength: sequenceLimit }),
      (ids, operations) => {
        const model = new Set<string>();
        let selection: ModSelection = emptyModSelection;
        for (const [index, useMeta] of operations) {
          const id = requireValue(ids[index % ids.length]);
          if (model.has(id)) {
            model.delete(id);
          } else {
            model.add(id);
          }
          selection = selectModRow(
            selection,
            modPanelModes.unsubscribed,
            ids,
            id,
            useMeta ? { metaKey: true } : { ctrlKey: true },
          );
          assert.deepEqual(
            selection.ids,
            ids.filter((entry) => model.has(entry)),
          );
        }
      },
    ),
    propertyOptions,
  );
});

void test("property: reconciliation drops hidden rows, follows new ordering and is idempotent", () => {
  fc.assert(
    fc.property(rowIdsArbitrary, indexArbitrary, fc.nat(), (ids, anchor, mask) => {
      const selection = {
        panel: modPanelModes.subscribed,
        ids,
        anchorId: requireValue(ids[anchor % ids.length]),
      };
      const visible = ids.filter((_, index) => ((mask >>> index) & 1) !== 0).reverse();
      assertUnchanged(selection, () => {
        const reconciled = reconcileModSelection(selection, visible);
        assert.deepEqual(reconciled.ids, visible);
        assert.deepEqual(reconcileModSelection(reconciled, visible), reconciled);
        assert.equal(
          reconciled.anchorId,
          visible.includes(selection.anchorId) ? selection.anchorId : undefined,
        );
      });
    }),
    propertyOptions,
  );
});

void test("property: context clicks retain a selected group and isolate unselected or cross-panel targets", () => {
  fc.assert(
    fc.property(rowIdsArbitrary, indexArbitrary, (ids, index) => {
      const id = requireValue(ids[index % ids.length]);
      const selected = { panel: modPanelModes.subscribed, ids, anchorId: id };
      assert.deepEqual(contextModSelection(selected, modPanelModes.subscribed, ids, id), selected);
      assert.deepEqual(
        contextModSelection({ ...selected, ids: [] }, modPanelModes.subscribed, ids, id).ids,
        [id],
      );
      assert.deepEqual(contextModSelection(selected, modPanelModes.unsubscribed, ids, id).ids, [
        id,
      ]);
      assert.deepEqual(modTagTargets(selected, "outside-selection"), ["outside-selection"]);
    }),
    propertyOptions,
  );
});
