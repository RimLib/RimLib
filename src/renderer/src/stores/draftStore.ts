import { createStore, type StoreApi } from "zustand/vanilla";

import { modListLimits } from "../../../shared/limits";
import { getOfficialContent } from "../../../shared/officialContent";
import {
  isOfficialMod,
  isUsablePackageId,
  normalizePackageId,
  rimWorldPackages,
} from "../../../shared/packages";
import type { Mod, PendingDraft, PendingDraftTarget } from "../../../shared/types";
import { requireValue } from "../../../shared/validation";
import { deriveActiveOrderMoves } from "../utils/activeOrder";
import {
  activeOrderDraftKinds,
  type ActiveOrderDraftOperation,
  type ActiveOrderDraftOperationInput,
  type DraftAction,
  draftActions,
  draftActiveOrderTemplate,
  type DraftChange,
  type DraftPolicy,
  type DraftProgress,
  isActivityDraftAction,
  rebaseActivityDraftChanges,
  stageActivationChanges,
  stageDraftChanges,
  stageLibraryRemovalChanges,
} from "../utils/drafts";

function hasActivityDraft(changes: readonly DraftChange[]): boolean {
  return changes.some((change) => isActivityDraftAction(change.action));
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) {
      return true;
    }
  }
  return false;
}

function samePackageOrder(first: readonly string[], second: readonly string[]): boolean {
  return (
    first.length === second.length &&
    first.every(
      (packageId, index) =>
        normalizePackageId(packageId) === normalizePackageId(second[index] ?? ""),
    )
  );
}

function activeMembership(
  basePackageIds: readonly string[],
  changes: readonly DraftChange[],
): Set<string> {
  const active = new Set(basePackageIds.map(normalizePackageId));
  for (const change of changes) {
    if (!isActivityDraftAction(change.action) || !change.mod.packageId) {
      continue;
    }
    const packageId = normalizePackageId(change.mod.packageId);
    if (change.action === draftActions.activate) {
      active.add(packageId);
    } else {
      active.delete(packageId);
    }
  }
  return active;
}

function visibleActiveOrder(
  order: readonly string[],
  basePackageIds: readonly string[],
  changes: readonly DraftChange[],
): string[] {
  const active = activeMembership(basePackageIds, changes);
  return order.filter((packageId) => active.has(normalizePackageId(packageId)));
}

function projectActiveOrder(
  basePackageIds: readonly string[],
  changes: readonly DraftChange[],
  operations: readonly ActiveOrderDraftOperation[],
  operationMemberships: ReadonlyMap<string, readonly string[]>,
): string[] {
  const currentMembership = activeMembership(basePackageIds, changes);
  let order = draftActiveOrderTemplate(basePackageIds, changes);

  for (const operation of operations) {
    // Replay against the membership that was visible when this move was staged. A later
    // deactivation may hide a package, but it must not rewrite the retained ordering intent.
    const capturedMembership = operationMemberships.get(operation.id);
    const membership = capturedMembership
      ? new Set(capturedMembership.map(normalizePackageId))
      : currentMembership;
    const visible = order.filter((packageId) => membership.has(normalizePackageId(packageId)));
    const sourceIndex = visible.findIndex(
      (packageId) => normalizePackageId(packageId) === normalizePackageId(operation.packageId),
    );
    if (sourceIndex < 0 || !visible.length) {
      continue;
    }
    const targetIndex = Math.min(Math.max(0, operation.toPosition - 1), visible.length - 1);
    if (sourceIndex === targetIndex) {
      continue;
    }
    const reordered = [...visible];
    const [moved] = reordered.splice(sourceIndex, 1);
    if (!moved) {
      continue;
    }
    reordered.splice(targetIndex, 0, moved);
    let visibleIndex = 0;
    order = order.map((packageId) =>
      membership.has(normalizePackageId(packageId))
        ? (reordered[visibleIndex++] ?? packageId)
        : packageId,
    );
  }
  return order;
}

/** Rebuild the projected order so membership edits and individual order undo stay independent. */
function replayActiveOrder(
  basePackageIds: readonly string[],
  changes: readonly DraftChange[],
  operations: readonly ActiveOrderDraftOperation[],
  operationMemberships: ReadonlyMap<string, readonly string[]>,
): string[] {
  return projectActiveOrder(basePackageIds, changes, operations, operationMemberships);
}

function pendingDraftTarget(mod: Mod): PendingDraftTarget {
  return {
    id: mod.id,
    name: mod.name,
    source: mod.source,
    ...(mod.packageId === undefined ? {} : { packageId: mod.packageId }),
    ...(mod.workshopId === undefined ? {} : { workshopId: mod.workshopId }),
    ...(mod.localPath === undefined ? {} : { localPath: mod.localPath }),
  };
}

function unresolvedPendingDraftMod(target: PendingDraftTarget): Mod {
  return {
    ...target,
    author: "Unknown author",
    summary: "Pending draft target. Current metadata is unavailable.",
    subscribed: false,
    downloadedAt: "",
    addedAt: "",
    tags: [],
    gameVersions: [],
    screenshots: [],
  };
}

function resolvePendingDraftMod(
  target: PendingDraftTarget,
  action: DraftAction,
  currentMods: readonly Mod[],
): Mod {
  const exact = currentMods.find((mod) => mod.id === target.id);
  if (!isActivityDraftAction(action)) {
    return exact && exact.workshopId === target.workshopId
      ? exact
      : unresolvedPendingDraftMod(target);
  }

  const targetPackageId = target.packageId;
  if (!isUsablePackageId(targetPackageId)) {
    return unresolvedPendingDraftMod(target);
  }
  const packageId = normalizePackageId(targetPackageId);
  if (
    exact &&
    isUsablePackageId(exact.packageId) &&
    normalizePackageId(exact.packageId) === packageId
  ) {
    return exact;
  }
  const matches = currentMods.filter(
    (mod) => isUsablePackageId(mod.packageId) && normalizePackageId(mod.packageId) === packageId,
  );
  return matches.length === 1 ? requireValue(matches[0]) : unresolvedPendingDraftMod(target);
}

function orderOperationNumber(operationId: string): number {
  const value = Number(operationId.slice("order-".length));
  if (
    !/^order-[1-9]\d*$/.test(operationId) ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > Number.MAX_SAFE_INTEGER - modListLimits.maxEntries
  ) {
    throw new Error("The saved pending draft contains an invalid load-order operation ID.");
  }
  return value;
}

interface DraftState {
  readonly changes: readonly DraftChange[];
  readonly activeOrder?: readonly string[];
  readonly activeOrderOperations: readonly ActiveOrderDraftOperation[];
  readonly activeBasePackageIds?: readonly string[];
  readonly activeBaseConfigTarget?: string;
  readonly applying: boolean;
  readonly reviewOpen: boolean;
  readonly reviewBatch?: readonly DraftChange[];
  readonly reviewActiveOrder?: readonly string[];
  readonly reviewActiveOrderOperations?: readonly ActiveOrderDraftOperation[];
  readonly progress?: DraftProgress;
  readonly actions: {
    stage: (mods: readonly Mod[], action: DraftAction, policy: DraftPolicy) => void;
    stageActivation: (mods: readonly Mod[], policy: DraftPolicy) => void;
    stageImportedActiveList: (
      currentActiveMods: readonly Mod[],
      targetMods: readonly Mod[],
      policy: DraftPolicy,
      fileName: string,
    ) => void;
    stageRemoval: (mods: readonly Mod[], policy: DraftPolicy) => void;
    rebaseActivityChanges: (mods: readonly Mod[]) => void;
    setActiveOrder: (
      packageIds: readonly string[],
      basePackageIds: readonly string[],
      baseConfigTarget: string,
      operation: ActiveOrderDraftOperationInput,
    ) => void;
    replaceActiveOrder: (
      packageIds: readonly string[],
      basePackageIds: readonly string[],
      baseConfigTarget: string,
      operations: readonly ActiveOrderDraftOperationInput[],
    ) => void;
    getPendingDraft: () => PendingDraft | undefined;
    hydratePendingDraft: (draft: PendingDraft | undefined, currentMods: readonly Mod[]) => void;
    undoActiveOrder: (operationId: string) => void;
    undoAction: (id: string, action: DraftAction) => void;
    undo: (id: string) => void;
    discard: () => void;
    openReview: () => void;
    closeReview: () => void;
    reportProgress: (progress: DraftProgress) => void;
    beginApply: () => readonly DraftChange[] | undefined;
    complete: (id: string, action: DraftAction) => void;
    completeActiveOrder: () => void;
    endApply: () => void;
  };
}
export type DraftStore = Pick<StoreApi<DraftState>, "getState" | "getInitialState" | "subscribe">;

export function createDraftStore(): DraftStore {
  let nextActiveOrderOperationId = 0;
  const activeOrderMemberships = new Map<string, readonly string[]>();
  const store = createStore<DraftState>()((set, get) => ({
    changes: [],
    activeOrder: undefined,
    activeOrderOperations: [],
    activeBasePackageIds: undefined,
    activeBaseConfigTarget: undefined,
    applying: false,
    reviewOpen: false,
    reviewBatch: undefined,
    progress: undefined,
    actions: {
      stage: (mods, action, policy) => {
        set((state) => {
          if (state.applying) {
            return state;
          }
          const changes = stageDraftChanges(state.changes, mods, action, policy);
          if (changes === state.changes) {
            return state;
          }
          const hasActiveChanges = hasActivityDraft(changes);
          const hasOrderChanges = state.activeOrderOperations.length > 0;
          const basePackageIds = state.activeBasePackageIds ?? policy.activePackageIds;
          const activeOrder =
            isActivityDraftAction(action) && hasOrderChanges && basePackageIds
              ? replayActiveOrder(
                  basePackageIds,
                  changes,
                  state.activeOrderOperations,
                  activeOrderMemberships,
                )
              : state.activeOrder;
          return {
            changes,
            activeOrder,
            activeOrderOperations: state.activeOrderOperations,
            activeBasePackageIds: hasActiveChanges || hasOrderChanges ? basePackageIds : undefined,
            activeBaseConfigTarget:
              hasActiveChanges || hasOrderChanges
                ? (state.activeBaseConfigTarget ?? policy.activeConfigTarget)
                : undefined,
          };
        });
      },
      stageActivation: (mods, policy) => {
        set((state) => {
          if (state.applying) {
            return state;
          }
          const changes = stageActivationChanges(state.changes, mods, policy);
          if (changes === state.changes) {
            return state;
          }
          const hasActiveChanges = hasActivityDraft(changes);
          const hasOrderChanges = state.activeOrderOperations.length > 0;
          const basePackageIds = state.activeBasePackageIds ?? policy.activePackageIds;
          return {
            changes,
            activeOrder:
              hasOrderChanges && basePackageIds
                ? replayActiveOrder(
                    basePackageIds,
                    changes,
                    state.activeOrderOperations,
                    activeOrderMemberships,
                  )
                : undefined,
            activeOrderOperations: state.activeOrderOperations,
            activeBasePackageIds: hasActiveChanges || hasOrderChanges ? basePackageIds : undefined,
            activeBaseConfigTarget:
              hasActiveChanges || hasOrderChanges
                ? (state.activeBaseConfigTarget ?? policy.activeConfigTarget)
                : undefined,
          };
        });
      },
      stageImportedActiveList: (currentActiveMods, targetMods, policy, fileName) => {
        set((state) => {
          if (state.applying) {
            throw new Error("Wait for the current draft to finish applying before importing.");
          }
          if (state.changes.length || state.activeOrderOperations.length) {
            throw new Error("Apply or discard the pending draft before importing a mod list.");
          }
          if (policy.activeError) {
            throw new Error("Active status could not be verified. Import is disabled.");
          }
          const basePackageIds = policy.activePackageIds;
          if (!basePackageIds) {
            throw new Error("The imported mod list has no verified ModsConfig baseline.");
          }
          if (!policy.activeConfigTarget) {
            throw new Error("The imported mod list has no verified ModsConfig target.");
          }

          const fileNameParts = fileName.trim().split(/[\\/]/);
          const displayFileName = fileNameParts[fileNameParts.length - 1]?.trim();
          if (
            !displayFileName ||
            displayFileName.length > 255 ||
            containsControlCharacter(displayFileName)
          ) {
            throw new Error("The imported mod-list file name is invalid.");
          }

          const collectPackages = (mods: readonly Mod[], label: string) => {
            const rowIds = new Set<string>();
            const packageIds = new Set<string>();
            return mods.map((mod) => {
              if (!mod.id || rowIds.has(mod.id)) {
                throw new Error(`${label} contains a duplicate mod row.`);
              }
              rowIds.add(mod.id);
              if (!isUsablePackageId(mod.packageId)) {
                throw new Error(`${mod.name} has no usable package ID and cannot be imported.`);
              }
              const packageId = normalizePackageId(mod.packageId);
              if (packageIds.has(packageId)) {
                throw new Error(`${label} contains duplicate package ID ${packageId}.`);
              }
              packageIds.add(packageId);
              return packageId;
            });
          };
          const currentPackageIds = collectPackages(currentActiveMods, "The current Active list");
          const targetPackageIds = collectPackages(targetMods, "The imported Active list");
          if (
            targetMods.some(
              (mod) =>
                getOfficialContent(mod.packageId ?? "") !== undefined &&
                (/_steam$/i.test(mod.packageId ?? "") || !isOfficialMod(mod)),
            )
          ) {
            throw new Error(
              "Official RimWorld content must resolve to its trusted local installation.",
            );
          }
          const baseNormalized = basePackageIds.map((packageId) => {
            if (!isUsablePackageId(packageId)) {
              throw new Error("The current ModsConfig contains an unusable package ID.");
            }
            return normalizePackageId(packageId);
          });
          if (
            new Set(baseNormalized).size !== baseNormalized.length ||
            !samePackageOrder(baseNormalized, currentPackageIds)
          ) {
            throw new Error(
              "The current Active list changed before the imported mod list could be staged.",
            );
          }
          if (
            policy.activeIds.size !== currentActiveMods.length ||
            currentActiveMods.some((mod) => !policy.activeIds.has(mod.id))
          ) {
            throw new Error(
              "The current Active rows changed before the imported mod list could be staged.",
            );
          }
          if (
            targetPackageIds.filter((packageId) => packageId === rimWorldPackages.core).length !== 1
          ) {
            throw new Error("An imported mod list must contain RimWorld Core exactly once.");
          }

          const currentPackageById = new Map(
            currentActiveMods.map((mod) => [mod.id, normalizePackageId(mod.packageId ?? "")]),
          );
          targetMods.forEach((mod) => {
            const currentPackageId = currentPackageById.get(mod.id);
            if (currentPackageId && currentPackageId !== normalizePackageId(mod.packageId ?? "")) {
              throw new Error("A mod row changed package ID while the import was being staged.");
            }
          });

          const currentIds = new Set(currentActiveMods.map((mod) => mod.id));
          const targetIds = new Set(targetMods.map((mod) => mod.id));
          const outgoing = currentActiveMods.filter((mod) => !targetIds.has(mod.id));
          const incoming = targetMods.filter((mod) => !currentIds.has(mod.id));
          const incomingPackages = new Set(
            incoming.map((mod) => normalizePackageId(mod.packageId ?? "")),
          );
          const coreReplacements = outgoing.filter(
            (mod) =>
              normalizePackageId(mod.packageId ?? "") === rimWorldPackages.core &&
              incomingPackages.has(rimWorldPackages.core),
          );
          const ordinaryOutgoing = outgoing.filter((mod) => !coreReplacements.includes(mod));

          let changes = stageDraftChanges([], ordinaryOutgoing, draftActions.deactivate, policy);
          if (coreReplacements.length) {
            // Core remains present in the imported package set. Recording the physical-row swap
            // directly avoids treating this paired replacement as a request to disable Core.
            changes = [
              ...changes,
              ...coreReplacements.map((mod) => ({ mod, action: draftActions.deactivate }) as const),
            ];
          }
          changes = stageActivationChanges(changes, incoming, policy);

          const targetPackageSet = new Set(targetPackageIds);
          const importedMembership = activeMembership(basePackageIds, changes);
          const membershipProjectedOrder = draftActiveOrderTemplate(basePackageIds, changes)
            .map(normalizePackageId)
            .filter((packageId) => importedMembership.has(packageId));
          if (
            membershipProjectedOrder.length !== targetPackageIds.length ||
            membershipProjectedOrder.some((packageId) => !targetPackageSet.has(packageId))
          ) {
            throw new Error("The imported Active membership could not be staged exactly.");
          }

          const targetByPackage = new Map(
            targetMods.map((mod) => [normalizePackageId(mod.packageId ?? ""), mod]),
          );
          const sourceOrder = membershipProjectedOrder.map((packageId) => {
            const mod = targetByPackage.get(packageId);
            if (!mod) {
              throw new Error("The imported Active membership could not be ordered exactly.");
            }
            return { id: packageId, mod };
          });
          const targetOrder = targetMods.map((mod) => ({
            id: normalizePackageId(mod.packageId ?? ""),
            mod,
          }));
          const moves = deriveActiveOrderMoves(sourceOrder, targetOrder);
          if (!moves) {
            throw new Error("The imported Active load order could not be staged exactly.");
          }

          if (!changes.length && !moves.length) {
            return state;
          }

          const firstOperationId = nextActiveOrderOperationId + 1;
          const activeOrderOperations = moves.map(
            ({ item, fromPosition, toPosition }, index): ActiveOrderDraftOperation => ({
              id: `order-${firstOperationId + index}`,
              kind: activeOrderDraftKinds.import,
              fileName: displayFileName,
              packageId: normalizePackageId(item.mod.packageId ?? ""),
              modId: item.mod.id,
              modName: item.mod.name,
              fromPosition,
              toPosition,
            }),
          );
          const projectedMemberships = new Map(activeOrderMemberships);
          activeOrderOperations.forEach(({ id }) => {
            projectedMemberships.set(id, targetPackageIds);
          });
          const activeOrder = activeOrderOperations.length
            ? replayActiveOrder(
                basePackageIds,
                changes,
                activeOrderOperations,
                projectedMemberships,
              )
            : undefined;
          if (
            activeOrder &&
            !samePackageOrder(
              targetPackageIds,
              visibleActiveOrder(activeOrder, basePackageIds, changes),
            )
          ) {
            throw new Error("The imported Active load order no longer produces the target order.");
          }

          nextActiveOrderOperationId += activeOrderOperations.length;
          activeOrderOperations.forEach(({ id }) => {
            activeOrderMemberships.set(id, [...targetPackageIds]);
          });
          return {
            changes,
            activeOrder,
            activeOrderOperations,
            activeBasePackageIds: [...basePackageIds],
            activeBaseConfigTarget: policy.activeConfigTarget,
          };
        });
      },
      stageRemoval: (mods, policy) => {
        set((state) => {
          if (state.applying) {
            return state;
          }
          const changes = stageLibraryRemovalChanges(state.changes, mods, policy);
          if (changes === state.changes) {
            return state;
          }
          const hasActiveChanges = hasActivityDraft(changes);
          return {
            changes,
            activeOrder: state.activeOrder,
            activeOrderOperations: state.activeOrderOperations,
            activeBasePackageIds:
              hasActiveChanges || state.activeOrderOperations.length
                ? (state.activeBasePackageIds ?? policy.activePackageIds)
                : undefined,
            activeBaseConfigTarget:
              hasActiveChanges || state.activeOrderOperations.length
                ? (state.activeBaseConfigTarget ?? policy.activeConfigTarget)
                : undefined,
          };
        });
      },
      rebaseActivityChanges: (mods) => {
        set((state) => {
          if (state.applying) {
            return state;
          }
          const changes = rebaseActivityDraftChanges(state.changes, mods);
          if (changes === state.changes) {
            return state;
          }
          return {
            changes,
            activeOrder:
              state.activeOrderOperations.length && state.activeBasePackageIds
                ? replayActiveOrder(
                    state.activeBasePackageIds,
                    changes,
                    state.activeOrderOperations,
                    activeOrderMemberships,
                  )
                : state.activeOrder,
          };
        });
      },
      setActiveOrder: (packageIds, basePackageIds, baseConfigTarget, operation) => {
        set((state) => {
          if (state.applying) {
            return state;
          }
          const baseline = state.activeBasePackageIds ?? [...basePackageIds];
          const currentOrder = state.activeOrderOperations.length
            ? replayActiveOrder(
                baseline,
                state.changes,
                state.activeOrderOperations,
                activeOrderMemberships,
              )
            : draftActiveOrderTemplate(baseline, state.changes);
          if (
            samePackageOrder(packageIds, visibleActiveOrder(currentOrder, baseline, state.changes))
          ) {
            return state;
          }
          const draftOperation: ActiveOrderDraftOperation = {
            ...operation,
            id: `order-${++nextActiveOrderOperationId}`,
          };
          const operationMembership = visibleActiveOrder(currentOrder, baseline, state.changes);
          const projectedMemberships = new Map(activeOrderMemberships);
          projectedMemberships.set(draftOperation.id, operationMembership);
          const activeOrderOperations =
            operation.kind === activeOrderDraftKinds.autoSort
              ? [draftOperation]
              : [...state.activeOrderOperations, draftOperation];
          const activeOrder = replayActiveOrder(
            baseline,
            state.changes,
            activeOrderOperations,
            projectedMemberships,
          );
          if (
            !samePackageOrder(packageIds, visibleActiveOrder(activeOrder, baseline, state.changes))
          ) {
            throw new Error("The pending load-order move no longer produces the proposed order.");
          }
          if (operation.kind === activeOrderDraftKinds.autoSort) {
            state.activeOrderOperations.forEach(({ id }) => {
              activeOrderMemberships.delete(id);
            });
          }
          activeOrderMemberships.set(draftOperation.id, operationMembership);
          return {
            activeOrder,
            activeOrderOperations,
            activeBasePackageIds: baseline,
            activeBaseConfigTarget: state.activeBaseConfigTarget ?? baseConfigTarget,
          };
        });
      },
      replaceActiveOrder: (packageIds, basePackageIds, baseConfigTarget, operations) => {
        set((state) => {
          if (state.applying) {
            return state;
          }
          const baseline = state.activeBasePackageIds ?? [...basePackageIds];
          const activeOrderOperations = operations.map((operation): ActiveOrderDraftOperation => ({
            ...operation,
            id: `order-${++nextActiveOrderOperationId}`,
          }));
          if (!activeOrderOperations.length) {
            const hasActiveChanges = hasActivityDraft(state.changes);
            if (!state.activeOrderOperations.length) {
              return state;
            }
            state.activeOrderOperations.forEach(({ id }) => {
              activeOrderMemberships.delete(id);
            });
            return {
              activeOrder: undefined,
              activeOrderOperations: [],
              activeBasePackageIds: hasActiveChanges ? baseline : undefined,
              activeBaseConfigTarget: hasActiveChanges
                ? (state.activeBaseConfigTarget ?? baseConfigTarget)
                : undefined,
            };
          }
          const projectedMemberships = new Map(activeOrderMemberships);
          activeOrderOperations.forEach(({ id }) => {
            projectedMemberships.set(id, packageIds);
          });
          const activeOrder = replayActiveOrder(
            baseline,
            state.changes,
            activeOrderOperations,
            projectedMemberships,
          );
          if (
            !samePackageOrder(packageIds, visibleActiveOrder(activeOrder, baseline, state.changes))
          ) {
            throw new Error("The pending auto-sort moves no longer produce the proposed order.");
          }
          state.activeOrderOperations.forEach(({ id }) => {
            activeOrderMemberships.delete(id);
          });
          activeOrderOperations.forEach(({ id }) => {
            activeOrderMemberships.set(id, [...packageIds]);
          });
          return {
            activeOrder,
            activeOrderOperations,
            activeBasePackageIds: baseline,
            activeBaseConfigTarget: state.activeBaseConfigTarget ?? baseConfigTarget,
          };
        });
      },
      getPendingDraft: () => {
        const state = get();
        if (!state.changes.length && !state.activeOrderOperations.length) {
          return undefined;
        }
        const operationMemberships = state.activeOrderOperations.map(({ id }) => {
          const packageIds = activeOrderMemberships.get(id);
          if (!packageIds) {
            throw new Error(
              "The pending draft has lost a load-order membership snapshot and cannot be saved.",
            );
          }
          return { operationId: id, packageIds: [...packageIds] };
        });
        return {
          version: 1,
          changes: state.changes.map((change) => ({
            action: change.action,
            target: pendingDraftTarget(change.mod),
          })),
          ...(state.activeOrder === undefined ? {} : { activeOrder: [...state.activeOrder] }),
          activeOrderOperations: state.activeOrderOperations.map((operation) => ({
            ...operation,
          })),
          ...(state.activeBasePackageIds === undefined
            ? {}
            : { activeBasePackageIds: [...state.activeBasePackageIds] }),
          ...(state.activeBaseConfigTarget === undefined
            ? {}
            : { activeBaseConfigTarget: state.activeBaseConfigTarget }),
          operationMemberships,
        } satisfies PendingDraft;
      },
      hydratePendingDraft: (draft, currentMods) => {
        const state = get();
        if (state.applying) {
          throw new Error("Wait for the current draft operation before restoring pending changes.");
        }
        if (state.changes.length || state.activeOrderOperations.length) {
          throw new Error("Pending changes are already loaded and cannot be replaced.");
        }
        if (!draft) {
          return;
        }
        if (!draft.changes.length && !draft.activeOrderOperations.length) {
          throw new Error("The saved pending draft is invalid and was not restored.");
        }

        const changes: DraftChange[] = draft.changes.map(({ action, target }) => ({
          action,
          mod: resolvePendingDraftMod(target, action, currentMods),
        }));
        const activeOrderOperations: ActiveOrderDraftOperation[] = draft.activeOrderOperations.map(
          (operation) => ({ ...operation }),
        );
        const operationIds = new Set(activeOrderOperations.map(({ id }) => id));
        if (operationIds.size !== activeOrderOperations.length) {
          throw new Error("The saved pending draft contains duplicate load-order operations.");
        }
        const projectedMemberships = new Map<string, readonly string[]>();
        for (const membership of draft.operationMemberships) {
          if (
            projectedMemberships.has(membership.operationId) ||
            !operationIds.has(membership.operationId)
          ) {
            throw new Error("The saved pending draft contains invalid load-order memberships.");
          }
          projectedMemberships.set(membership.operationId, [...membership.packageIds]);
        }
        if (
          projectedMemberships.size !== activeOrderOperations.length ||
          activeOrderOperations.some(({ id }) => !projectedMemberships.has(id))
        ) {
          throw new Error("The saved pending draft is missing a load-order membership snapshot.");
        }

        const hasActiveChanges = hasActivityDraft(changes);
        const hasOrderChanges = activeOrderOperations.length > 0;
        const basePackageIds = draft.activeBasePackageIds;
        if (
          (hasActiveChanges || hasOrderChanges) &&
          (!basePackageIds?.length || !draft.activeBaseConfigTarget)
        ) {
          throw new Error("The saved pending draft has no verified active-mod baseline.");
        }
        const activeOrder =
          hasOrderChanges && basePackageIds
            ? replayActiveOrder(
                basePackageIds,
                changes,
                activeOrderOperations,
                projectedMemberships,
              )
            : undefined;
        if (
          (activeOrder === undefined) !== (draft.activeOrder === undefined) ||
          (activeOrder && !samePackageOrder(activeOrder, draft.activeOrder ?? []))
        ) {
          throw new Error("The saved pending draft no longer reproduces its load order.");
        }

        let restoredOperationId = nextActiveOrderOperationId;
        for (const operation of activeOrderOperations) {
          restoredOperationId = Math.max(restoredOperationId, orderOperationNumber(operation.id));
        }
        activeOrderMemberships.clear();
        projectedMemberships.forEach((packageIds, id) => {
          activeOrderMemberships.set(id, packageIds);
        });
        nextActiveOrderOperationId = restoredOperationId;
        set({
          changes,
          activeOrder,
          activeOrderOperations,
          activeBasePackageIds: basePackageIds ? [...basePackageIds] : undefined,
          activeBaseConfigTarget: draft.activeBaseConfigTarget,
          applying: false,
          reviewOpen: false,
          reviewBatch: undefined,
          reviewActiveOrder: undefined,
          reviewActiveOrderOperations: undefined,
          progress: undefined,
        });
      },
      undoActiveOrder: (operationId) => {
        set((state) => {
          if (
            state.applying ||
            !state.activeOrderOperations.some((operation) => operation.id === operationId)
          ) {
            return state;
          }
          const remainingOperations = state.activeOrderOperations.filter(
            (operation) => operation.id !== operationId,
          );
          const hasActiveChanges = hasActivityDraft(state.changes);
          const baseline = state.activeBasePackageIds;
          activeOrderMemberships.delete(operationId);
          return {
            activeOrder:
              remainingOperations.length && baseline
                ? replayActiveOrder(
                    baseline,
                    state.changes,
                    remainingOperations,
                    activeOrderMemberships,
                  )
                : undefined,
            activeOrderOperations: remainingOperations,
            activeBasePackageIds:
              hasActiveChanges || remainingOperations.length ? baseline : undefined,
            activeBaseConfigTarget:
              hasActiveChanges || remainingOperations.length
                ? state.activeBaseConfigTarget
                : undefined,
          };
        });
      },
      undoAction: (id, action) => {
        set((state) => {
          if (
            state.applying ||
            !state.changes.some((change) => change.mod.id === id && change.action === action)
          ) {
            return state;
          }
          const changes = state.changes.filter(
            (change) => change.mod.id !== id || change.action !== action,
          );
          const hasActiveChanges = hasActivityDraft(changes);
          const hasOrderChanges = state.activeOrderOperations.length > 0;
          return {
            changes,
            activeOrder:
              isActivityDraftAction(action) && hasOrderChanges && state.activeBasePackageIds
                ? replayActiveOrder(
                    state.activeBasePackageIds,
                    changes,
                    state.activeOrderOperations,
                    activeOrderMemberships,
                  )
                : state.activeOrder,
            activeOrderOperations: state.activeOrderOperations,
            activeBasePackageIds:
              hasActiveChanges || hasOrderChanges ? state.activeBasePackageIds : undefined,
            activeBaseConfigTarget:
              hasActiveChanges || hasOrderChanges ? state.activeBaseConfigTarget : undefined,
          };
        });
      },
      undo: (id) => {
        set((state) =>
          state.applying || !state.changes.some((change) => change.mod.id === id)
            ? state
            : (() => {
                const changesActivity = state.changes.some(
                  (change) => change.mod.id === id && isActivityDraftAction(change.action),
                );
                const changes = state.changes.filter((change) => change.mod.id !== id);
                const hasActiveChanges = hasActivityDraft(changes);
                const hasOrderChanges = state.activeOrderOperations.length > 0;
                return {
                  changes,
                  activeOrder:
                    changesActivity && hasOrderChanges && state.activeBasePackageIds
                      ? replayActiveOrder(
                          state.activeBasePackageIds,
                          changes,
                          state.activeOrderOperations,
                          activeOrderMemberships,
                        )
                      : state.activeOrder,
                  activeOrderOperations: state.activeOrderOperations,
                  activeBasePackageIds:
                    hasActiveChanges || hasOrderChanges ? state.activeBasePackageIds : undefined,
                  activeBaseConfigTarget:
                    hasActiveChanges || hasOrderChanges ? state.activeBaseConfigTarget : undefined,
                };
              })(),
        );
      },
      discard: () => {
        set((state) => {
          if (state.applying || (!state.changes.length && !state.activeOrderOperations.length)) {
            return state;
          }
          activeOrderMemberships.clear();
          return {
            changes: [],
            activeOrder: undefined,
            activeOrderOperations: [],
            activeBasePackageIds: undefined,
            activeBaseConfigTarget: undefined,
          };
        });
      },
      openReview: () => {
        set((state) =>
          state.reviewOpen ||
          state.applying ||
          (!state.changes.length && !state.activeOrderOperations.length)
            ? state
            : {
                reviewOpen: true,
                reviewBatch: undefined,
                reviewActiveOrder: undefined,
                reviewActiveOrderOperations: undefined,
                progress: undefined,
              },
        );
      },
      closeReview: () => {
        set((state) => (!state.reviewOpen || state.applying ? state : { reviewOpen: false }));
      },
      reportProgress: (progress) => {
        set({ progress });
      },
      beginApply: () => {
        const { changes, applying } = get();
        if (applying || (!changes.length && !get().activeOrderOperations.length)) {
          return undefined;
        }
        set({
          applying: true,
          reviewBatch: changes,
          reviewActiveOrder: get().activeOrder,
          reviewActiveOrderOperations: get().activeOrderOperations,
        });
        return changes;
      },
      complete: (id, action) => {
        set((state) =>
          !state.applying ||
          !state.changes.some((change) => change.mod.id === id && change.action === action)
            ? state
            : {
                changes: state.changes.filter(
                  (change) => change.mod.id !== id || change.action !== action,
                ),
              },
        );
      },
      completeActiveOrder: () => {
        activeOrderMemberships.clear();
        set({
          activeOrder: undefined,
          activeOrderOperations: [],
          activeBasePackageIds: undefined,
          activeBaseConfigTarget: undefined,
        });
      },
      endApply: () => {
        set((state) => (state.applying ? { applying: false } : state));
      },
    },
  }));
  return {
    getState: store.getState,
    getInitialState: store.getInitialState,
    subscribe: store.subscribe,
  };
}
