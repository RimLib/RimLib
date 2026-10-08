import type { ConstantValue } from "../../../shared/domainConstants";
import { isWorkshopMod } from "../../../shared/subscriptions";
import type { Mod } from "../../../shared/types";

export const draftActions = Object.freeze({
  subscribe: "subscribe",
  unsubscribe: "unsubscribe",
  remove: "remove",
} as const);
export type DraftAction = ConstantValue<typeof draftActions>;
export const draftActionLabels = Object.freeze({
  [draftActions.subscribe]: "Pending subscribe",
  [draftActions.unsubscribe]: "Pending unsubscribe",
  [draftActions.remove]: "Pending removal",
});
export const draftSteps = Object.freeze({
  validate: "validate",
  unsubscribe: "unsubscribe",
  subscribe: "subscribe",
  remove: "remove",
  finish: "finish",
} as const);
export type DraftStep = ConstantValue<typeof draftSteps>;
export const draftStepLabels: Readonly<Record<DraftStep, string>> = Object.freeze({
  [draftSteps.validate]: "Check current state and protections",
  [draftSteps.unsubscribe]: "Unsubscribe Workshop mods",
  [draftSteps.subscribe]: "Subscribe Workshop mods",
  [draftSteps.remove]: "Back up and remove library records",
  [draftSteps.finish]: "Finish and retain unresolved changes",
});
export const draftStatuses = Object.freeze({
  running: "running",
  complete: "complete",
  failed: "failed",
} as const);
export type DraftStatus = ConstantValue<typeof draftStatuses>;

export interface DraftChange {
  readonly mod: Mod;
  readonly action: DraftAction;
}
export interface DraftProgress {
  step: DraftStep;
  status: DraftStatus;
  completed: number;
  total: number;
  message: string;
}
export interface DraftPolicy {
  savedIds: ReadonlySet<string>;
  activeIds: ReadonlySet<string>;
  activeError?: string;
}

export function stageDraftChanges(
  current: readonly DraftChange[],
  mods: readonly Mod[],
  action: DraftAction,
  policy: DraftPolicy,
): readonly DraftChange[] {
  // Validate the whole selection before changing any draft entry.
  for (const mod of mods) {
    if (!policy.savedIds.has(mod.id)) {
      throw new Error("Sync Workshop to save these mods before drafting changes.");
    }
    if (action !== draftActions.remove && !isWorkshopMod(mod)) {
      throw new Error("Local mods do not have Steam subscriptions.");
    }
    if (action === draftActions.unsubscribe && mod.subscribed) {
      if (policy.activeIds.has(mod.id)) {
        throw new Error("Active mods cannot be unsubscribed.");
      }
      if (policy.activeError) {
        throw new Error("Active status could not be verified. Unsubscribe is disabled.");
      }
    }
    if (action === draftActions.remove && mod.subscribed) {
      throw new Error(
        "Apply the pending unsubscribe before removing a subscribed mod from the library.",
      );
    }
  }
  const next = new Map(current.map((change) => [change.mod.id, change]));
  for (const mod of mods) {
    const restoring =
      action !== draftActions.remove && mod.subscribed === (action === draftActions.subscribe);
    if (restoring) {
      next.delete(mod.id);
    } else if (next.get(mod.id)?.action !== action) {
      next.set(mod.id, { mod, action });
    }
  }
  const changes = [...next.values()];
  return changes.length === current.length &&
    changes.every((change, index) => change === current[index])
    ? current
    : changes;
}

export function projectDraftPanels(
  library: readonly Mod[],
  subscribed: readonly Mod[],
  changes: readonly DraftChange[],
  activeIds: ReadonlySet<string> = new Set(),
) {
  const intents = new Map(changes.map((change) => [change.mod.id, change.action]));
  const all = [
    ...library.map((mod) => (mod.subscribed ? { ...mod, subscribed: false } : mod)),
    ...subscribed.map((mod) => (mod.subscribed ? mod : { ...mod, subscribed: true })),
  ];
  const projected = all.map((mod) => {
    const action = intents.get(mod.id);
    if (action === draftActions.subscribe) {
      return { ...mod, subscribed: true };
    }
    if (action === draftActions.unsubscribe && !activeIds.has(mod.id)) {
      return { ...mod, subscribed: false };
    }
    return mod;
  });
  return {
    unsubscribed: projected.filter((mod) => !mod.subscribed),
    subscribed: projected.filter((mod) => mod.subscribed),
  };
}

export function draftCounts(changes: readonly DraftChange[]) {
  return {
    subscribe: changes.filter((change) => change.action === draftActions.subscribe).length,
    unsubscribe: changes.filter((change) => change.action === draftActions.unsubscribe).length,
    remove: changes.filter((change) => change.action === draftActions.remove).length,
  };
}
