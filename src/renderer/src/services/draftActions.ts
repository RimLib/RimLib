import { withReadTimeout } from "../../../shared/async";
import { subscriptionActions } from "../../../shared/domainConstants";
import type { ActiveModsState, ModStoreApi, ModVault } from "../../../shared/types";
import { requireValue } from "../../../shared/validation";
import { deleteLibraryModsExplicitly } from "../../../shared/vault";
import {
  draftActions,
  type DraftChange,
  type DraftProgress,
  draftStatuses,
  draftSteps,
} from "../utils/drafts";

type DraftAdapter = Pick<
  ModStoreApi,
  "load" | "previewLibrarySubscriptions" | "setSubscription" | "deleteLibraryMods"
>;
interface DraftCallbacks {
  progress: (progress: DraftProgress) => void;
  adopt: (vault: ModVault) => void;
  adoptActive: (active: ActiveModsState) => void;
  complete: (id: string) => void;
}

function validateTargets(vault: ModVault, changes: readonly DraftChange[]) {
  const seen = new Set<string>();
  const saved = new Map(vault.mods.map((mod) => [mod.id, mod]));
  for (const change of changes) {
    const mod = saved.get(change.mod.id);
    if (!mod || seen.has(mod.id) || mod.workshopId !== change.mod.workshopId) {
      throw new Error(
        "A draft target changed or is no longer saved. Review the pending changes; nothing else was applied.",
      );
    }
    seen.add(mod.id);
  }
  const removals = changes.filter((change) => change.action === draftActions.remove);
  if (removals.length) {
    deleteLibraryModsExplicitly(
      vault,
      removals.map((change) => change.mod.id),
    );
  }
}

export async function applyDraftChanges(
  changes: readonly DraftChange[],
  store: DraftAdapter,
  callbacks: DraftCallbacks,
) {
  if (!changes.length) {
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
  const removals = changes.filter((change) => change.action === draftActions.remove);
  // Native previews validate each complete group before the first Steam mutation.
  for (const [group, action] of [
    [unsubscribing, subscriptionActions.unsubscribeMods],
    [subscribing, subscriptionActions.subscribeMods],
  ] as const) {
    if (!group.length) {
      continue;
    }
    report(
      draftSteps.validate,
      0,
      1,
      action === subscriptionActions.unsubscribeMods
        ? "Checking Active protection and Steam subscriptions"
        : "Checking Workshop subscription targets",
    );
    const plan = await store.previewLibrarySubscriptions(
      action,
      group.map((change) => change.mod.id),
    );
    vault = plan.vault;
    callbacks.adopt(vault);
    if (action === subscriptionActions.unsubscribeMods && (plan.activeCount || plan.activeError)) {
      throw new Error(
        "Active status could not be verified or a draft contains Active mods. No unsubscribe was performed.",
      );
    }
  }
  validateTargets(vault, changes);
  for (const [group, subscribed, step] of [
    [unsubscribing, false, draftSteps.unsubscribe],
    [subscribing, true, draftSteps.subscribe],
  ] as const) {
    for (const [index, change] of group.entries()) {
      report(
        step,
        index,
        group.length,
        `${subscribed ? "Subscribing" : "Unsubscribing"} ${change.mod.name}`,
      );
      const result = await store.setSubscription(
        change.mod.id,
        subscribed,
        requireValue(change.mod.workshopId),
      );
      vault = result.vault;
      callbacks.adopt(vault);
      callbacks.adoptActive(result.activeMods);
      if (result.failures.length) {
        throw new Error(result.failures.join("; "));
      }
      callbacks.complete(change.mod.id);
      report(
        step,
        index + 1,
        group.length,
        `${change.mod.name} ${subscribed ? "subscribed" : "unsubscribed"}`,
      );
    }
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
    validateTargets(vault, removals);
    vault = await store.deleteLibraryMods(removals.map((change) => change.mod.id));
    callbacks.adopt(vault);
    removals.forEach((change) => {
      callbacks.complete(change.mod.id);
    });
    report(
      draftSteps.remove,
      removals.length,
      removals.length,
      "Library records removed; subscribed records and tags retained",
    );
  }
  callbacks.progress({
    step: draftSteps.finish,
    completed: changes.length,
    total: changes.length,
    message: "Changes applied; RimWorld configuration unchanged",
    status: draftStatuses.complete,
  });
}
