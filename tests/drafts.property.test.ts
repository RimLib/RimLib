import assert from "node:assert/strict";
import { test } from "node:test";

import fc from "fast-check";

import { applyDraftChanges } from "../src/renderer/src/services/draftActions";
import { createDraftStore } from "../src/renderer/src/stores/draftStore";
import {
  type DraftAction,
  draftActions,
  projectDraftPanels,
} from "../src/renderer/src/utils/drafts";
import { draftHarness, draftMod } from "./helpers/drafts";
import { propertyOptions, sequenceLimit } from "./helpers/properties";

const statesArbitrary = fc.array(fc.boolean(), { minLength: 1, maxLength: 12 });
const actionArbitrary = fc.record({
  action: fc.constantFrom(...Object.values(draftActions)),
  targets: fc.array(fc.nat({ max: 20 }), { maxLength: 6 }),
});

void test("property: draft action sequences match a last-intent model without mutating library records", () => {
  fc.assert(
    fc.property(
      statesArbitrary,
      fc.array(actionArbitrary, { maxLength: sequenceLimit }),
      (states, operations) => {
        const mods = states.map((subscribed, index) => draftMod(String(index + 1), subscribed));
        const original = JSON.stringify(mods);
        const policy = {
          savedIds: new Set(mods.map((mod) => mod.id)),
          activeIds: new Set<string>(),
        };
        const store = createDraftStore();
        const model = new Map<string, DraftAction>();
        for (const { action, targets } of operations) {
          const selected = mods.filter((_, index) =>
            targets.some((target) => target % mods.length === index),
          );
          const before = store.getState();
          if (action === draftActions.remove && selected.some((mod) => mod.subscribed)) {
            assert.throws(() => {
              before.actions.stage(selected, action, policy);
            }, /subscribed/);
            assert.equal(store.getState(), before);
          } else {
            for (const mod of selected) {
              if (
                (action === draftActions.subscribe && mod.subscribed) ||
                (action === draftActions.unsubscribe && !mod.subscribed)
              ) {
                model.delete(mod.id);
              } else {
                model.set(mod.id, action);
              }
            }
            before.actions.stage(selected, action, policy);
          }
          assert.deepEqual(
            store.getState().changes.map((change) => [change.mod.id, change.action]),
            [...model],
          );
          assert.equal(JSON.stringify(mods), original);
        }
        assert.deepEqual(createDraftStore().getState().changes, []);
      },
    ),
    propertyOptions,
  );
});

void test("property: projected draft panels partition all saved mods while pending removals remain visible", () => {
  fc.assert(
    fc.property(
      statesArbitrary,
      fc.array(fc.nat({ max: 2 }), { maxLength: 12 }),
      (states, intentions) => {
        const mods = states.map((subscribed, index) => draftMod(String(index + 1), subscribed));
        const store = createDraftStore();
        const policy = {
          savedIds: new Set(mods.map((mod) => mod.id)),
          activeIds: new Set<string>(),
        };
        for (const [index, mod] of mods.entries()) {
          const action =
            intentions[index] === 0
              ? draftActions.subscribe
              : intentions[index] === 1
                ? draftActions.unsubscribe
                : draftActions.remove;
          if (action !== draftActions.remove || !mod.subscribed) {
            store.getState().actions.stage([mod], action, policy);
          }
        }
        const changes = store.getState().changes;
        const projected = projectDraftPanels(
          mods.filter((mod) => !mod.subscribed),
          mods.filter((mod) => mod.subscribed),
          changes,
        );
        assert.equal(projected.unsubscribed.length + projected.subscribed.length, mods.length);
        assert.equal(
          new Set([...projected.unsubscribed, ...projected.subscribed].map((mod) => mod.id)).size,
          mods.length,
        );
        for (const mod of mods) {
          const action = changes.find((change) => change.mod.id === mod.id)?.action;
          const subscribed =
            action === draftActions.subscribe ||
            (mod.subscribed && action !== draftActions.unsubscribe);
          assert.equal(
            projected.subscribed.some((entry) => entry.id === mod.id),
            subscribed,
          );
          if (action === draftActions.remove) {
            assert.ok(projected.unsubscribed.some((entry) => entry.id === mod.id));
          }
        }
      },
    ),
    propertyOptions,
  );
});

void test("property: draft execution resolves only the confirmed prefix and retains failed and unexecuted changes", async () => {
  await fc.assert(
    fc.asyncProperty(statesArbitrary, fc.nat(), async (states, failureIndex) => {
      const mods = states.map((subscribed, index) => draftMod(String(index + 1), subscribed));
      const harness = draftHarness(mods);
      const store = createDraftStore();
      const policy = { savedIds: new Set(mods.map((mod) => mod.id)), activeIds: new Set<string>() };
      for (const mod of mods) {
        store
          .getState()
          .actions.stage(
            [mod],
            mod.subscribed ? draftActions.unsubscribe : draftActions.subscribe,
            policy,
          );
      }
      const changes = store.getState().actions.beginApply();
      assert.ok(changes);
      const ordered = [
        ...mods.filter((mod) => mod.subscribed),
        ...mods.filter((mod) => !mod.subscribed),
      ];
      const stopAt = failureIndex % (mods.length + 1);
      const failure = ordered[stopAt];
      if (failure) {
        harness.failures.add(failure.id);
      }
      const callbacks = {
        ...harness.callbacks,
        complete: (id: string) => {
          harness.callbacks.complete(id);
          store.getState().actions.complete(id);
        },
      };
      const executing = applyDraftChanges(changes, harness.store, callbacks);
      if (failure) {
        await assert.rejects(executing, /Steam failure/);
      } else {
        await executing;
      }
      store.getState().actions.endApply();
      const completed = ordered.slice(0, stopAt).map((mod) => mod.id);
      assert.deepEqual(harness.completed, completed);
      assert.deepEqual(
        new Set(store.getState().changes.map((change) => change.mod.id)),
        new Set(ordered.slice(stopAt).map((mod) => mod.id)),
      );
      assert.equal(harness.vault().mods.length, mods.length);
      for (const progress of harness.progress) {
        assert.ok(progress.completed >= 0 && progress.completed <= progress.total);
      }
    }),
    propertyOptions,
  );
});
