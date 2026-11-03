import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { DraftBadge } from "../src/renderer/src/components/common/DraftBadge";
import { DraftBar } from "../src/renderer/src/components/common/DraftBar";
import { ModRowView as ModRow } from "../src/renderer/src/components/common/ModRow";
import { DraftChangesModal } from "../src/renderer/src/components/modals/DraftChangesModal";
import { applyDraftChanges } from "../src/renderer/src/services/draftActions";
import { createDraftStore } from "../src/renderer/src/stores/draftStore";
import {
  activeOrderDraftKinds,
  type ActiveOrderDraftOperation,
  type ActiveOrderDraftOperationInput,
  deriveDraftActivityDelta,
  draftActions,
  draftActiveOrderTemplate,
  draftOperationCount,
  draftStatuses,
  draftSteps,
  normalizeActiveConfigTarget,
  projectDraftPanels,
  rebaseActivityDraftChanges,
  remainingDraftOperationCount,
} from "../src/renderer/src/utils/drafts";
import { subscriptionActions, subscriptionCommands } from "../src/shared/domainConstants";
import { ipcChannels, validateIpcArgs } from "../src/shared/ipc";
import { requireValue } from "../src/shared/validation";
import { draftHarness, draftMod } from "./helpers/drafts";

const noop = () => undefined;
const mods = [draftMod("1", true), draftMod("2"), draftMod("3")];
const defaultConfigTarget = normalizeActiveConfigTarget();
const policy = {
  savedIds: new Set(mods.map((mod) => mod.id)),
  activeIds: new Set<string>(),
  activeConfigTarget: defaultConfigTarget,
};
const orderPackageIds: Readonly<Record<string, string>> = {
  "steam-1": "brrainz.harmony",
  "steam-harmony": "brrainz.harmony",
  "steam-one": "author.one",
  "steam-two": "author.two",
  "steam-three": "author.three",
  "steam-second": "author.second",
};

function draftCore() {
  return {
    ...draftMod("official-core", false),
    id: "active-package:ludeon.rimworld",
    workshopId: undefined,
    packageId: "ludeon.rimworld",
    name: "RimWorld",
    source: "local" as const,
  };
}

function manualOrderOperation(
  modId: string,
  modName: string,
  fromPosition: number,
  toPosition: number,
  method: "drag" | "position" = "drag",
): ActiveOrderDraftOperationInput {
  return {
    kind: activeOrderDraftKinds.manual,
    method,
    packageId: requireValue(orderPackageIds[modId]),
    modId,
    modName,
    fromPosition,
    toPosition,
  };
}

function autoSortOrderOperation(
  packageId: string,
  modName: string,
  fromPosition: number,
  toPosition: number,
): ActiveOrderDraftOperationInput {
  return {
    kind: activeOrderDraftKinds.autoSort,
    packageId,
    modId: `auto-${packageId}`,
    modName,
    fromPosition,
    toPosition,
  };
}

function importedOrderOperation(
  packageId: string,
  modId: string,
  modName: string,
  fromPosition: number,
  toPosition: number,
  fileName = "imported.xml",
): ActiveOrderDraftOperationInput {
  return {
    kind: activeOrderDraftKinds.import,
    fileName,
    packageId,
    modId,
    modName,
    fromPosition,
    toPosition,
  };
}

function savedOrderOperation(
  id: string,
  operation: ActiveOrderDraftOperationInput,
): ActiveOrderDraftOperation {
  return { ...operation, id };
}

void test("draft activity delta counts compound membership intents once and ignores unrelated actions", () => {
  const incoming = requireValue(mods[1]);
  const outgoing = requireValue(mods[0]);
  const removedInactive = requireValue(mods[2]);
  const delta = deriveDraftActivityDelta([
    { mod: incoming, action: draftActions.subscribe },
    { mod: incoming, action: draftActions.activate },
    { mod: outgoing, action: draftActions.deactivate },
    { mod: outgoing, action: draftActions.unsubscribe },
    { mod: outgoing, action: draftActions.remove },
    { mod: removedInactive, action: draftActions.remove },
  ]);

  assert.deepEqual([...delta.activatedIds], [incoming.id]);
  assert.deepEqual([...delta.deactivatedIds], [outgoing.id]);
  assert.equal(delta.activatedIds.size, 1);
  assert.equal(delta.deactivatedIds.size, 1);
});

void test("draft activity delta is unique, mutually exclusive and follows the last activity intent", () => {
  const target = requireValue(mods[1]);
  const other = requireValue(mods[2]);
  const delta = deriveDraftActivityDelta([
    { mod: target, action: draftActions.activate },
    { mod: target, action: draftActions.activate },
    { mod: other, action: draftActions.deactivate },
    { mod: target, action: draftActions.deactivate },
    { mod: other, action: draftActions.activate },
  ]);

  assert.deepEqual([...delta.activatedIds], [other.id]);
  assert.deepEqual([...delta.deactivatedIds], [target.id]);
  assert.equal(
    [...delta.activatedIds].some((id) => delta.deactivatedIds.has(id)),
    false,
  );
});

void test("draft activity delta is empty for empty and order-unrelated draft snapshots", () => {
  const orderOnly = createDraftStore();
  orderOnly
    .getState()
    .actions.setActiveOrder(
      ["author.two", "author.one"],
      ["author.one", "author.two"],
      defaultConfigTarget,
      manualOrderOperation("steam-one", "One", 1, 2),
    );
  const unrelated = deriveDraftActivityDelta([
    { mod: requireValue(mods[0]), action: draftActions.unsubscribe },
    { mod: requireValue(mods[1]), action: draftActions.subscribe },
    { mod: requireValue(mods[2]), action: draftActions.remove },
  ]);

  assert.equal(deriveDraftActivityDelta([]).activatedIds.size, 0);
  assert.equal(deriveDraftActivityDelta([]).deactivatedIds.size, 0);
  assert.equal(orderOnly.getState().activeOrderOperations.length, 1);
  assert.equal(deriveDraftActivityDelta(orderOnly.getState().changes).activatedIds.size, 0);
  assert.equal(deriveDraftActivityDelta(orderOnly.getState().changes).deactivatedIds.size, 0);
  assert.equal(unrelated.activatedIds.size, 0);
  assert.equal(unrelated.deactivatedIds.size, 0);
});

void test("draft activity delta follows activity undo and safe identity rebasing", () => {
  const incoming = requireValue(mods[1]);
  const store = createDraftStore();
  store.getState().actions.stage([incoming], draftActions.activate, policy);
  assert.deepEqual(
    [...deriveDraftActivityDelta(store.getState().changes).activatedIds],
    [incoming.id],
  );

  store.getState().actions.undoAction(incoming.id, draftActions.activate);
  assert.equal(deriveDraftActivityDelta(store.getState().changes).activatedIds.size, 0);

  const placeholder = {
    ...draftMod("delta-placeholder"),
    id: "active-package:author.delta",
    packageId: "Author.Delta_steam",
  };
  const installed = {
    ...placeholder,
    id: "local:author.delta",
    packageId: "author.delta",
  };
  const rebased = rebaseActivityDraftChanges(
    [{ mod: placeholder, action: draftActions.deactivate }],
    [installed],
  );
  const rebasedDelta = deriveDraftActivityDelta(rebased);
  assert.equal(rebasedDelta.deactivatedIds.size, 1);
  assert.equal(rebasedDelta.deactivatedIds.has(placeholder.id), false);
  assert.equal(rebasedDelta.deactivatedIds.has(installed.id), true);
});

void test("active order templates retain deactivations and append activations chronologically", () => {
  const base = ["ludeon.rimworld", "author.one"];
  const first = { ...draftMod("template-first"), packageId: "author.first" };
  const second = { ...draftMod("template-second"), packageId: "author.second" };
  const active = { ...draftMod("template-active"), packageId: "author.one" };

  assert.deepEqual(
    draftActiveOrderTemplate(base, [
      { mod: first, action: draftActions.activate },
      { mod: active, action: draftActions.deactivate },
      { mod: second, action: draftActions.activate },
    ]),
    ["ludeon.rimworld", "author.one", "author.first", "author.second"],
  );
});

void test("draft categories retain independent intents, deduplicate selections and cancel opposite subscription intents", () => {
  const store = createDraftStore();
  const { actions } = store.getState();
  actions.stage([requireValue(mods[1]), requireValue(mods[1])], draftActions.subscribe, policy);
  actions.stage([requireValue(mods[0])], draftActions.unsubscribe, policy);
  actions.stage([requireValue(mods[2])], draftActions.remove, policy);
  assert.equal(store.getState().changes.length, 3);
  actions.stage([requireValue(mods[1])], draftActions.unsubscribe, policy);
  assert.deepEqual(
    store.getState().changes.map((change) => change.mod.id),
    ["steam-1", "steam-3"],
  );
  actions.stage([requireValue(mods[0])], draftActions.subscribe, policy);
  assert.deepEqual(
    store.getState().changes.map((change) => change.action),
    [draftActions.remove],
  );
  actions.stage([requireValue(mods[2])], draftActions.subscribe, policy);
  assert.deepEqual(
    store.getState().changes.map((change) => change.action),
    [draftActions.remove, draftActions.subscribe],
  );
});

void test("activity drafts compose with compatible subscription changes and reject unsafe activation conflicts", () => {
  const activePolicy = {
    ...policy,
    activeIds: new Set(["steam-1"]),
    activePackageIds: ["ludeon.rimworld", "author.mod1"],
  };
  const compound = createDraftStore();
  compound.getState().actions.stage([requireValue(mods[0])], draftActions.deactivate, activePolicy);
  compound
    .getState()
    .actions.stage([requireValue(mods[0])], draftActions.unsubscribe, activePolicy);
  compound.getState().actions.stage([requireValue(mods[0])], draftActions.remove, activePolicy);
  assert.deepEqual(
    compound.getState().changes.map((change) => change.action),
    [draftActions.deactivate, draftActions.unsubscribe, draftActions.remove],
  );
  const compoundBefore = compound.getState();
  assert.throws(() => {
    compound.getState().actions.stage([requireValue(mods[0])], draftActions.activate, activePolicy);
  }, /pending unsubscribe or removal/);
  assert.equal(compound.getState(), compoundBefore);

  const activating = createDraftStore();
  activating.getState().actions.stage([requireValue(mods[1])], draftActions.subscribe, policy);
  activating.getState().actions.stage([requireValue(mods[1])], draftActions.activate, policy);
  assert.deepEqual(
    activating.getState().changes.map((change) => change.action),
    [draftActions.subscribe, draftActions.activate],
  );
  for (const action of [draftActions.unsubscribe, draftActions.remove]) {
    const before = activating.getState();
    assert.throws(() => {
      activating.getState().actions.stage([requireValue(mods[1])], action, policy);
    }, /pending activation/);
    assert.equal(activating.getState(), before);
  }
});

void test("compound activation subscribes Workshop targets first and remains atomic", () => {
  const target = requireValue(mods[1]);
  const store = createDraftStore();

  store.getState().actions.stageActivation([target], policy);
  assert.deepEqual(
    store.getState().changes.map((change) => ({ id: change.mod.id, action: change.action })),
    [
      { id: target.id, action: draftActions.subscribe },
      { id: target.id, action: draftActions.activate },
    ],
  );
  assert.equal(target.subscribed, false);

  const beforeFailure = store.getState();
  const duplicate = {
    ...draftMod("997"),
    packageId: "AUTHOR.ACTIVE_steam",
  };
  assert.throws(() => {
    store.getState().actions.stageActivation([duplicate], {
      ...policy,
      savedIds: new Set([...policy.savedIds, duplicate.id]),
      activePackageIds: ["author.active"],
    });
  }, /another row already uses package ID author\.active/);
  assert.equal(store.getState(), beforeFailure);
});

void test("compound activation cancels pending unsubscribe and skips subscription validation for subscribed unsaved targets", () => {
  const subscribed = requireValue(mods[0]);
  const store = createDraftStore();
  store.getState().actions.stage([subscribed], draftActions.unsubscribe, policy);
  assert.deepEqual(
    store.getState().changes.map((change) => change.action),
    [draftActions.unsubscribe],
  );

  store.getState().actions.stageActivation([subscribed], policy);
  assert.deepEqual(
    store.getState().changes.map((change) => change.action),
    [draftActions.activate],
  );

  const subscribedUnsaved = {
    ...draftMod("998", true),
    id: "installed-workshop",
  };
  const unsavedStore = createDraftStore();
  unsavedStore.getState().actions.stageActivation([subscribedUnsaved], policy);
  assert.deepEqual(
    unsavedStore.getState().changes.map((change) => ({
      id: change.mod.id,
      action: change.action,
    })),
    [{ id: subscribedUnsaved.id, action: draftActions.activate }],
  );
});

void test("compound activation rejects an unsaved unsubscribed Workshop target without partial staging", () => {
  const valid = requireValue(mods[1]);
  const unsaved = draftMod("999");
  const store = createDraftStore();
  const before = store.getState();

  assert.throws(() => {
    store.getState().actions.stageActivation([valid, unsaved], policy);
  }, /save/);
  assert.equal(store.getState(), before);
  assert.deepEqual(store.getState().changes, []);
});

void test("an imported Active list atomically stages membership, subscriptions and deterministic order", () => {
  const core = { ...draftCore(), packageId: "Ludeon.RimWorld" };
  const outgoing = { ...draftMod("outgoing", true), packageId: "author.outgoing" };
  const retained = { ...draftMod("retained", true), packageId: "author.retained" };
  const incoming = { ...draftMod("1004"), packageId: "AUTHOR.INCOMING_steam" };
  const current = [core, outgoing, retained];
  const target = [core, incoming, retained];
  const store = createDraftStore();
  let notifications = 0;
  const stop = store.subscribe(() => {
    notifications++;
  });

  store.getState().actions.stageImportedActiveList(
    current,
    target,
    {
      savedIds: new Set([...current, incoming].map((mod) => mod.id)),
      activeIds: new Set(current.map((mod) => mod.id)),
      activePackageIds: current.map((mod) => requireValue(mod.packageId)),
      activeConfigTarget: defaultConfigTarget,
    },
    "/tmp/shared/example.xml",
  );

  assert.equal(notifications, 1, "the complete import must commit in one store update");
  assert.deepEqual(
    store.getState().changes.map(({ mod, action }) => ({ id: mod.id, action })),
    [
      { id: outgoing.id, action: draftActions.deactivate },
      { id: incoming.id, action: draftActions.subscribe },
      { id: incoming.id, action: draftActions.activate },
    ],
  );
  assert.deepEqual(store.getState().activeOrderOperations, [
    savedOrderOperation(
      "order-1",
      importedOrderOperation("author.incoming", incoming.id, incoming.name, 3, 2, "example.xml"),
    ),
  ]);
  assert.deepEqual(store.getState().activeOrder, [
    "Ludeon.RimWorld",
    "author.outgoing",
    "AUTHOR.INCOMING_steam",
    "author.retained",
  ]);
  assert.deepEqual(
    store.getState().activeBasePackageIds,
    current.map((mod) => mod.packageId),
  );
  assert.equal(store.getState().activeBaseConfigTarget, defaultConfigTarget);
  stop();
});

void test("an imported Active list rejects untrusted physical rows for official content atomically", () => {
  const oldCore = { ...draftCore(), packageId: "Ludeon.RimWorld" };
  const newCore = {
    ...draftMod("new-core", true),
    workshopId: "999",
    packageId: "LUDEON.RIMWORLD_steam",
  };
  const retained = { ...draftMod("swap-retained", true), packageId: "author.retained" };
  const current = [oldCore, retained];
  const target = [newCore, retained];
  const store = createDraftStore();

  assert.throws(() => {
    store.getState().actions.stageImportedActiveList(
      current,
      target,
      {
        savedIds: new Set([...current, newCore].map((mod) => mod.id)),
        activeIds: new Set(current.map((mod) => mod.id)),
        activePackageIds: current.map((mod) => requireValue(mod.packageId)),
        activeConfigTarget: defaultConfigTarget,
      },
      "core-swap.xml",
    );
  }, /trusted local installation/);

  assert.deepEqual(store.getState().changes, []);
  assert.deepEqual(store.getState().activeOrderOperations, []);
  assert.equal(store.getState().activeOrder, undefined);
});

void test("same-package activation remains blocked unless that package has a pending deactivation", () => {
  const active = { ...draftMod("active-shared", true), packageId: "author.shared" };
  const replacement = {
    ...draftMod("replacement-shared", true),
    packageId: "AUTHOR.SHARED_steam",
  };
  const swapPolicy = {
    savedIds: new Set([active.id, replacement.id]),
    activeIds: new Set([active.id]),
    activePackageIds: [requireValue(active.packageId)],
    activeConfigTarget: defaultConfigTarget,
  };
  const store = createDraftStore();

  assert.throws(() => {
    store.getState().actions.stageActivation([replacement], swapPolicy);
  }, /another row already uses package ID author\.shared/);

  store.getState().actions.stage([active], draftActions.deactivate, swapPolicy);
  store.getState().actions.stageActivation([replacement], swapPolicy);
  assert.deepEqual(
    store.getState().changes.map(({ mod, action }) => ({ id: mod.id, action })),
    [
      { id: active.id, action: draftActions.deactivate },
      { id: replacement.id, action: draftActions.activate },
    ],
  );
});

void test("invalid or conflicting imports preserve the exact draft state and operation sequence", () => {
  const core = draftCore();
  const retained = { ...draftMod("import-retained", true), packageId: "author.retained" };
  const incoming = { ...draftMod("2004"), packageId: "author.incoming" };
  const current = [core, retained];
  const basePolicy = {
    savedIds: new Set([core.id, retained.id]),
    activeIds: new Set(current.map((mod) => mod.id)),
    activePackageIds: current.map((mod) => requireValue(mod.packageId)),
    activeConfigTarget: defaultConfigTarget,
  };
  const store = createDraftStore();
  const initial = store.getState();
  let notifications = 0;
  const stop = store.subscribe(() => {
    notifications++;
  });

  assert.throws(() => {
    store
      .getState()
      .actions.stageImportedActiveList(current, [retained], basePolicy, "without-core.xml");
  }, /RimWorld Core exactly once/);
  assert.equal(store.getState(), initial);
  assert.equal(notifications, 0);

  assert.throws(() => {
    store
      .getState()
      .actions.stageImportedActiveList(current, [core, incoming], basePolicy, "missing.xml");
  }, /save/);
  assert.equal(store.getState(), initial);
  assert.equal(notifications, 0);

  const duplicate = { ...incoming, id: "duplicate", packageId: "AUTHOR.INCOMING_steam" };
  assert.throws(() => {
    store
      .getState()
      .actions.stageImportedActiveList(
        current,
        [core, incoming, duplicate],
        { ...basePolicy, savedIds: new Set([core.id, retained.id, incoming.id, duplicate.id]) },
        "duplicate.xml",
      );
  }, /duplicate package ID author\.incoming/);
  assert.equal(store.getState(), initial);
  assert.equal(notifications, 0);

  store
    .getState()
    .actions.stageImportedActiveList(
      current,
      [incoming, core],
      { ...basePolicy, savedIds: new Set([core.id, retained.id, incoming.id]) },
      "valid.xml",
    );
  assert.equal(store.getState().activeOrderOperations[0]?.id, "order-1");
  const staged = store.getState();
  assert.throws(() => {
    store
      .getState()
      .actions.stageImportedActiveList(current, [core, retained], basePolicy, "second.xml");
  }, /Apply or discard/);
  assert.equal(store.getState(), staged);
  stop();
});

void test("a no-op import keeps state identity while imported order undo and discard remain independent", () => {
  const core = draftCore();
  const first = { ...draftMod("noop-first", true), packageId: "author.first" };
  const second = { ...draftMod("noop-second", true), packageId: "author.second" };
  const current = [core, first, second];
  const importPolicy = {
    savedIds: new Set(current.map((mod) => mod.id)),
    activeIds: new Set(current.map((mod) => mod.id)),
    activePackageIds: current.map((mod) => requireValue(mod.packageId)),
    activeConfigTarget: defaultConfigTarget,
  };
  const store = createDraftStore();
  const initial = store.getState();

  store.getState().actions.stageImportedActiveList(current, current, importPolicy, "unchanged.xml");
  assert.equal(store.getState(), initial);

  store
    .getState()
    .actions.stageImportedActiveList(current, [core, second, first], importPolicy, "ordered.xml");
  assert.equal(store.getState().activeOrderOperations.length, 1);
  assert.deepEqual(store.getState().changes, []);
  store
    .getState()
    .actions.undoActiveOrder(requireValue(store.getState().activeOrderOperations[0]).id);
  assert.deepEqual(store.getState().activeOrderOperations, []);
  assert.equal(store.getState().activeOrder, undefined);
  assert.equal(store.getState().activeBasePackageIds, undefined);

  store
    .getState()
    .actions.stageImportedActiveList(current, [core, second, first], importPolicy, "ordered.xml");
  store.getState().actions.discard();
  assert.deepEqual(store.getState().changes, []);
  assert.deepEqual(store.getState().activeOrderOperations, []);
  assert.equal(store.getState().activeBaseConfigTarget, undefined);
});

void test("inactive subscribed removals atomically stage unsubscribe before removal and stay draft-only", () => {
  const target = requireValue(mods[0]);
  const store = createDraftStore();

  store.getState().actions.stageRemoval([target], policy);
  assert.deepEqual(
    store.getState().changes.map((change) => ({ id: change.mod.id, action: change.action })),
    [
      { id: target.id, action: draftActions.unsubscribe },
      { id: target.id, action: draftActions.remove },
    ],
  );
  assert.equal(target.subscribed, true);

  store.getState().actions.undoAction(target.id, draftActions.remove);
  assert.deepEqual(
    store.getState().changes.map((change) => ({ id: change.mod.id, action: change.action })),
    [{ id: target.id, action: draftActions.unsubscribe }],
  );

  store.getState().actions.undo(target.id);
  assert.deepEqual(store.getState().changes, []);
  assert.equal(target.subscribed, true);

  store.getState().actions.stageRemoval([target], policy);
  store.getState().actions.discard();
  assert.deepEqual(store.getState().changes, []);
  assert.equal(target.subscribed, true);
});

void test("compound removal cancels pending subscribes and rejects a selection containing an Active mod without partial staging", () => {
  const inactive = requireValue(mods[1]);
  const active = requireValue(mods[0]);
  const store = createDraftStore();
  store.getState().actions.stage([inactive], draftActions.subscribe, policy);
  store.getState().actions.stageRemoval([inactive], policy);
  assert.deepEqual(
    store.getState().changes.map((change) => ({ id: change.mod.id, action: change.action })),
    [{ id: inactive.id, action: draftActions.remove }],
  );

  const before = store.getState();
  assert.throws(() => {
    store.getState().actions.stageRemoval([inactive, active], {
      ...policy,
      activeIds: new Set([active.id]),
    });
  }, /Active/);
  assert.equal(store.getState(), before);
});

void test("duplicate normalized package activations are rejected atomically", () => {
  const active = { ...draftMod("10", true), packageId: "Author.Shared" };
  const first = { ...draftMod("11"), packageId: "author.pending" };
  const duplicateActive = { ...draftMod("12"), packageId: "author.shared_steam" };
  const duplicatePending = { ...draftMod("13"), packageId: "AUTHOR.PENDING_steam" };
  const savedIds = new Set([active, first, duplicateActive, duplicatePending].map((mod) => mod.id));
  const activePolicy = {
    savedIds,
    activeIds: new Set([active.id]),
    activePackageIds: ["ludeon.rimworld", active.packageId],
    activeConfigTarget: defaultConfigTarget,
  };
  const store = createDraftStore();
  const before = store.getState();

  assert.throws(() => {
    store.getState().actions.stage([duplicateActive], draftActions.activate, activePolicy);
  }, /another row already uses package ID author\.shared/);
  assert.equal(store.getState(), before);

  const pendingPolicy = {
    ...activePolicy,
    activeIds: new Set<string>(),
    activePackageIds: ["ludeon.rimworld"],
  };
  assert.throws(() => {
    store.getState().actions.stage([first, duplicatePending], draftActions.activate, pendingPolicy);
  }, /another row already uses package ID author\.pending/);
  assert.equal(store.getState(), before);

  store.getState().actions.stage([first], draftActions.activate, pendingPolicy);
  const staged = store.getState();
  assert.throws(() => {
    store.getState().actions.stage([duplicatePending], draftActions.activate, pendingPolicy);
  }, /another row already uses package ID author\.pending/);
  assert.equal(store.getState(), staged);
});

void test("draft staging is atomic for Active, subscribed-removal, unsaved and local targets", () => {
  const store = createDraftStore();
  const { actions } = store.getState();
  actions.stage([requireValue(mods[1])], draftActions.subscribe, policy);
  const before = store.getState();
  assert.throws(() => {
    actions.stage([requireValue(mods[0])], draftActions.unsubscribe, {
      ...policy,
      activeIds: new Set(["steam-1"]),
    });
  }, /Active/);
  assert.throws(() => {
    actions.stage([requireValue(mods[2]), requireValue(mods[0])], draftActions.remove, policy);
  }, /pending unsubscribe/);
  assert.throws(() => {
    actions.stage([draftMod("missing")], draftActions.subscribe, policy);
  }, /save/);
  assert.throws(() => {
    actions.stage(
      [{ ...requireValue(mods[1]), workshopId: undefined }],
      draftActions.subscribe,
      policy,
    );
  }, /Local/);
  assert.equal(store.getState(), before);
});

void test("external Active or folder errors do not block staging an inactive unsubscribe", () => {
  const store = createDraftStore();
  store.getState().actions.stage([requireValue(mods[0])], draftActions.unsubscribe, {
    ...policy,
    activeError: "Workshop drive is disconnected",
  });
  assert.deepEqual(store.getState().changes, [
    { mod: requireValue(mods[0]), action: draftActions.unsubscribe },
  ]);
});

void test("draft actions never mutate mod data and fresh stores stay isolated until hydration", () => {
  const before = JSON.stringify(mods);
  const store = createDraftStore();
  store.getState().actions.stage([requireValue(mods[1])], draftActions.remove, policy);
  assert.equal(JSON.stringify(mods), before);
  assert.deepEqual(createDraftStore().getState().changes, []);
  assert.equal("setState" in store, false);
  store.getState().actions.undo("steam-2");
  assert.deepEqual(store.getState().changes, []);
  store.getState().actions.stage([requireValue(mods[1])], draftActions.subscribe, policy);
  store.getState().actions.discard();
  assert.deepEqual(store.getState().changes, []);
});

void test("pending draft snapshots hydrate exact intentions, order memberships and operation IDs", () => {
  const core = draftCore();
  const harmony = { ...requireValue(mods[0]), packageId: "brrainz.harmony" };
  const incoming = requireValue(mods[1]);
  const currentMods = [core, harmony, incoming];
  const base = ["brrainz.harmony", "ludeon.rimworld"];
  const store = createDraftStore();
  const { actions } = store.getState();

  actions.stageActivation([incoming], {
    ...policy,
    activeIds: new Set([harmony.id, core.id]),
    activePackageIds: base,
  });
  actions.setActiveOrder(
    ["ludeon.rimworld", requireValue(incoming.packageId), "brrainz.harmony"],
    base,
    defaultConfigTarget,
    manualOrderOperation("steam-harmony", "Harmony", 1, 3),
  );
  actions.openReview();
  actions.reportProgress({
    step: draftSteps.validate,
    status: draftStatuses.running,
    completed: 0,
    total: 1,
    message: "Transient progress",
  });

  const snapshot = requireValue(actions.getPendingDraft());
  assert.deepEqual(
    snapshot.changes.map(({ action, target }) => ({ action, target })),
    [
      {
        action: draftActions.subscribe,
        target: {
          id: incoming.id,
          name: incoming.name,
          source: incoming.source,
          packageId: incoming.packageId,
          workshopId: incoming.workshopId,
        },
      },
      {
        action: draftActions.activate,
        target: {
          id: incoming.id,
          name: incoming.name,
          source: incoming.source,
          packageId: incoming.packageId,
          workshopId: incoming.workshopId,
        },
      },
    ],
  );
  assert.deepEqual(snapshot.operationMemberships, [
    {
      operationId: "order-1",
      packageIds: ["brrainz.harmony", "ludeon.rimworld", incoming.packageId],
    },
  ]);
  assert.doesNotMatch(JSON.stringify(snapshot), /Retained summary|Retained notes|userTagIds/);
  for (const transient of ["applying", "reviewOpen", "reviewBatch", "progress"]) {
    assert.equal(Object.hasOwn(snapshot, transient), false);
  }

  const restored = createDraftStore();
  restored.getState().actions.hydratePendingDraft(snapshot, currentMods);
  const restoredState = restored.getState();
  assert.deepEqual(restoredState.activeOrder, snapshot.activeOrder);
  assert.deepEqual(restoredState.activeOrderOperations, snapshot.activeOrderOperations);
  assert.deepEqual(restoredState.actions.getPendingDraft(), snapshot);
  assert.equal(restoredState.reviewOpen, false);
  assert.equal(restoredState.applying, false);
  assert.equal(restoredState.progress, undefined);

  restored.getState().actions.undoActiveOrder("order-1");
  assert.equal(restored.getState().activeOrder, undefined);
  restored
    .getState()
    .actions.setActiveOrder(
      ["ludeon.rimworld", "brrainz.harmony", requireValue(incoming.packageId)],
      base,
      defaultConfigTarget,
      {
        kind: activeOrderDraftKinds.manual,
        method: "position",
        packageId: "ludeon.rimworld",
        modId: core.id,
        modName: core.name,
        fromPosition: 2,
        toPosition: 1,
      },
    );
  assert.equal(restored.getState().activeOrderOperations[0]?.id, "order-2");
});

void test("pending draft hydration rebinds only activity targets and rejects altered replay state", () => {
  const subscription = createDraftStore();
  const subscribed = requireValue(mods[0]);
  subscription.getState().actions.stage([subscribed], draftActions.unsubscribe, {
    ...policy,
    activeIds: new Set(),
  });
  const subscriptionSnapshot = requireValue(subscription.getState().actions.getPendingDraft());
  const changedIdentity = { ...subscribed, workshopId: "999" };
  const restoredSubscription = createDraftStore();
  restoredSubscription
    .getState()
    .actions.hydratePendingDraft(subscriptionSnapshot, [changedIdentity]);
  assert.equal(restoredSubscription.getState().changes[0]?.mod.workshopId, subscribed.workshopId);
  assert.notEqual(restoredSubscription.getState().changes[0]?.mod, changedIdentity);

  const placeholder = {
    ...draftMod("restore-placeholder"),
    id: "active-package:author.restore",
    workshopId: undefined,
    packageId: "Author.Restore_steam",
  };
  const activity = createDraftStore();
  activity.getState().actions.stage([placeholder], draftActions.deactivate, {
    ...policy,
    activeIds: new Set([placeholder.id]),
    activePackageIds: ["ludeon.rimworld", requireValue(placeholder.packageId)],
  });
  const activitySnapshot = requireValue(activity.getState().actions.getPendingDraft());
  const installed = {
    ...placeholder,
    id: "local:author.restore",
    packageId: "author.restore",
    name: "Current installed identity",
  };
  const restoredActivity = createDraftStore();
  restoredActivity.getState().actions.hydratePendingDraft(activitySnapshot, [installed]);
  assert.equal(restoredActivity.getState().changes[0]?.mod, installed);

  const order = createDraftStore();
  order
    .getState()
    .actions.setActiveOrder(
      ["author.two", "author.one"],
      ["author.one", "author.two"],
      defaultConfigTarget,
      manualOrderOperation("steam-one", "One", 1, 2),
    );
  const altered = {
    ...requireValue(order.getState().actions.getPendingDraft()),
    activeOrder: ["author.one", "author.two"],
  };
  const rejected = createDraftStore();
  assert.throws(() => {
    rejected.getState().actions.hydratePendingDraft(altered, []);
  }, /no longer reproduces/);
  assert.deepEqual(rejected.getState().changes, []);
  assert.deepEqual(rejected.getState().activeOrderOperations, []);
});

void test("activity drafts rebase a disappeared ID through one normalized package match only", () => {
  const placeholder = {
    ...draftMod("placeholder"),
    id: "active-package:author.rebased",
    workshopId: undefined,
    packageId: "Author.Rebased_steam",
  };
  const installed = {
    ...placeholder,
    id: "steam-999",
    workshopId: "999",
    packageId: "author.rebased",
    name: "Installed identity",
  };
  const exact = { ...draftMod("exact"), packageId: "author.exact" };
  const ambiguous = {
    ...draftMod("ambiguous"),
    id: "active-package:author.ambiguous",
    workshopId: undefined,
    packageId: "author.ambiguous",
  };
  const firstAmbiguousMatch = {
    ...ambiguous,
    id: "local:first",
    name: "First match",
  };
  const secondAmbiguousMatch = {
    ...ambiguous,
    id: "local:second",
    name: "Second match",
  };
  const subscription = draftMod("subscription");
  const removal = draftMod("removal");
  const changes = [
    { mod: placeholder, action: draftActions.deactivate },
    { mod: exact, action: draftActions.deactivate },
    { mod: ambiguous, action: draftActions.deactivate },
    { mod: subscription, action: draftActions.subscribe },
    { mod: removal, action: draftActions.remove },
  ] as const;

  const rebased = rebaseActivityDraftChanges(changes, [
    installed,
    exact,
    firstAmbiguousMatch,
    secondAmbiguousMatch,
    { ...subscription, id: "steam-subscription-replacement" },
    { ...removal, id: "steam-removal-replacement" },
  ]);

  assert.notEqual(rebased, changes);
  assert.equal(rebased[0]?.mod, installed);
  assert.equal(rebased[1], changes[1], "an exact activity identity must be retained");
  assert.equal(rebased[2], changes[2], "an ambiguous package match must not be rebound");
  assert.equal(rebased[3], changes[3], "subscription identity must remain exact");
  assert.equal(rebased[4], changes[4], "removal identity must remain exact");
  assert.equal(rebaseActivityDraftChanges(changes, []), changes);
});

void test("activity draft rebasing refuses collisions with exact or competing intentions", () => {
  const installed = { ...draftMod("target"), packageId: "author.shared" };
  const firstOrphan = {
    ...installed,
    id: "active-package:author.shared:first",
  };
  const secondOrphan = {
    ...installed,
    id: "active-package:author.shared:second",
  };
  const exactCollision = [
    { mod: installed, action: draftActions.deactivate },
    { mod: firstOrphan, action: draftActions.activate },
  ] as const;
  const competingOrphans = [
    { mod: firstOrphan, action: draftActions.deactivate },
    { mod: secondOrphan, action: draftActions.activate },
  ] as const;

  assert.equal(rebaseActivityDraftChanges(exactCollision, [installed]), exactCollision);
  assert.equal(rebaseActivityDraftChanges(competingOrphans, [installed]), competingOrphans);
});

void test("draft store rebases activity changes without notifying for unsafe or locked matches", () => {
  const placeholder = {
    ...draftMod("placeholder-store"),
    id: "active-package:author.store",
    workshopId: undefined,
    packageId: "Author.Store_steam",
  };
  const installed = {
    ...placeholder,
    id: "local:author.store",
    packageId: "author.store",
    name: "Installed store identity",
  };
  const store = createDraftStore();
  const { actions } = store.getState();
  actions.stage([placeholder], draftActions.deactivate, {
    ...policy,
    activeIds: new Set([placeholder.id]),
    activePackageIds: ["ludeon.rimworld", requireValue(placeholder.packageId)],
  });
  let notifications = 0;
  const stop = store.subscribe(() => {
    notifications++;
  });

  actions.rebaseActivityChanges([]);
  assert.equal(notifications, 0);
  actions.rebaseActivityChanges([installed, { ...installed, id: "local:duplicate" }]);
  assert.equal(notifications, 0);
  assert.equal(store.getState().changes[0]?.mod, placeholder);

  actions.rebaseActivityChanges([installed]);
  assert.equal(notifications, 1);
  assert.equal(store.getState().changes[0]?.mod, installed);

  requireValue(actions.beginApply());
  const replacement = { ...installed, id: "local:replacement" };
  actions.rebaseActivityChanges([replacement]);
  assert.equal(notifications, 2, "beginApply is the only additional state transition");
  assert.equal(store.getState().changes[0]?.mod, installed);
  stop();
});

void test("application snapshots lock draft edits and release only completed targets", () => {
  const store = createDraftStore();
  const { actions } = store.getState();
  actions.stage([requireValue(mods[1]), requireValue(mods[2])], draftActions.subscribe, policy);
  const snapshot = requireValue(actions.beginApply());
  assert.equal(actions.beginApply(), undefined);
  const locked = store.getState();
  actions.undo("steam-2");
  actions.discard();
  actions.stage([requireValue(mods[0])], draftActions.unsubscribe, policy);
  assert.equal(store.getState(), locked);
  actions.complete("steam-2", draftActions.subscribe);
  assert.deepEqual(
    store.getState().changes.map((change) => change.mod.id),
    ["steam-3"],
  );
  assert.equal(snapshot.length, 2);
  actions.endApply();
  const unlocked = store.getState();
  actions.complete("steam-3", draftActions.subscribe);
  assert.equal(store.getState(), unlocked);
  actions.undo("steam-3");
  assert.deepEqual(store.getState().changes, []);
});

void test("draft review state is shared, snapshots the confirmed batch and resets stale progress", () => {
  const store = createDraftStore();
  const { actions } = store.getState();
  actions.openReview();
  assert.equal(store.getState().reviewOpen, false);
  actions.stage([requireValue(mods[1])], draftActions.subscribe, policy);
  actions.openReview();
  assert.equal(store.getState().reviewOpen, true);
  const progress = {
    step: draftSteps.validate,
    status: draftStatuses.running,
    completed: 0,
    total: 1,
    message: "Checking",
  } as const;
  actions.reportProgress(progress);
  const snapshot = requireValue(actions.beginApply());
  assert.equal(store.getState().reviewBatch, snapshot);
  actions.closeReview();
  assert.equal(store.getState().reviewOpen, true);
  actions.endApply();
  actions.closeReview();
  assert.equal(store.getState().reviewOpen, false);
  actions.openReview();
  assert.equal(store.getState().reviewOpen, true);
  assert.equal(store.getState().reviewBatch, undefined);
  assert.equal(store.getState().progress, undefined);
});

void test("no-op draft actions do not notify or recreate state", () => {
  const store = createDraftStore();
  let calls = 0;
  const stop = store.subscribe(() => {
    calls++;
  });
  const { actions } = store.getState();
  actions.undo("missing");
  actions.discard();
  actions.endApply();
  actions.complete("missing", draftActions.subscribe);
  assert.equal(actions.beginApply(), undefined);
  actions.stage([requireValue(mods[1])], draftActions.unsubscribe, policy);
  assert.equal(calls, 0);
  actions.stage([requireValue(mods[1])], draftActions.subscribe, policy);
  actions.stage([requireValue(mods[1])], draftActions.subscribe, policy);
  assert.equal(calls, 1);
  stop();
});

void test("active load-order drafts compare normalized package IDs without hiding real reorders", () => {
  const store = createDraftStore();
  const { actions } = store.getState();
  const base = ["BRRAINZ.HARMONY_steam", "ludeon.rimworld"];
  let notifications = 0;
  const stop = store.subscribe(() => {
    notifications++;
  });

  actions.setActiveOrder(
    ["brrainz.harmony", "LUDEON.RIMWORLD"],
    base,
    defaultConfigTarget,
    manualOrderOperation("steam-1", "Harmony", 1, 1),
  );
  assert.equal(store.getState().activeOrder, undefined);
  assert.deepEqual(store.getState().activeOrderOperations, []);
  assert.equal(store.getState().activeBasePackageIds, undefined);
  assert.equal(notifications, 0);

  actions.setActiveOrder(
    ["ludeon.rimworld", "brrainz.harmony"],
    base,
    defaultConfigTarget,
    manualOrderOperation("steam-1", "Harmony", 1, 2),
  );
  assert.deepEqual(store.getState().activeOrder, ["ludeon.rimworld", "BRRAINZ.HARMONY_steam"]);
  assert.deepEqual(store.getState().activeOrderOperations, [
    savedOrderOperation("order-1", manualOrderOperation("steam-1", "Harmony", 1, 2)),
  ]);
  assert.deepEqual(store.getState().activeBasePackageIds, base);
  assert.equal(store.getState().activeBaseConfigTarget, defaultConfigTarget);
  assert.equal(notifications, 1);
  stop();
});

void test("manual load-order actions append distinct chronological draft operations", () => {
  const store = createDraftStore();
  const { actions } = store.getState();
  const base = ["brrainz.harmony", "ludeon.rimworld", "author.first", "author.second"];

  actions.setActiveOrder(
    ["ludeon.rimworld", "brrainz.harmony", "author.first", "author.second"],
    base,
    defaultConfigTarget,
    manualOrderOperation("steam-harmony", "Harmony", 1, 2),
  );
  actions.setActiveOrder(
    ["ludeon.rimworld", "brrainz.harmony", "author.second", "author.first"],
    base,
    defaultConfigTarget,
    manualOrderOperation("steam-second", "Second mod", 4, 3, "position"),
  );

  assert.deepEqual(store.getState().activeOrder, [
    "ludeon.rimworld",
    "brrainz.harmony",
    "author.second",
    "author.first",
  ]);
  assert.deepEqual(store.getState().activeOrderOperations, [
    savedOrderOperation("order-1", manualOrderOperation("steam-harmony", "Harmony", 1, 2)),
    savedOrderOperation(
      "order-2",
      manualOrderOperation("steam-second", "Second mod", 4, 3, "position"),
    ),
  ]);
  assert.deepEqual(store.getState().activeBasePackageIds, base);
});

void test("auto-sort replaces every earlier manual load-order operation", () => {
  const store = createDraftStore();
  const { actions } = store.getState();
  const base = ["author.one", "author.two", "author.three"];

  actions.setActiveOrder(
    ["author.two", "author.one", "author.three"],
    base,
    defaultConfigTarget,
    manualOrderOperation("steam-one", "One", 1, 2),
  );
  actions.setActiveOrder(
    ["author.two", "author.three", "author.one"],
    base,
    defaultConfigTarget,
    manualOrderOperation("steam-three", "Three", 3, 2),
  );
  actions.replaceActiveOrder(
    ["author.one", "author.three", "author.two"],
    base,
    defaultConfigTarget,
    [autoSortOrderOperation("author.three", "Three", 3, 2)],
  );

  assert.deepEqual(store.getState().activeOrderOperations, [
    savedOrderOperation("order-3", autoSortOrderOperation("author.three", "Three", 3, 2)),
  ]);
  assert.deepEqual(store.getState().activeOrder, ["author.one", "author.three", "author.two"]);
});

void test("manual load-order actions append after auto-sort and a later auto-sort replaces them", () => {
  const store = createDraftStore();
  const { actions } = store.getState();
  const base = ["author.one", "author.two", "author.three"];

  actions.replaceActiveOrder(
    ["author.one", "author.three", "author.two"],
    base,
    defaultConfigTarget,
    [autoSortOrderOperation("author.three", "Three", 3, 2)],
  );
  actions.setActiveOrder(
    ["author.three", "author.one", "author.two"],
    base,
    defaultConfigTarget,
    manualOrderOperation("steam-three", "Three", 2, 1),
  );
  assert.deepEqual(store.getState().activeOrderOperations, [
    savedOrderOperation("order-1", autoSortOrderOperation("author.three", "Three", 3, 2)),
    savedOrderOperation("order-2", manualOrderOperation("steam-three", "Three", 2, 1)),
  ]);

  actions.replaceActiveOrder(base, base, defaultConfigTarget, []);
  assert.deepEqual(store.getState().activeOrderOperations, []);
  assert.equal(store.getState().activeOrder, undefined);
});

void test("a base-equal auto-sort clears obsolete manual order changes", () => {
  const store = createDraftStore();
  const { actions } = store.getState();
  const base = ["author.one", "author.two", "author.three"];

  actions.setActiveOrder(
    ["author.two", "author.one", "author.three"],
    base,
    defaultConfigTarget,
    manualOrderOperation("steam-two", "Two", 2, 1),
  );
  actions.replaceActiveOrder(base, base, defaultConfigTarget, []);

  assert.deepEqual(store.getState().activeOrderOperations, []);
  assert.equal(store.getState().activeOrder, undefined);
  assert.equal(store.getState().activeBasePackageIds, undefined);
});

void test("activity changes and their undo preserve and re-project load-order operations", () => {
  const store = createDraftStore();
  const { actions } = store.getState();
  const base = ["brrainz.harmony", "ludeon.rimworld"];
  const harmony = { ...requireValue(mods[0]), packageId: "brrainz.harmony" };

  actions.setActiveOrder(
    ["ludeon.rimworld", "brrainz.harmony"],
    base,
    defaultConfigTarget,
    manualOrderOperation("steam-1", "Harmony", 1, 2),
  );
  const operation = requireValue(store.getState().activeOrderOperations[0]);

  actions.stage([harmony], draftActions.deactivate, {
    ...policy,
    activeIds: new Set([harmony.id]),
    activePackageIds: base,
  });
  assert.deepEqual(store.getState().activeOrderOperations, [operation]);
  assert.deepEqual(store.getState().activeOrder, ["ludeon.rimworld", "brrainz.harmony"]);

  actions.undoAction(harmony.id, draftActions.deactivate);
  assert.deepEqual(store.getState().activeOrderOperations, [operation]);
  assert.deepEqual(store.getState().activeOrder, ["ludeon.rimworld", "brrainz.harmony"]);

  const incoming = { ...requireValue(mods[1]), subscribed: true };
  actions.stageActivation([incoming], {
    ...policy,
    activePackageIds: base,
  });
  assert.deepEqual(store.getState().activeOrderOperations, [operation]);
  assert.deepEqual(store.getState().activeOrder, [
    "ludeon.rimworld",
    "brrainz.harmony",
    incoming.packageId,
  ]);

  actions.undo(incoming.id);
  assert.deepEqual(store.getState().activeOrderOperations, [operation]);
  assert.deepEqual(store.getState().activeOrder, ["ludeon.rimworld", "brrainz.harmony"]);
});

void test("undoing one load-order operation replays the others and retains activity drafts", () => {
  const store = createDraftStore();
  const { actions } = store.getState();
  const base = ["author.one", "author.two", "author.three"];

  actions.setActiveOrder(
    ["author.two", "author.one", "author.three"],
    base,
    defaultConfigTarget,
    manualOrderOperation("steam-one", "One", 1, 2),
  );
  actions.setActiveOrder(
    ["author.two", "author.three", "author.one"],
    base,
    defaultConfigTarget,
    manualOrderOperation("steam-three", "Three", 3, 2),
  );
  const incoming = { ...requireValue(mods[1]), subscribed: true };
  actions.stageActivation([incoming], {
    ...policy,
    activePackageIds: base,
  });
  const firstOperationId = requireValue(store.getState().activeOrderOperations[0]).id;

  actions.undoActiveOrder(firstOperationId);

  assert.deepEqual(
    store.getState().activeOrderOperations.map(({ modName }) => modName),
    ["Three"],
  );
  assert.deepEqual(store.getState().activeOrder, [
    "author.one",
    "author.three",
    "author.two",
    incoming.packageId,
  ]);
  assert.deepEqual(
    store.getState().changes.map(({ action }) => action),
    [draftActions.activate],
  );
  actions.undoActiveOrder("missing");
  assert.equal(store.getState().activeOrderOperations.length, 1);
});

void test("deactivation preserves move relationships and order undo removes only its target", () => {
  const store = createDraftStore();
  const { actions } = store.getState();
  const base = ["author.one", "author.two", "author.three"];
  const first = { ...draftMod("active-one"), packageId: "author.one" };

  actions.setActiveOrder(
    ["author.two", "author.one", "author.three"],
    base,
    defaultConfigTarget,
    manualOrderOperation("steam-two", "Two", 2, 1),
  );
  actions.setActiveOrder(
    ["author.two", "author.three", "author.one"],
    base,
    defaultConfigTarget,
    manualOrderOperation("steam-three", "Three", 3, 2),
  );
  actions.stage([first], draftActions.deactivate, {
    ...policy,
    activeIds: new Set([first.id]),
    activePackageIds: base,
  });

  assert.deepEqual(store.getState().activeOrder, ["author.two", "author.three", "author.one"]);
  const secondOperationId = requireValue(store.getState().activeOrderOperations[1]).id;
  actions.undoActiveOrder(secondOperationId);

  assert.deepEqual(
    store.getState().activeOrderOperations.map(({ modName }) => modName),
    ["Two"],
  );
  assert.deepEqual(store.getState().activeOrder, ["author.two", "author.one", "author.three"]);

  actions.undoAction(first.id, draftActions.deactivate);
  assert.deepEqual(store.getState().activeOrder, ["author.two", "author.one", "author.three"]);
});

void test("order undo keeps moves dormant while a captured activation is canceled", () => {
  const store = createDraftStore();
  const { actions } = store.getState();
  const base = ["author.one", "author.two", "author.three"];
  const incoming = {
    ...draftMod("captured-four", true),
    packageId: "author.four",
  };
  const activityPolicy = {
    ...policy,
    activePackageIds: base,
  };

  actions.stageActivation([incoming], activityPolicy);
  actions.setActiveOrder(
    ["author.two", "author.one", "author.three", "author.four"],
    base,
    defaultConfigTarget,
    manualOrderOperation("steam-one", "One", 1, 2),
  );
  actions.setActiveOrder(
    ["author.two", "author.one", "author.four", "author.three"],
    base,
    defaultConfigTarget,
    manualOrderOperation("steam-three", "Three", 3, 4),
  );

  actions.stage([incoming], draftActions.deactivate, activityPolicy);
  const firstOperationId = requireValue(store.getState().activeOrderOperations[0]).id;
  actions.undoActiveOrder(firstOperationId);

  assert.deepEqual(
    store.getState().activeOrderOperations.map(({ modName, fromPosition, toPosition }) => ({
      modName,
      fromPosition,
      toPosition,
    })),
    [{ modName: "Three", fromPosition: 3, toPosition: 4 }],
  );
  assert.deepEqual(store.getState().activeOrder, base);

  actions.stageActivation([incoming], activityPolicy);
  assert.deepEqual(store.getState().activeOrder, [
    "author.one",
    "author.two",
    "author.four",
    "author.three",
  ]);
});

void test("undoing a load-order operation retains unrelated moves that are temporarily no-ops", () => {
  const store = createDraftStore();
  const { actions } = store.getState();
  const base = ["author.one", "author.two", "author.three", "author.four"];

  actions.replaceActiveOrder(
    ["author.four", "author.two", "author.one", "author.three"],
    base,
    defaultConfigTarget,
    [
      autoSortOrderOperation("author.four", "Four", 4, 1),
      autoSortOrderOperation("author.two", "Two", 3, 2),
    ],
  );

  actions.undoActiveOrder(requireValue(store.getState().activeOrderOperations[0]).id);

  assert.deepEqual(store.getState().activeOrderOperations, [
    savedOrderOperation("order-2", autoSortOrderOperation("author.two", "Two", 3, 2)),
  ]);
  assert.deepEqual(store.getState().activeOrder, base);
  assert.deepEqual(store.getState().activeBasePackageIds, base);
  assert.equal(store.getState().activeBaseConfigTarget, defaultConfigTarget);
});

void test("load-order review snapshots history, failure retains it, success and discard clear it", () => {
  const store = createDraftStore();
  const { actions } = store.getState();
  const base = ["author.one", "author.two", "author.three"];

  actions.setActiveOrder(
    ["author.two", "author.one", "author.three"],
    base,
    defaultConfigTarget,
    manualOrderOperation("steam-one", "One", 1, 2),
  );
  actions.setActiveOrder(
    ["author.two", "author.three", "author.one"],
    base,
    defaultConfigTarget,
    manualOrderOperation("steam-three", "Three", 3, 2),
  );
  actions.openReview();
  const applyBatch = actions.beginApply();
  assert.deepEqual(applyBatch, []);
  assert.equal(store.getState().reviewOpen, true);
  assert.deepEqual(
    store.getState().reviewActiveOrderOperations,
    store.getState().activeOrderOperations,
  );

  actions.replaceActiveOrder(
    ["author.one", "author.two", "author.three"],
    base,
    defaultConfigTarget,
    [autoSortOrderOperation("author.two", "Two", 1, 2)],
  );
  assert.equal(store.getState().activeOrderOperations.length, 2, "apply locks the draft");
  actions.endApply();
  assert.equal(store.getState().activeOrderOperations.length, 2, "failure retains order history");

  assert.deepEqual(actions.beginApply(), []);
  actions.completeActiveOrder();
  actions.endApply();
  assert.equal(store.getState().activeOrder, undefined);
  assert.deepEqual(store.getState().activeOrderOperations, []);

  actions.closeReview();
  actions.setActiveOrder(
    ["author.two", "author.one", "author.three"],
    base,
    defaultConfigTarget,
    manualOrderOperation("steam-one", "One", 1, 2),
  );
  actions.discard();
  assert.equal(store.getState().activeOrder, undefined);
  assert.deepEqual(store.getState().activeOrderOperations, []);
  assert.equal(store.getState().activeBasePackageIds, undefined);
  assert.equal(store.getState().activeBaseConfigTarget, undefined);
});

void test("draft operation counts include every active-order history entry", () => {
  assert.equal(draftOperationCount([], 2), 2);
  assert.equal(remainingDraftOperationCount([], 2, 0), 2);
  assert.equal(
    draftOperationCount([{ mod: requireValue(mods[1]), action: draftActions.activate }]),
    1,
  );
  assert.equal(
    draftOperationCount([{ mod: requireValue(mods[1]), action: draftActions.activate }], 3),
    4,
  );
  assert.equal(
    remainingDraftOperationCount(
      [{ mod: requireValue(mods[1]), action: draftActions.activate }],
      3,
      2,
    ),
    2,
  );
});

void test("draft projection moves subscriptions, retains pending removals and never moves newly Active mods to Library", () => {
  const changes = draftHarness().changes;
  const before = JSON.stringify(mods);
  const projected = projectDraftPanels(
    mods.filter((mod) => !mod.subscribed),
    mods.filter((mod) => mod.subscribed),
    changes,
  );
  assert.deepEqual(
    projected.unsubscribed.map((mod) => mod.id),
    ["steam-3", "steam-1"],
  );
  assert.deepEqual(
    projected.subscribed.map((mod) => mod.id),
    ["steam-2"],
  );
  const protectedView = projectDraftPanels(
    mods.filter((mod) => !mod.subscribed),
    mods.filter((mod) => mod.subscribed),
    changes,
    new Set(["steam-1"]),
  );
  assert.deepEqual(
    protectedView.subscribed.map((mod) => mod.id),
    ["steam-2", "steam-1"],
  );
  assert.equal(JSON.stringify(mods), before);
});

void test("draft projection respects panel membership for uncached subscribed entries", () => {
  const mod = { ...draftMod("99"), subscribed: true };
  assert.deepEqual(
    projectDraftPanels([], [mod], []).subscribed.map((mod) => mod.id),
    [mod.id],
  );
});

void test("applying follows dependency-safe groups, reports visible steps and retains personal data", async () => {
  const harness = draftHarness();
  await applyDraftChanges(harness.changes, harness.store, harness.callbacks);
  assert.deepEqual(harness.events, [
    "load",
    `preview:${subscriptionActions.subscribeMods}`,
    "steam:steam-2:true",
    `preview:${subscriptionActions.unsubscribeMods}`,
    "steam:steam-1:false",
    "load",
    "delete:steam-3",
  ]);
  assert.deepEqual(harness.completed, ["steam-2", "steam-1", "steam-3"]);
  assert.deepEqual(
    [...new Set(harness.progress.map((value) => value.step))],
    [
      draftSteps.validate,
      draftSteps.subscribe,
      draftSteps.unsubscribe,
      draftSteps.remove,
      draftSteps.finish,
    ],
  );
  assert.equal(harness.progress.at(-1)?.status, draftStatuses.complete);
  assert.deepEqual(
    harness.vault().mods.map((mod) => mod.id),
    ["steam-1", "steam-2"],
  );
  assert.deepEqual(harness.vault().userTags, [{ id: "qol", name: "QoL", color: "#ffffff" }]);
  for (const mod of harness.vault().mods) {
    assert.deepEqual(mod.userTagIds, ["qol"]);
    assert.equal(mod.notes, "Retained notes");
  }
});

void test("a compound subscribed removal unsubscribes before deleting its library record", async () => {
  const target = requireValue(mods[0]);
  const harness = draftHarness([target]);
  const changes = [
    { mod: target, action: draftActions.unsubscribe },
    { mod: target, action: draftActions.remove },
  ] as const;

  await applyDraftChanges(changes, harness.store, harness.callbacks);

  assert.deepEqual(harness.events, [
    "load",
    `preview:${subscriptionActions.unsubscribeMods}`,
    `steam:${target.id}:false`,
    "load",
    `delete:${target.id}`,
  ]);
  assert.deepEqual(harness.completedChanges, [
    { id: target.id, action: draftActions.unsubscribe },
    { id: target.id, action: draftActions.remove },
  ]);
  assert.equal(
    harness.vault().mods.some((mod) => mod.id === target.id),
    false,
  );
});

void test("a failed compound unsubscribe retains the record and never starts deletion", async () => {
  const target = requireValue(mods[0]);
  const harness = draftHarness([target]);
  harness.failures.add(target.id);
  const changes = [
    { mod: target, action: draftActions.unsubscribe },
    { mod: target, action: draftActions.remove },
  ] as const;

  await assert.rejects(
    applyDraftChanges(changes, harness.store, harness.callbacks),
    /Steam failure/,
  );

  assert.ok(harness.vault().mods.some((mod) => mod.id === target.id));
  assert.ok(!harness.events.some((event) => event.startsWith("delete:")));
  assert.deepEqual(harness.completedChanges, []);
});

void test("activity and load-order drafts write one exact config between subscribe and unsubscribe groups", async () => {
  const active = requireValue(mods[0]);
  const incoming = requireValue(mods[1]);
  const harness = draftHarness([active, incoming]);
  const changes = [
    { mod: incoming, action: draftActions.subscribe },
    { mod: incoming, action: draftActions.activate },
    { mod: active, action: draftActions.deactivate },
    { mod: active, action: draftActions.unsubscribe },
  ] as const;
  const expectedActivePackageIds = ["Ludeon.RimWorld", "author.mod1"];

  await applyDraftChanges(changes, harness.store, harness.callbacks, {
    activeOrder: ["ludeon.rimworld", "AUTHOR.MOD2"],
    expectedActivePackageIds,
    expectedActiveConfigTarget: defaultConfigTarget,
  });

  assert.deepEqual(harness.events, [
    "load",
    `preview:${subscriptionActions.subscribeMods}`,
    "steam:steam-2:true",
    "active:Ludeon.RimWorld,author.mod2",
    `preview:${subscriptionActions.unsubscribeMods}`,
    "steam:steam-1:false",
  ]);
  assert.deepEqual(harness.activeWrites, [
    {
      settings: undefined,
      packageIds: ["Ludeon.RimWorld", "author.mod2"],
      expectedPackageIds: expectedActivePackageIds,
    },
  ]);
  assert.deepEqual(harness.completedChanges, [
    { id: "steam-2", action: draftActions.subscribe },
    { id: "steam-2", action: draftActions.activate },
    { id: "steam-1", action: draftActions.deactivate },
    { id: "steam-1", action: draftActions.unsubscribe },
  ]);
  assert.equal(harness.activeOrderCompletions(), 1);
  assert.deepEqual(
    [...new Set(harness.progress.map((value) => value.step))],
    [
      draftSteps.validate,
      draftSteps.subscribe,
      draftSteps.configure,
      draftSteps.unsubscribe,
      draftSteps.finish,
    ],
  );
});

void test("a retained order template filters pending deactivations at apply time", async () => {
  const harmony = {
    ...draftMod("30", true),
    packageId: "brrainz.harmony",
    name: "Harmony",
  };
  const harness = draftHarness([harmony]);

  await applyDraftChanges(
    [{ mod: harmony, action: draftActions.deactivate }],
    harness.store,
    harness.callbacks,
    {
      activeOrder: ["ludeon.rimworld", "brrainz.harmony"],
      activeOrderOperationCount: 1,
      expectedActivePackageIds: ["brrainz.harmony", "ludeon.rimworld"],
      expectedActiveConfigTarget: defaultConfigTarget,
    },
  );

  assert.deepEqual(harness.activeWrites, [
    {
      settings: undefined,
      packageIds: ["ludeon.rimworld"],
      expectedPackageIds: ["brrainz.harmony", "ludeon.rimworld"],
    },
  ]);
  assert.deepEqual(harness.completedChanges, [{ id: harmony.id, action: draftActions.deactivate }]);
  assert.equal(harness.activeOrderCompletions(), 1);
});

void test("activity apply rejects duplicate package activation before reading or completing work", async () => {
  const duplicate = { ...draftMod("20"), packageId: "AUTHOR.SHARED_steam" };
  const harness = draftHarness([duplicate]);

  await assert.rejects(
    applyDraftChanges(
      [{ mod: duplicate, action: draftActions.activate }],
      harness.store,
      harness.callbacks,
      {
        expectedActivePackageIds: ["ludeon.rimworld", "author.shared"],
        expectedActiveConfigTarget: defaultConfigTarget,
      },
    ),
    /already active or duplicated in the draft/,
  );
  assert.deepEqual(harness.events, []);
  assert.deepEqual(harness.activeWrites, []);
  assert.deepEqual(harness.completedChanges, []);
  assert.equal(harness.activeOrderCompletions(), 0);
});

void test("activity apply permits a paired physical-row replacement for the same package", async () => {
  const outgoing = { ...draftMod("old", true), packageId: "author.shared", name: "Local copy" };
  const incoming = {
    ...draftMod("new", true),
    packageId: "Author.Shared_steam",
    name: "Workshop copy",
  };
  const harness = draftHarness([outgoing, incoming]);

  await applyDraftChanges(
    [
      { mod: incoming, action: draftActions.activate },
      { mod: outgoing, action: draftActions.deactivate },
    ],
    harness.store,
    harness.callbacks,
    {
      activeOrder: ["ludeon.rimworld", "author.shared"],
      expectedActivePackageIds: ["ludeon.rimworld", "author.shared"],
      expectedActiveConfigTarget: defaultConfigTarget,
    },
  );

  assert.deepEqual(harness.activeWrites, [
    {
      settings: undefined,
      packageIds: ["ludeon.rimworld", "Author.Shared_steam"],
      expectedPackageIds: ["ludeon.rimworld", "author.shared"],
    },
  ]);
  assert.deepEqual(harness.completedChanges, [
    { id: incoming.id, action: draftActions.activate },
    { id: outgoing.id, action: draftActions.deactivate },
  ]);
});

void test("activity apply keeps a paired physical-row replacement in its load-order slot", async () => {
  const outgoing = { ...draftMod("old-middle", true), packageId: "author.shared" };
  const incoming = {
    ...draftMod("new-middle", true),
    packageId: "Author.Shared_steam",
  };
  const harness = draftHarness([outgoing, incoming]);

  await applyDraftChanges(
    [
      { mod: outgoing, action: draftActions.deactivate },
      { mod: incoming, action: draftActions.activate },
    ],
    harness.store,
    harness.callbacks,
    {
      expectedActivePackageIds: ["ludeon.rimworld", "author.shared", "author.after"],
      expectedActiveConfigTarget: defaultConfigTarget,
    },
  );

  assert.deepEqual(harness.activeWrites, [
    {
      settings: undefined,
      packageIds: ["ludeon.rimworld", "Author.Shared_steam", "author.after"],
      expectedPackageIds: ["ludeon.rimworld", "author.shared", "author.after"],
    },
  ]);
});

void test("activity apply rejects a changed ModsConfig target before reading or writing", async () => {
  const incoming = draftMod("21");
  const harness = draftHarness([incoming]);

  await assert.rejects(
    applyDraftChanges(
      [{ mod: incoming, action: draftActions.activate }],
      harness.store,
      harness.callbacks,
      {
        settings: { rimWorldConfigPath: "/new/ModsConfig.xml" },
        expectedActivePackageIds: ["ludeon.rimworld"],
        expectedActiveConfigTarget: normalizeActiveConfigTarget({
          rimWorldConfigPath: " /old/ModsConfig.xml ",
        }),
      },
    ),
    /ModsConfig target changed/,
  );
  assert.deepEqual(harness.events, []);
  assert.deepEqual(harness.activeWrites, []);
  assert.deepEqual(harness.completedChanges, []);
});

void test("unverifiable returned active configuration retains activity and order completions", async () => {
  for (const returned of [
    {
      packageIds: ["ludeon.rimworld", "author.mod22"],
      error: "Config became unreadable",
    },
    { packageIds: ["ludeon.rimworld", "author.other"] },
    { packageIds: ["ludeon.rimworld", "author.mod22_steam"] },
  ]) {
    const incoming = draftMod("22");
    const harness = draftHarness([incoming]);
    const writeActive = harness.store.setActiveMods;
    harness.store.setActiveMods = async (...args) => {
      await writeActive(...args);
      return returned;
    };

    await assert.rejects(
      applyDraftChanges(
        [{ mod: incoming, action: draftActions.activate }],
        harness.store,
        harness.callbacks,
        {
          activeOrder: ["ludeon.rimworld", "author.mod22"],
          expectedActivePackageIds: ["ludeon.rimworld"],
          expectedActiveConfigTarget: defaultConfigTarget,
        },
      ),
      /could not be verified|changed before the update could be verified/,
    );
    assert.deepEqual(harness.completedChanges, []);
    assert.equal(harness.activeOrderCompletions(), 0);
    assert.equal(harness.activeWrites.length, 1);
  }
});

void test("identity drift rejects before mutation and removal state is rechecked after earlier groups", async () => {
  const changedIdentity = draftHarness();
  changedIdentity.replace({
    ...changedIdentity.vault(),
    mods: changedIdentity
      .vault()
      .mods.map((mod) => (mod.id === "steam-3" ? { ...mod, workshopId: "changed" } : mod)),
  });
  const before = JSON.stringify(changedIdentity.vault());
  await assert.rejects(
    applyDraftChanges(changedIdentity.changes, changedIdentity.store, changedIdentity.callbacks),
    /target changed/,
  );
  assert.deepEqual(changedIdentity.events, ["load"]);
  assert.deepEqual(changedIdentity.completed, []);
  assert.equal(JSON.stringify(changedIdentity.vault()), before);

  const subscribedRemoval = draftHarness();
  subscribedRemoval.replace({
    ...subscribedRemoval.vault(),
    mods: subscribedRemoval
      .vault()
      .mods.map((mod) => (mod.id === "steam-3" ? { ...mod, subscribed: true } : mod)),
    localSteamState: { ...subscribedRemoval.vault().localSteamState, observedIds: ["1", "3"] },
  });
  await assert.rejects(
    applyDraftChanges(
      subscribedRemoval.changes,
      subscribedRemoval.store,
      subscribedRemoval.callbacks,
    ),
    /Subscribed/,
  );
  assert.deepEqual(subscribedRemoval.events, [
    "load",
    `preview:${subscriptionActions.subscribeMods}`,
    "steam:steam-2:true",
    `preview:${subscriptionActions.unsubscribeMods}`,
    "steam:steam-1:false",
    "load",
  ]);
  assert.deepEqual(subscribedRemoval.completed, ["steam-2", "steam-1"]);
  assert.ok(!subscribedRemoval.events.some((event) => event.startsWith("delete:")));
});

void test("Active/read failures during native preflight retain every change without subscriptions or deletions", async () => {
  for (const failure of [
    "Active mods cannot be unsubscribed",
    "Disk disconnected",
    "Steam offline",
  ]) {
    const harness = draftHarness();
    harness.store.previewLibrarySubscriptions = async () => {
      throw new Error(failure);
    };
    await assert.rejects(
      applyDraftChanges(harness.changes, harness.store, harness.callbacks),
      new RegExp(failure),
    );
    assert.deepEqual(harness.completed, []);
    assert.deepEqual(harness.events, ["load"]);
  }
});

void test("native unsubscribe protection stops later groups after safe subscriptions complete", async () => {
  for (const protection of [{ activeCount: 1 }, { activeError: "Unreadable Active metadata" }]) {
    const harness = draftHarness();
    const preview = harness.store.previewLibrarySubscriptions;
    harness.store.previewLibrarySubscriptions = async (...args) => ({
      ...(await preview(...args)),
      ...protection,
    });
    await assert.rejects(
      applyDraftChanges(harness.changes, harness.store, harness.callbacks),
      /Active/,
    );
    assert.deepEqual(harness.completed, ["steam-2"]);
    assert.ok(!harness.events.includes("steam:steam-1:false"));
    assert.ok(!harness.events.some((event) => event.startsWith("delete:")));
  }
});

void test("applying a draft preserves personal edits and metadata refreshed after staging", async () => {
  const harness = draftHarness();
  const original = requireValue(harness.changes.find((change) => change.mod.id === "steam-2"));
  const refreshed = {
    ...original.mod,
    name: "Refreshed title",
    thumbnail: "https://example.invalid/refreshed.png",
    metadataUpdatedAt: "2026-10-06T12:00:00.000Z",
    notes: "Edited while drafting",
    userTagIds: ["qol", "combat"],
  };
  harness.replace({
    ...harness.vault(),
    mods: harness.vault().mods.map((mod) => (mod.id === refreshed.id ? refreshed : mod)),
    userTags: [...harness.vault().userTags, { id: "combat", name: "Combat", color: "#112233" }],
  });
  await applyDraftChanges(harness.changes, harness.store, harness.callbacks);
  assert.deepEqual(
    harness.vault().mods.find((mod) => mod.id === refreshed.id),
    { ...refreshed, subscribed: true },
  );
  assert.equal(original.mod.name, "Mod 2");
  assert.deepEqual(original.mod.userTagIds, ["qol"]);
  assert.equal(harness.vault().userTags.length, 2);
});

void test("a partial Steam failure keeps confirmed work and stops before all later actions and removals", async () => {
  const harness = draftHarness();
  harness.failures.add("steam-1");
  await assert.rejects(
    applyDraftChanges(harness.changes, harness.store, harness.callbacks),
    /Steam failure/,
  );
  assert.deepEqual(harness.completed, ["steam-2"]);
  assert.equal(harness.vault().mods.find((mod) => mod.id === "steam-1")?.subscribed, true);
  assert.equal(harness.vault().mods.find((mod) => mod.id === "steam-2")?.subscribed, true);
  assert.equal(harness.vault().mods.length, 3);
  assert.ok(!harness.events.some((event) => event.startsWith("delete:")));
  harness.failures.clear();
  await applyDraftChanges(
    harness.changes.filter((change) => !harness.completed.includes(change.mod.id)),
    harness.store,
    harness.callbacks,
  );
  assert.deepEqual(harness.completed, ["steam-2", "steam-1", "steam-3"]);
  assert.equal(harness.events.filter((event) => event === "steam:steam-2:true").length, 1);
});

void test("removal-only drafts never contact Steam", async () => {
  const harness = draftHarness();
  await applyDraftChanges(
    harness.changes.filter((change) => change.action === draftActions.remove),
    harness.store,
    harness.callbacks,
  );
  assert.deepEqual(harness.events, ["load", "load", "delete:steam-3"]);
});

void test("a removal becoming subscribed during Steam processing is refused and retained", async () => {
  const harness = draftHarness();
  const changeSubscription = harness.store.setSubscription;
  harness.store.setSubscription = async (...args) => {
    const result = await changeSubscription(...args);
    harness.replace({
      ...harness.vault(),
      mods: harness
        .vault()
        .mods.map((mod) => (mod.id === "steam-3" ? { ...mod, subscribed: true } : mod)),
      localSteamState: { ...harness.vault().localSteamState, observedIds: ["2", "3"] },
    });
    return { ...result, vault: harness.vault() };
  };
  await assert.rejects(
    applyDraftChanges(harness.changes, harness.store, harness.callbacks),
    /Subscribed/,
  );
  assert.deepEqual(harness.completed, ["steam-2", "steam-1"]);
  assert.ok(!harness.events.some((event) => event.startsWith("delete:")));
});

void test("slow Steam responses expose progress and do not start the next action prematurely", async () => {
  const harness = draftHarness();
  let release: (() => void) | undefined;
  let started: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const changeSubscription = harness.store.setSubscription;
  harness.store.setSubscription = async (...args) => {
    requireValue(started)();
    await waiting;
    return changeSubscription(...args);
  };
  const applying = applyDraftChanges(harness.changes, harness.store, harness.callbacks);
  await ready;
  assert.equal(harness.progress.at(-1)?.step, draftSteps.subscribe);
  assert.equal(harness.completed.length, 0);
  assert.ok(
    !harness.events.some((event) => event.startsWith("steam:") || event.startsWith("delete:")),
  );
  requireValue(release)();
  await applying;
  assert.equal(harness.completed.length, 3);
});

void test("review requires removal acknowledgement, keeps all entries and disables closing during execution", () => {
  const { changes } = draftHarness();
  const props = {
    changes,
    applying: false,
    remainingCount: changes.length,
    onUndo: noop,
    onUndoActiveOrder: noop,
    onClose: noop,
    onConfirm: noop,
  };
  const review = renderToStaticMarkup(<DraftChangesModal {...props} />);
  for (const mod of mods) {
    assert.match(review, new RegExp(mod.name));
  }
  assert.match(review, /Apply 3 changes/);
  assert.match(review, /checkbox/);
  assert.match(review, /disabled=""[^>]*>[^<]*<svg[\s\S]*Apply 3 changes/);
  const running = renderToStaticMarkup(
    <DraftChangesModal
      {...props}
      applying
      progress={{
        step: draftSteps.unsubscribe,
        status: draftStatuses.running,
        completed: 0,
        total: 1,
        message: "Unsubscribing Mod 1",
      }}
    />,
  );
  assert.match(running, /Current step progress/);
  assert.match(running, /Check current state and protections/);
  assert.match(running, /Back up and remove library records/);
  assert.doesNotMatch(running, /Apply 3 changes/);
});

void test("review and footer render one chronological draft line per load-order operation", () => {
  const activeOrderOperations = [
    savedOrderOperation("order-1", autoSortOrderOperation("author.three", "Three", 3, 2)),
    savedOrderOperation(
      "order-2",
      manualOrderOperation("steam-harmony", "Harmony", 1, 2, "position"),
    ),
  ];
  const review = renderToStaticMarkup(
    <DraftChangesModal
      changes={[]}
      activeOrderOperations={activeOrderOperations}
      remainingCount={activeOrderOperations.length}
      applying={false}
      onUndo={noop}
      onUndoActiveOrder={noop}
      onClose={noop}
      onConfirm={noop}
    />,
  );

  assert.match(review, /2 pending changes/);
  assert.match(review, /Apply 2 changes/);
  assert.match(review, /Three/);
  assert.match(review, /Auto-sort: move from position 3 to position 2/);
  assert.match(review, /Harmony/);
  assert.match(review, /Move from position 1 to position 2/);
  assert.equal(review.match(/aria-label="Undo pending load order change for/g)?.length, 2);
  assert.equal(review.match(/draft-badge draft-order/g)?.length, 2);
  assert.ok(
    review.indexOf("Three") < review.indexOf("Harmony"),
    "load-order draft lines must preserve operation chronology",
  );

  const footer = renderToStaticMarkup(
    <DraftBar
      changes={[]}
      activeOrderOperations={activeOrderOperations}
      disabled={false}
      applying={false}
      onReview={noop}
      onDiscard={noop}
      onRun={noop}
    />,
  );
  assert.match(footer, /2 pending changes/);
  assert.match(footer, /2 load order changes/);
});

void test("review identifies imported load-order moves and their source file", () => {
  const operation = savedOrderOperation(
    "order-import",
    importedOrderOperation("author.two", "steam-two", "Two", 3, 2, "dms-anomaly.xml"),
  );
  const review = renderToStaticMarkup(
    <DraftChangesModal
      changes={[]}
      activeOrderOperations={[operation]}
      remainingCount={1}
      applying={false}
      onUndo={noop}
      onUndoActiveOrder={noop}
      onClose={noop}
      onConfirm={noop}
    />,
  );

  assert.match(review, /Import: move from position 3 to position 2/);
  assert.match(review, /dms-anomaly\.xml/);
});

void test("pending row indicators keep tags without restoring inline subscription controls", () => {
  const html = renderToStaticMarkup(
    <ModRow
      mod={requireValue(mods[0])}
      tags={[]}
      selected={false}
      active
      loadOrder={1}
      pendingAction={draftActions.unsubscribe}
      subscriptionAction={subscriptionCommands.unsubscribe}
      onSelect={noop}
      onToggle={noop}
      onUndoDraft={noop}
    />,
  );
  assert.match(html, /aria-label="Load order 1">1<\/span>/);
  assert.match(html, /Pending unsubscribe/);
  assert.doesNotMatch(html, /Undo pending change for Mod 1|aria-label="Unsubscribe from/);
  assert.match(
    renderToStaticMarkup(
      <DraftBar
        changes={draftHarness().changes}
        disabled={false}
        applying={false}
        onReview={noop}
        onDiscard={noop}
        onRun={noop}
      />,
    ),
    /3 pending changes/,
  );
});

void test("pending indications consistently use an icon-led outlined presentation", () => {
  const actions = [
    draftActions.subscribe,
    draftActions.unsubscribe,
    draftActions.activate,
    draftActions.deactivate,
    draftActions.remove,
    "order" as const,
  ];
  const html = renderToStaticMarkup(
    <>
      {actions.map((action) => (
        <DraftBadge key={action} action={action} />
      ))}
    </>,
  );

  assert.equal(html.match(/<svg\b/g)?.length, actions.length);
  assert.equal(html.match(/lucide-clock-3/g)?.length, actions.length);
  for (const action of actions) {
    assert.match(html, new RegExp(`draft-badge draft-${action}`));
  }
  assert.match(html, /Pending subscribe/);
  assert.match(html, /Pending unsubscribe/);
  assert.match(html, /Pending activation/);
  assert.match(html, /Pending deactivation/);
  assert.match(html, /Pending removal/);
  assert.match(html, /Pending order/);
});

void test("single-change review and footer labels use singular wording", () => {
  const changes = [{ mod: requireValue(mods[1]), action: draftActions.subscribe }];
  const review = renderToStaticMarkup(
    <DraftChangesModal
      changes={changes}
      remainingCount={1}
      applying={false}
      onUndo={noop}
      onUndoActiveOrder={noop}
      onClose={noop}
      onConfirm={noop}
    />,
  );
  assert.match(review, /Apply 1 change</);
  assert.doesNotMatch(review, /1 pending changes/);
  const footer = renderToStaticMarkup(
    <DraftBar
      changes={changes}
      disabled={false}
      applying={false}
      onReview={noop}
      onDiscard={noop}
      onRun={noop}
    />,
  );
  assert.match(footer, /1 pending change</);
});

void test("footer offers Run RimWorld only when no membership or load-order draft is pending", () => {
  const render = ({
    changes = [],
    activeOrderOperations = [],
    disabled = false,
    applying = false,
  }: {
    changes?: Parameters<typeof DraftBar>[0]["changes"];
    activeOrderOperations?: Parameters<typeof DraftBar>[0]["activeOrderOperations"];
    disabled?: boolean;
    applying?: boolean;
  }) =>
    renderToStaticMarkup(
      <DraftBar
        changes={changes}
        activeOrderOperations={activeOrderOperations}
        disabled={disabled}
        applying={applying}
        onReview={noop}
        onDiscard={noop}
        onRun={noop}
      />,
    );

  const ready = render({});
  assert.match(ready, /lucide-play/);
  assert.match(ready, />Run RimWorld<\/button>/);
  assert.doesNotMatch(ready, /disabled=""[^>]*>[^<]*<svg[^>]*lucide-play/);
  assert.doesNotMatch(ready, /Confirm changes|Discard draft/);

  const membershipDraft = render({
    changes: [{ mod: requireValue(mods[1]), action: draftActions.subscribe }],
  });
  assert.doesNotMatch(membershipDraft, /Run RimWorld/);
  assert.match(membershipDraft, /Confirm changes/);
  assert.match(membershipDraft, /Discard draft/);

  const orderDraft = render({
    activeOrderOperations: [
      savedOrderOperation("order-1", autoSortOrderOperation("author.three", "Three", 3, 2)),
    ],
  });
  assert.doesNotMatch(orderDraft, /Run RimWorld/);
  assert.match(orderDraft, /Confirm changes/);

  for (const blocked of [render({ disabled: true }), render({ applying: true })]) {
    assert.match(blocked, /<button[^>]*disabled=""[^>]*>[\s\S]*Run RimWorld<\/button>/);
  }
});

void test("IPC accepts bound Workshop identities while preserving previous subscription argument arities", () => {
  for (const args of [
    ["steam-1", true],
    ["steam-1", false, undefined],
    ["steam-1", false, "1"],
  ]) {
    validateIpcArgs(ipcChannels.setSubscription, args);
  }
  for (const identity of [false, 1, "", " ", null, {}]) {
    assert.throws(() => {
      validateIpcArgs(ipcChannels.setSubscription, ["steam-1", false, identity]);
    }, /Invalid/);
  }
});
