import { withReadTimeout } from "../../../shared/async";
import { subscriptionActions } from "../../../shared/domainConstants";
import {
  isUsablePackageId,
  normalizePackageId,
  normalizePhysicalPackageId,
  rimWorldPackages,
} from "../../../shared/packages";
import type { ActiveModsState, AppSettings, ModStoreApi, ModVault } from "../../../shared/types";
import { requireValue } from "../../../shared/validation";
import { deleteLibraryModsExplicitly } from "../../../shared/vault";
import {
  type DraftAction,
  draftActions,
  type DraftChange,
  type DraftProgress,
  draftStatuses,
  draftSteps,
  isActivityDraftAction,
  isSubscriptionDraftAction,
  normalizeActiveConfigTarget,
} from "../utils/drafts";

type DraftAdapter = Pick<
  ModStoreApi,
  "load" | "previewLibrarySubscriptions" | "setSubscription" | "setActiveMods" | "deleteLibraryMods"
>;
interface DraftCallbacks {
  progress: (progress: DraftProgress) => void;
  adopt: (vault: ModVault) => void;
  adoptActive: (active: ActiveModsState) => void;
  complete: (id: string, action: DraftAction) => void;
  completeActiveOrder?: () => void;
}

export interface DraftApplyOptions {
  settings?: AppSettings;
  activeOrder?: readonly string[];
  activeOrderOperationCount?: number;
  expectedActivePackageIds?: readonly string[];
  expectedActiveConfigTarget?: string;
}

function validateTargets(
  vault: ModVault,
  changes: readonly DraftChange[],
  validateRemovals = false,
) {
  const seen = new Set<string>();
  const saved = new Map(vault.mods.map((mod) => [mod.id, mod]));
  for (const change of changes.filter(
    (entry) => isSubscriptionDraftAction(entry.action) || entry.action === draftActions.remove,
  )) {
    const key = `${change.mod.id}:${change.action}`;
    const mod = saved.get(change.mod.id);
    if (!mod || seen.has(key) || mod.workshopId !== change.mod.workshopId) {
      throw new Error(
        "A draft target changed or is no longer saved. Review the pending changes; nothing else was applied.",
      );
    }
    seen.add(key);
  }
  const removals = changes.filter((change) => change.action === draftActions.remove);
  if (validateRemovals && removals.length) {
    deleteLibraryModsExplicitly(
      vault,
      removals.map((change) => change.mod.id),
    );
  }
}

function finalActiveOrder(
  changes: readonly DraftChange[],
  options: DraftApplyOptions,
): string[] | undefined {
  const activeChanges = changes.filter((change) => isActivityDraftAction(change.action));
  if (!activeChanges.length && !options.activeOrder) {
    return undefined;
  }
  const expected = options.expectedActivePackageIds;
  if (!expected?.length) {
    throw new Error("The active mod draft has no verified ModsConfig baseline.");
  }
  if (!options.expectedActiveConfigTarget) {
    throw new Error("The active mod draft has no verified ModsConfig target.");
  }
  if (options.expectedActiveConfigTarget !== normalizeActiveConfigTarget(options.settings)) {
    throw new Error(
      "The RimWorld ModsConfig target changed after this draft was created. Review or discard the pending active-mod changes before applying.",
    );
  }
  const expectedKeys = expected.map((id) => normalizePackageId(id));
  const expectedKeySet = new Set(expectedKeys);
  if (expectedKeySet.size !== expectedKeys.length) {
    throw new Error("The active mod baseline contains duplicate package identifiers.");
  }
  const desired = new Map(expected.map((id) => [normalizePackageId(id), id]));
  const checkedPackageId = (change: DraftChange) => {
    const packageId = change.mod.packageId;
    if (!isUsablePackageId(packageId)) {
      throw new Error(`${change.mod.name} has no usable package ID.`);
    }
    return { packageId, key: normalizePackageId(packageId) };
  };
  const activations = activeChanges
    .filter((entry) => entry.action === draftActions.activate)
    .map((change) => ({ change, ...checkedPackageId(change) }));
  const activationByPackage = new Map<string, (typeof activations)[number]>();
  for (const activation of activations) {
    if (activationByPackage.has(activation.key)) {
      throw new Error(
        `${activation.change.mod.name} cannot be activated because package ID ${activation.key} is duplicated in the draft.`,
      );
    }
    activationByPackage.set(activation.key, activation);
  }

  // Membership is a package-level set. A paired deactivate/activate replaces the exact Map value
  // in place, preserving that package's load-order slot while changing its physical source.
  const pairedActivations = new Set<string>();
  for (const change of activeChanges.filter((entry) => entry.action === draftActions.deactivate)) {
    const { key } = checkedPackageId(change);
    const replacement = activationByPackage.get(key);
    if (replacement) {
      if (!desired.has(key)) {
        throw new Error(
          `${replacement.change.mod.name} cannot replace package ID ${key} because it is not active.`,
        );
      }
      desired.set(key, replacement.packageId);
      pairedActivations.add(key);
    } else {
      desired.delete(key);
    }
  }
  for (const { change, packageId, key } of activations) {
    if (pairedActivations.has(key)) {
      continue;
    }
    if (desired.has(key)) {
      throw new Error(
        `${change.mod.name} cannot be activated because package ID ${key} is already active or duplicated in the draft.`,
      );
    }
    desired.set(key, packageId);
  }
  let order = [...desired.values()];
  if (options.activeOrder) {
    const requested = options.activeOrder.map(normalizePackageId);
    const requestedDesired = requested.filter((id) => desired.has(id));
    if (
      new Set(requested).size !== requested.length ||
      requestedDesired.length !== desired.size ||
      requestedDesired.some((id, index) => requestedDesired.indexOf(id) !== index) ||
      [...desired.keys()].some((id) => !requestedDesired.includes(id))
    ) {
      throw new Error("The proposed active load order no longer matches the draft membership.");
    }
    // The order template deliberately retains baseline mods with pending deactivation. This lets
    // an activity undo restore their staged position without destroying unrelated order changes.
    order = requestedDesired.map((id) => requireValue(desired.get(id)));
  }
  if (!order.some((id) => normalizePackageId(id) === rimWorldPackages.core)) {
    throw new Error("RimWorld Core must remain active.");
  }
  return order;
}

export async function applyDraftChanges(
  changes: readonly DraftChange[],
  store: DraftAdapter,
  callbacks: DraftCallbacks,
  options: DraftApplyOptions = {},
) {
  const proposedActiveOrder = finalActiveOrder(changes, options);
  if (!changes.length && !proposedActiveOrder) {
    throw new Error("No pending changes to apply.");
  }
  const report = (
    step: DraftProgress["step"],
    completed: number,
    total: number,
    message: string,
  ) => {
    callbacks.progress({ step, completed, total, message, status: draftStatuses.running });
  };
  report(draftSteps.validate, 0, 1, "Reading the saved library");
  let vault = await withReadTimeout(
    store.load(),
    "Checking the library timed out. Draft changes were retained.",
  );
  validateTargets(vault, changes);
  const unsubscribing = changes.filter((change) => change.action === draftActions.unsubscribe);
  const subscribing = changes.filter((change) => change.action === draftActions.subscribe);
  const activeChanges = changes.filter((change) => isActivityDraftAction(change.action));
  const removals = changes.filter((change) => change.action === draftActions.remove);

  if (subscribing.length) {
    report(draftSteps.validate, 0, 1, "Checking Workshop subscription targets");
    const plan = await store.previewLibrarySubscriptions(
      subscriptionActions.subscribeMods,
      subscribing.map((change) => change.mod.id),
    );
    vault = plan.vault;
    callbacks.adopt(vault);
    validateTargets(vault, changes);
  }
  for (const [index, change] of subscribing.entries()) {
    report(draftSteps.subscribe, index, subscribing.length, `Subscribing ${change.mod.name}`);
    const result = await store.setSubscription(
      change.mod.id,
      true,
      requireValue(change.mod.workshopId),
    );
    vault = result.vault;
    callbacks.adopt(vault);
    callbacks.adoptActive(result.activeMods);
    if (result.failures.length) {
      throw new Error(result.failures.join("; "));
    }
    callbacks.complete(change.mod.id, change.action);
    report(draftSteps.subscribe, index + 1, subscribing.length, `${change.mod.name} subscribed`);
  }

  if (proposedActiveOrder) {
    report(
      draftSteps.configure,
      0,
      1,
      activeChanges.length ? "Updating active mods and load order" : "Updating active load order",
    );
    const nextActive = await store.setActiveMods(options.settings, proposedActiveOrder, [
      ...requireValue(options.expectedActivePackageIds),
    ]);
    callbacks.adoptActive(nextActive);
    if (nextActive.error) {
      throw new Error(
        `RimWorld's active mod configuration could not be verified after writing. ${nextActive.error}`,
      );
    }
    const returnedOrder = nextActive.packageIds.map(normalizePhysicalPackageId);
    const proposedOrder = proposedActiveOrder.map(normalizePhysicalPackageId);
    if (
      returnedOrder.length !== proposedOrder.length ||
      returnedOrder.some((packageId, index) => packageId !== proposedOrder[index])
    ) {
      throw new Error(
        "RimWorld's active mod configuration changed before the update could be verified. Pending active-mod changes were retained.",
      );
    }
    activeChanges.forEach((change) => {
      callbacks.complete(change.mod.id, change.action);
    });
    callbacks.completeActiveOrder?.();
    report(draftSteps.configure, 1, 1, "RimWorld active mod configuration updated");
  }

  if (unsubscribing.length) {
    report(draftSteps.validate, 0, 1, "Checking Active protection and Steam subscriptions");
    const plan = await store.previewLibrarySubscriptions(
      subscriptionActions.unsubscribeMods,
      unsubscribing.map((change) => change.mod.id),
    );
    vault = plan.vault;
    callbacks.adopt(vault);
    if (plan.activeCount || plan.activeError) {
      throw new Error(
        "Active status could not be verified or a draft contains Active mods. No unsubscribe was performed.",
      );
    }
    validateTargets(vault, changes);
  }
  for (const [index, change] of unsubscribing.entries()) {
    report(draftSteps.unsubscribe, index, unsubscribing.length, `Unsubscribing ${change.mod.name}`);
    const result = await store.setSubscription(
      change.mod.id,
      false,
      requireValue(change.mod.workshopId),
    );
    vault = result.vault;
    callbacks.adopt(vault);
    callbacks.adoptActive(result.activeMods);
    if (result.failures.length) {
      throw new Error(result.failures.join("; "));
    }
    callbacks.complete(change.mod.id, change.action);
    report(
      draftSteps.unsubscribe,
      index + 1,
      unsubscribing.length,
      `${change.mod.name} unsubscribed`,
    );
  }

  if (removals.length) {
    report(
      draftSteps.remove,
      0,
      removals.length,
      "Rechecking removals and creating a database backup",
    );
    vault = await withReadTimeout(
      store.load(),
      "Rechecking library removals timed out. Removals were retained in the draft.",
    );
    validateTargets(vault, removals, true);
    vault = await store.deleteLibraryMods(removals.map((change) => change.mod.id));
    callbacks.adopt(vault);
    removals.forEach((change) => {
      callbacks.complete(change.mod.id, change.action);
    });
    report(
      draftSteps.remove,
      removals.length,
      removals.length,
      "Library records removed; remaining records and tags retained",
    );
  }
  const activeOrderOperationCount = options.activeOrder
    ? Math.max(1, options.activeOrderOperationCount ?? 1)
    : 0;
  const total = changes.length + activeOrderOperationCount;
  callbacks.progress({
    step: draftSteps.finish,
    completed: total,
    total,
    message: proposedActiveOrder
      ? "Changes applied; RimWorld active configuration updated"
      : "Changes applied",
    status: draftStatuses.complete,
  });
}
