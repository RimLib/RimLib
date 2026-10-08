import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { DraftBar } from "../src/renderer/src/components/common/DraftBar";
import { ModRowView as ModRow } from "../src/renderer/src/components/common/ModRow";
import { DraftChangesModal } from "../src/renderer/src/components/modals/DraftChangesModal";
import { applyDraftChanges } from "../src/renderer/src/services/draftActions";
import { createDraftStore } from "../src/renderer/src/stores/draftStore";
import {
  draftActions,
  draftStatuses,
  draftSteps,
  projectDraftPanels,
} from "../src/renderer/src/utils/drafts";
import { subscriptionActions, subscriptionCommands } from "../src/shared/domainConstants";
import { ipcChannels, validateIpcArgs } from "../src/shared/ipc";
import { requireValue } from "../src/shared/validation";
import { draftHarness, draftMod } from "./helpers/drafts";

const noop = () => undefined;
const mods = [draftMod("1", true), draftMod("2"), draftMod("3")];
const policy = { savedIds: new Set(mods.map((mod) => mod.id)), activeIds: new Set<string>() };

void test("drafts retain independent intents, deduplicate multi-selection and cancel opposite subscription intents", () => {
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
    [draftActions.subscribe],
  );
});

void test("draft staging is atomic for Active, unreadable, subscribed-removal, unsaved and local targets", () => {
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
    actions.stage([requireValue(mods[0])], draftActions.unsubscribe, {
      ...policy,
      activeError: "Disk unavailable",
    });
  }, /verified/);
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

void test("draft actions never mutate mod data and session restart discards only the draft", () => {
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
  actions.complete("steam-2");
  assert.deepEqual(
    store.getState().changes.map((change) => change.mod.id),
    ["steam-3"],
  );
  assert.equal(snapshot.length, 2);
  actions.endApply();
  const unlocked = store.getState();
  actions.complete("steam-3");
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
  actions.complete("missing");
  assert.equal(actions.beginApply(), undefined);
  actions.stage([requireValue(mods[1])], draftActions.unsubscribe, policy);
  assert.equal(calls, 0);
  actions.stage([requireValue(mods[1])], draftActions.subscribe, policy);
  actions.stage([requireValue(mods[1])], draftActions.subscribe, policy);
  assert.equal(calls, 1);
  stop();
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

void test("applying validates every group before mutations, follows visible steps and retains personal data", async () => {
  const harness = draftHarness();
  await applyDraftChanges(harness.changes, harness.store, harness.callbacks);
  assert.deepEqual(harness.events, [
    "load",
    `preview:${subscriptionActions.unsubscribeMods}`,
    `preview:${subscriptionActions.subscribeMods}`,
    "steam:steam-1:false",
    "steam:steam-2:true",
    "load",
    "delete:steam-3",
  ]);
  assert.deepEqual(harness.completed, ["steam-1", "steam-2", "steam-3"]);
  assert.deepEqual(
    [...new Set(harness.progress.map((value) => value.step))],
    Object.values(draftSteps),
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

void test("preflight rejects the entire draft before mutations if a removal is subscribed or an identity changed", async () => {
  for (const changed of [
    { ...draftMod("3"), subscribed: true },
    { ...draftMod("3"), workshopId: "changed" },
  ]) {
    const harness = draftHarness();
    harness.replace({
      ...harness.vault(),
      mods: harness.vault().mods.map((mod) => (mod.id === changed.id ? changed : mod)),
      localSteamState: {
        ...harness.vault().localSteamState,
        observedIds: changed.subscribed ? ["1", "3"] : ["1"],
      },
    });
    const before = JSON.stringify(harness.vault());
    await assert.rejects(
      applyDraftChanges(harness.changes, harness.store, harness.callbacks),
      /Subscribed|target changed/,
    );
    assert.deepEqual(harness.events, ["load"]);
    assert.deepEqual(harness.completed, []);
    assert.equal(JSON.stringify(harness.vault()), before);
  }
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

void test("native preview protection flags block all draft mutations", async () => {
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
    assert.deepEqual(harness.completed, []);
    assert.ok(!harness.events.some((event) => /^(steam:|delete:)/.test(event)));
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
  harness.failures.add("steam-2");
  await assert.rejects(
    applyDraftChanges(harness.changes, harness.store, harness.callbacks),
    /Steam failure/,
  );
  assert.deepEqual(harness.completed, ["steam-1"]);
  assert.equal(harness.vault().mods.find((mod) => mod.id === "steam-1")?.subscribed, false);
  assert.equal(harness.vault().mods.length, 3);
  assert.ok(!harness.events.some((event) => event.startsWith("delete:")));
  harness.failures.clear();
  await applyDraftChanges(
    harness.changes.filter((change) => !harness.completed.includes(change.mod.id)),
    harness.store,
    harness.callbacks,
  );
  assert.deepEqual(harness.completed, ["steam-1", "steam-2", "steam-3"]);
  assert.equal(harness.events.filter((event) => event === "steam:steam-1:false").length, 1);
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
  assert.deepEqual(harness.completed, ["steam-1", "steam-2"]);
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
  assert.equal(harness.progress.at(-1)?.step, draftSteps.unsubscribe);
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

void test("pending row indicators keep tags and replace mutation controls with undo", () => {
  const html = renderToStaticMarkup(
    <ModRow
      mod={requireValue(mods[0])}
      tags={[]}
      selected={false}
      active
      pendingAction={draftActions.unsubscribe}
      subscriptionAction={subscriptionCommands.unsubscribe}
      onSelect={noop}
      onToggle={noop}
      onUndoDraft={noop}
    />,
  );
  assert.match(html, /Active/);
  assert.match(html, /Pending unsubscribe/);
  assert.match(html, /Undo pending change for Mod 1/);
  assert.doesNotMatch(html, /aria-label="Unsubscribe from/);
  assert.match(
    renderToStaticMarkup(
      <DraftBar
        changes={draftHarness().changes}
        disabled={false}
        applying={false}
        onReview={noop}
        onDiscard={noop}
      />,
    ),
    /3 pending changes/,
  );
});

void test("single-change review and footer labels use singular wording", () => {
  const changes = [{ mod: requireValue(mods[1]), action: draftActions.subscribe }];
  const review = renderToStaticMarkup(
    <DraftChangesModal
      changes={changes}
      remainingCount={1}
      applying={false}
      onUndo={noop}
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
    />,
  );
  assert.match(footer, /1 pending change</);
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
