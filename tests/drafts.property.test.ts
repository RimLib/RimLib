import assert from "node:assert/strict";
import { test } from "node:test";

import fc from "fast-check";

import { applyDraftChanges } from "../src/renderer/src/services/draftActions";
import { createDraftStore } from "../src/renderer/src/stores/draftStore";
import { deriveActiveOrderMoves } from "../src/renderer/src/utils/activeOrder";
import {
  activeOrderDraftKinds,
  type DraftAction,
  draftActions,
  projectDraftPanels,
} from "../src/renderer/src/utils/drafts";
import { draftHarness, draftMod } from "./helpers/drafts";
import { propertyOptions, sequenceLimit } from "./helpers/properties";

const statesArbitrary = fc.array(fc.boolean(), { minLength: 1, maxLength: 12 });
const activityStatesArbitrary = fc.array(
  fc.record({ subscribed: fc.boolean(), active: fc.boolean() }),
  { minLength: 1, maxLength: 12 },
);
const actionArbitrary = fc.record({
  action: fc.constantFrom(...Object.values(draftActions)),
  targets: fc.array(fc.nat({ max: 20 }), { maxLength: 6 }),
});
const orderOperationArbitrary = fc.constantFrom("manual" as const, "auto" as const);

function draftCategory(action: DraftAction) {
  if (action === draftActions.subscribe || action === draftActions.unsubscribe) {
    return "subscription";
  }
  if (action === draftActions.activate || action === draftActions.deactivate) {
    return "activity";
  }
  return "removal";
}

void test("property: draft action sequences match an orthogonal last-intent model without mutating records", () => {
  fc.assert(
    fc.property(
      activityStatesArbitrary,
      fc.array(actionArbitrary, { maxLength: sequenceLimit }),
      (states, operations) => {
        const mods = states.map(({ subscribed }, index) => draftMod(String(index + 1), subscribed));
        const original = JSON.stringify(mods);
        const policy = {
          savedIds: new Set(mods.map((mod) => mod.id)),
          activeIds: new Set(mods.filter((_, index) => states[index]?.active).map((mod) => mod.id)),
        };
        const store = createDraftStore();
        const model: { id: string; action: DraftAction }[] = [];
        for (const { action, targets } of operations) {
          const selected = mods.filter((_, index) =>
            targets.some((target) => target % mods.length === index),
          );
          const before = store.getState();
          const hasPending = (id: string, pendingAction: DraftAction) =>
            model.some((change) => change.id === id && change.action === pendingAction);
          const invalid = selected.some((mod) => {
            const pendingActivation = hasPending(mod.id, draftActions.activate);
            const pendingDeactivation = hasPending(mod.id, draftActions.deactivate);
            const pendingUnsubscribe = hasPending(mod.id, draftActions.unsubscribe);
            const pendingRemoval = hasPending(mod.id, draftActions.remove);
            if (action === draftActions.activate && (pendingUnsubscribe || pendingRemoval)) {
              return true;
            }
            if (
              (action === draftActions.unsubscribe || action === draftActions.remove) &&
              pendingActivation
            ) {
              return true;
            }
            if (
              action === draftActions.unsubscribe &&
              mod.subscribed &&
              policy.activeIds.has(mod.id) &&
              !pendingDeactivation
            ) {
              return true;
            }
            return (
              action === draftActions.remove &&
              ((mod.subscribed && !pendingUnsubscribe) ||
                (policy.activeIds.has(mod.id) && !pendingDeactivation))
            );
          });
          if (invalid) {
            assert.throws(() => {
              before.actions.stage(selected, action, policy);
            });
            assert.equal(store.getState(), before);
          } else {
            for (const mod of selected) {
              const category = draftCategory(action);
              const existingIndex = model.findIndex(
                (change) => change.id === mod.id && draftCategory(change.action) === category,
              );
              const restoring =
                category === "subscription"
                  ? mod.subscribed === (action === draftActions.subscribe)
                  : category === "activity"
                    ? policy.activeIds.has(mod.id) === (action === draftActions.activate)
                    : false;
              if (restoring) {
                if (existingIndex >= 0) {
                  model.splice(existingIndex, 1);
                }
              } else if (existingIndex < 0 || model[existingIndex]?.action !== action) {
                if (existingIndex >= 0) {
                  model.splice(existingIndex, 1);
                }
                model.push({ id: mod.id, action });
              }
            }
            before.actions.stage(selected, action, policy);
          }
          assert.deepEqual(
            store.getState().changes.map((change) => [change.mod.id, change.action]),
            model.map((change) => [change.id, change.action]),
          );
          assert.equal(
            new Set(
              store
                .getState()
                .changes.map((change) => `${change.mod.id}:${draftCategory(change.action)}`),
            ).size,
            store.getState().changes.length,
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

void test("property: auto-sort replaces load-order history while manual moves append", () => {
  fc.assert(
    fc.property(
      fc.array(orderOperationArbitrary, { minLength: 1, maxLength: sequenceLimit }),
      (operations) => {
        const store = createDraftStore();
        const base = ["author.one", "author.two", "author.three"];
        const expectedKinds: (typeof operations)[number][] = [];
        let expectedOrder = [...base];

        operations.forEach((operation, index) => {
          if (operation === "auto") {
            const packageIds =
              index % 2 === 0
                ? ["author.two", "author.three", "author.one"]
                : ["author.three", "author.one", "author.two"];
            const source = base.map((id) => ({ id }));
            const target = packageIds.map((id) => ({ id }));
            const moves = deriveActiveOrderMoves(source, target);
            assert.ok(moves);
            expectedKinds.splice(0, expectedKinds.length, ...moves.map(() => operation));
            store.getState().actions.replaceActiveOrder(
              packageIds,
              base,
              "automatic",
              moves.map(({ id, fromPosition, toPosition }) => ({
                kind: activeOrderDraftKinds.autoSort,
                packageId: id,
                modId: id,
                modName: id,
                fromPosition,
                toPosition,
              })),
            );
            expectedOrder = [...packageIds];
          } else {
            const packageId = expectedOrder[0];
            assert.ok(packageId);
            const packageIds = [...expectedOrder.slice(1), packageId];
            expectedKinds.push(operation);
            store.getState().actions.setActiveOrder(packageIds, base, "automatic", {
              kind: activeOrderDraftKinds.manual,
              method: index % 2 === 0 ? "drag" : "position",
              packageId,
              modId: `steam-${index}`,
              modName: `Mod ${index}`,
              fromPosition: 1,
              toPosition: 3,
            });
            expectedOrder = packageIds;
          }

          assert.deepEqual(
            store
              .getState()
              .activeOrderOperations.map((entry) =>
                entry.kind === activeOrderDraftKinds.autoSort ? "auto" : "manual",
              ),
            expectedKinds,
          );
          assert.equal(
            new Set(store.getState().activeOrderOperations.map((entry) => entry.id)).size,
            store.getState().activeOrderOperations.length,
          );
          assert.deepEqual(store.getState().activeOrder, expectedOrder);
        });
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
        ...mods.filter((mod) => !mod.subscribed),
        ...mods.filter((mod) => mod.subscribed),
      ];
      const stopAt = failureIndex % (mods.length + 1);
      const failure = ordered[stopAt];
      if (failure) {
        harness.failures.add(failure.id);
      }
      const callbacks = {
        ...harness.callbacks,
        complete: (id: string, action: DraftAction) => {
          harness.callbacks.complete(id, action);
          store.getState().actions.complete(id, action);
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
