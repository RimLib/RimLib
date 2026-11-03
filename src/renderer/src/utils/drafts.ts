import type { ConstantValue } from "../../../shared/domainConstants";
import { isUsablePackageId, normalizePackageId, rimWorldPackages } from "../../../shared/packages";
import { isWorkshopMod } from "../../../shared/subscriptions";
import type { AppSettings, Mod } from "../../../shared/types";

export const draftActions = Object.freeze({
  subscribe: "subscribe",
  unsubscribe: "unsubscribe",
  activate: "activate",
  deactivate: "deactivate",
  remove: "remove",
} as const);
export type DraftAction = ConstantValue<typeof draftActions>;
export const draftActionLabels = Object.freeze({
  [draftActions.subscribe]: "Pending subscribe",
  [draftActions.unsubscribe]: "Pending unsubscribe",
  [draftActions.activate]: "Pending activation",
  [draftActions.deactivate]: "Pending deactivation",
  [draftActions.remove]: "Pending removal",
});
export const draftSteps = Object.freeze({
  validate: "validate",
  unsubscribe: "unsubscribe",
  subscribe: "subscribe",
  configure: "configure",
  remove: "remove",
  finish: "finish",
} as const);
export type DraftStep = ConstantValue<typeof draftSteps>;
export const draftStepLabels: Readonly<Record<DraftStep, string>> = Object.freeze({
  [draftSteps.validate]: "Check current state and protections",
  [draftSteps.unsubscribe]: "Unsubscribe Workshop mods",
  [draftSteps.subscribe]: "Subscribe Workshop mods",
  [draftSteps.configure]: "Update RimWorld active mods and load order",
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
export interface DraftActivityDelta {
  readonly activatedIds: ReadonlySet<string>;
  readonly deactivatedIds: ReadonlySet<string>;
}
export const activeOrderDraftKinds = Object.freeze({
  autoSort: "auto-sort",
  import: "import",
  manual: "manual",
} as const);
interface ActiveOrderDraftMove {
  readonly packageId: string;
  readonly modId: string;
  readonly modName: string;
  readonly fromPosition: number;
  readonly toPosition: number;
}

export type ActiveOrderDraftOperationInput = ActiveOrderDraftMove &
  (
    | {
        readonly kind: typeof activeOrderDraftKinds.autoSort;
      }
    | {
        readonly kind: typeof activeOrderDraftKinds.import;
        readonly fileName: string;
      }
    | {
        readonly kind: typeof activeOrderDraftKinds.manual;
        readonly method: "drag" | "position";
      }
  );
export type ActiveOrderDraftOperation = ActiveOrderDraftOperationInput & {
  readonly id: string;
};
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
  activePackageIds?: readonly string[];
  activeConfigTarget?: string;
  activeError?: string;
}

/** Stable identity for the configured ModsConfig target, including automatic discovery. */
export function normalizeActiveConfigTarget(
  settings?: Pick<AppSettings, "rimWorldConfigPath">,
): string {
  const configured = settings?.rimWorldConfigPath?.trim();
  return configured ? `configured:${configured}` : "automatic";
}

export function isSubscriptionDraftAction(action: DraftAction) {
  return action === draftActions.subscribe || action === draftActions.unsubscribe;
}

export function isActivityDraftAction(action: DraftAction) {
  return action === draftActions.activate || action === draftActions.deactivate;
}

/**
 * Derives the pending Active-membership delta by row identity. Draft staging normally guarantees
 * one activity intent per mod; resolving the last activity entry defensively keeps the result
 * unique and mutually exclusive for callers handling an arbitrary draft snapshot.
 */
export function deriveDraftActivityDelta(changes: readonly DraftChange[]): DraftActivityDelta {
  const activityById = new Map<string, DraftAction>();
  for (const change of changes) {
    if (isActivityDraftAction(change.action)) {
      activityById.set(change.mod.id, change.action);
    }
  }
  const activatedIds = new Set<string>();
  const deactivatedIds = new Set<string>();
  for (const [id, action] of activityById) {
    if (action === draftActions.activate) {
      activatedIds.add(id);
    } else {
      deactivatedIds.add(id);
    }
  }
  return { activatedIds, deactivatedIds };
}

/**
 * Builds the stable order template used while activity and load-order drafts coexist.
 * Pending deactivations stay in the template so undo can restore their position, while
 * newly activated packages append in the same chronology as their activity intentions.
 */
export function draftActiveOrderTemplate(
  basePackageIds: readonly string[],
  changes: readonly DraftChange[],
): string[] {
  const order = [...basePackageIds];
  const included = new Set(order.map(normalizePackageId));
  for (const change of changes) {
    if (change.action !== draftActions.activate || !change.mod.packageId) {
      continue;
    }
    const packageId = normalizePackageId(change.mod.packageId);
    if (!included.has(packageId)) {
      order.push(change.mod.packageId);
      included.add(packageId);
    }
  }
  return order;
}

/**
 * Rebind activity-only intentions after installed metadata replaces a temporary row identity.
 * Subscription and removal targets deliberately remain bound to their exact saved identities.
 */
export function rebaseActivityDraftChanges(
  changes: readonly DraftChange[],
  currentMods: readonly Mod[],
): readonly DraftChange[] {
  if (!changes.some((change) => isActivityDraftAction(change.action)) || !currentMods.length) {
    return changes;
  }

  const currentById = new Map(currentMods.map((mod) => [mod.id, mod]));
  const currentByPackage = new Map<string, Map<string, Mod>>();
  for (const mod of currentMods) {
    if (!isUsablePackageId(mod.packageId)) {
      continue;
    }
    const packageId = normalizePackageId(mod.packageId);
    const matches = currentByPackage.get(packageId) ?? new Map<string, Mod>();
    matches.set(mod.id, mod);
    currentByPackage.set(packageId, matches);
  }

  const reservedIds = new Set(
    changes.flatMap((change) =>
      isActivityDraftAction(change.action) && currentById.has(change.mod.id) ? [change.mod.id] : [],
    ),
  );
  const proposals = new Map<string, { index: number; mod: Mod }[]>();
  changes.forEach((change, index) => {
    if (
      !isActivityDraftAction(change.action) ||
      currentById.has(change.mod.id) ||
      !isUsablePackageId(change.mod.packageId)
    ) {
      return;
    }
    const matches = currentByPackage.get(normalizePackageId(change.mod.packageId));
    if (matches?.size !== 1) {
      return;
    }
    const mod = matches.values().next().value;
    if (!mod || reservedIds.has(mod.id)) {
      return;
    }
    proposals.set(mod.id, [...(proposals.get(mod.id) ?? []), { index, mod }]);
  });

  const replacements = new Map<number, Mod>();
  for (const proposed of proposals.values()) {
    if (proposed.length === 1) {
      const replacement = proposed[0];
      if (replacement) {
        replacements.set(replacement.index, replacement.mod);
      }
    }
  }
  if (!replacements.size) {
    return changes;
  }
  return changes.map((change, index) => {
    const mod = replacements.get(index);
    return mod ? { ...change, mod } : change;
  });
}

function actionCategory(action: DraftAction) {
  return isSubscriptionDraftAction(action)
    ? "subscription"
    : isActivityDraftAction(action)
      ? "activity"
      : "removal";
}

export function stageDraftChanges(
  current: readonly DraftChange[],
  mods: readonly Mod[],
  action: DraftAction,
  policy: DraftPolicy,
): readonly DraftChange[] {
  const activePackages = new Set(
    (policy.activePackageIds ?? []).map((packageId) => normalizePackageId(packageId)),
  );
  const pendingActivations = new Map(
    current.flatMap((change) =>
      change.action === draftActions.activate && change.mod.packageId
        ? [[normalizePackageId(change.mod.packageId), change.mod.id] as const]
        : [],
    ),
  );
  const pendingDeactivationPackages = new Set(
    current.flatMap((change) =>
      change.action === draftActions.deactivate &&
      policy.activeIds.has(change.mod.id) &&
      change.mod.packageId
        ? [normalizePackageId(change.mod.packageId)]
        : [],
    ),
  );
  const selectedActivations = new Map<string, string>();
  // Validate the whole selection before changing any draft entry.
  for (const mod of mods) {
    if (
      (isSubscriptionDraftAction(action) || action === draftActions.remove) &&
      !policy.savedIds.has(mod.id)
    ) {
      throw new Error("Sync Workshop to save these mods before drafting changes.");
    }
    if (isSubscriptionDraftAction(action) && !isWorkshopMod(mod)) {
      throw new Error("Local mods do not have Steam subscriptions.");
    }
    if (isActivityDraftAction(action) && !isUsablePackageId(mod.packageId)) {
      throw new Error("This mod has no usable package ID and cannot be activated.");
    }
    if (action === draftActions.activate && !policy.activeIds.has(mod.id)) {
      const packageId = normalizePackageId(mod.packageId ?? "");
      const pendingOwner = pendingActivations.get(packageId);
      const selectedOwner = selectedActivations.get(packageId);
      if (
        (activePackages.has(packageId) && !pendingDeactivationPackages.has(packageId)) ||
        (pendingOwner !== undefined && pendingOwner !== mod.id) ||
        (selectedOwner !== undefined && selectedOwner !== mod.id)
      ) {
        throw new Error(
          `${mod.name} cannot be activated because another row already uses package ID ${packageId}.`,
        );
      }
      selectedActivations.set(packageId, mod.id);
    }
    if (
      action === draftActions.deactivate &&
      mod.packageId &&
      normalizePackageId(mod.packageId) === rimWorldPackages.core
    ) {
      throw new Error("RimWorld Core must remain active.");
    }
    const pendingActivation = current.some(
      (change) => change.mod.id === mod.id && change.action === draftActions.activate,
    );
    const pendingUnsubscribe = current.some(
      (change) => change.mod.id === mod.id && change.action === draftActions.unsubscribe,
    );
    const pendingRemoval = current.some(
      (change) => change.mod.id === mod.id && change.action === draftActions.remove,
    );
    if (action === draftActions.activate && (pendingUnsubscribe || pendingRemoval)) {
      throw new Error("Undo the pending unsubscribe or removal before activating this mod.");
    }
    if (
      (action === draftActions.unsubscribe || action === draftActions.remove) &&
      pendingActivation
    ) {
      throw new Error("Undo the pending activation before unsubscribing or removing this mod.");
    }
    if (action === draftActions.unsubscribe && mod.subscribed) {
      const pendingDeactivation = current.some(
        (change) => change.mod.id === mod.id && change.action === draftActions.deactivate,
      );
      if (policy.activeIds.has(mod.id) && !pendingDeactivation) {
        throw new Error("Active mods cannot be unsubscribed.");
      }
    }
    const pendingDeactivation = current.some(
      (change) => change.mod.id === mod.id && change.action === draftActions.deactivate,
    );
    if (action === draftActions.remove && mod.subscribed && !pendingUnsubscribe) {
      throw new Error(
        "Apply the pending unsubscribe before removing a subscribed mod from the library.",
      );
    }
    if (action === draftActions.remove && policy.activeIds.has(mod.id) && !pendingDeactivation) {
      throw new Error("Deactivate this mod before removing it from the library.");
    }
  }
  const next = [...current];
  for (const mod of mods) {
    const category = actionCategory(action);
    const existingIndex = next.findIndex(
      (change) => change.mod.id === mod.id && actionCategory(change.action) === category,
    );
    const existing = existingIndex < 0 ? undefined : next[existingIndex];
    const restoring = isSubscriptionDraftAction(action)
      ? mod.subscribed === (action === draftActions.subscribe)
      : isActivityDraftAction(action)
        ? policy.activeIds.has(mod.id) === (action === draftActions.activate)
        : false;
    if (restoring) {
      if (existingIndex >= 0) {
        next.splice(existingIndex, 1);
      }
      continue;
    }
    if (existing?.action === action) {
      continue;
    }
    if (existingIndex >= 0) {
      next.splice(existingIndex, 1);
    }
    next.push({ mod, action });
  }
  const changes = next;
  return changes.length === current.length &&
    changes.every((change, index) => change === current[index])
    ? current
    : changes;
}

/**
 * Stage activation as one transaction. Workshop targets are first restored to a subscribed draft
 * state so applying the batch can subscribe them before writing RimWorld's active configuration.
 */
export function stageActivationChanges(
  current: readonly DraftChange[],
  mods: readonly Mod[],
  policy: DraftPolicy,
): readonly DraftChange[] {
  if (policy.activeError) {
    throw new Error("Active status could not be verified. Activation is disabled.");
  }
  const pendingUnsubscribes = new Set(
    current.flatMap((change) =>
      change.action === draftActions.unsubscribe ? [change.mod.id] : [],
    ),
  );
  const subscriptionTargets = mods.filter(
    (mod) => isWorkshopMod(mod) && (!mod.subscribed || pendingUnsubscribes.has(mod.id)),
  );
  const withSubscriptions = stageDraftChanges(
    current,
    subscriptionTargets,
    draftActions.subscribe,
    policy,
  );
  return stageDraftChanges(withSubscriptions, mods, draftActions.activate, policy);
}

/**
 * Stage library removal as one transaction. Workshop subscriptions are resolved first so an
 * actually subscribed mod is unsubscribed before deletion, while a pending subscribe is cancelled.
 */
export function stageLibraryRemovalChanges(
  current: readonly DraftChange[],
  mods: readonly Mod[],
  policy: DraftPolicy,
): readonly DraftChange[] {
  const withoutSubscriptions = stageDraftChanges(
    current,
    mods.filter(isWorkshopMod),
    draftActions.unsubscribe,
    policy,
  );
  return stageDraftChanges(withoutSubscriptions, mods, draftActions.remove, policy);
}

export function projectActivityPanels(
  inactive: readonly Mod[],
  active: readonly Mod[],
  changes: readonly DraftChange[],
  requestedOrder: readonly string[] = [],
) {
  // Preserve the current ModsConfig order first; newly activated entries then append naturally.
  const all = new Map([...active, ...inactive].map((mod) => [mod.id, mod]));
  const activity = new Set(active.map((mod) => mod.id));
  for (const change of changes) {
    if (change.action === draftActions.activate) {
      activity.add(change.mod.id);
    } else if (change.action === draftActions.deactivate) {
      activity.delete(change.mod.id);
    }
  }
  const projected = [...all.values()].map((mod) => {
    const subscription = changes.find(
      (change) => change.mod.id === mod.id && isSubscriptionDraftAction(change.action),
    );
    return subscription
      ? { ...mod, subscribed: subscription.action === draftActions.subscribe }
      : mod;
  });
  const activeMods = projected.filter((mod) => activity.has(mod.id));
  if (requestedOrder.length) {
    const positions = new Map(requestedOrder.map((id, index) => [normalizePackageId(id), index]));
    const original = new Map(activeMods.map((mod, index) => [mod.id, index]));
    const position = (mod: Mod) =>
      (mod.packageId ? positions.get(normalizePackageId(mod.packageId)) : undefined) ??
      requestedOrder.length + (original.get(mod.id) ?? 0);
    activeMods.sort((first, second) => position(first) - position(second));
  }
  const activeIds = new Set(activeMods.map((mod) => mod.id));
  return {
    inactive: projected.filter((mod) => !activeIds.has(mod.id)),
    active: activeMods,
    activeIds,
    activeOrder: new Map(activeMods.map((mod, index) => [mod.id, index + 1])),
  };
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
    activate: changes.filter((change) => change.action === draftActions.activate).length,
    deactivate: changes.filter((change) => change.action === draftActions.deactivate).length,
    remove: changes.filter((change) => change.action === draftActions.remove).length,
  };
}

export function draftOperationCount(
  changes: readonly DraftChange[],
  activeOrderOperationCount = 0,
): number {
  return changes.length + activeOrderOperationCount;
}

export function remainingDraftOperationCount(
  changes: readonly DraftChange[],
  activeOrderOperationCount: number,
  completed: number,
): number {
  return Math.max(0, draftOperationCount(changes, activeOrderOperationCount) - completed);
}
