import type { ActiveModsState, AppSettings, SteamStatus } from "../../../shared/types";
import { applyDraftChanges } from "../services/draftActions";
import { getStore } from "../services/modStore";
import { useDraftStore } from "../stores/WorkspaceStoreProvider";
import {
  type DraftProgress,
  draftStatuses,
  draftSteps,
  isSubscriptionDraftAction,
  remainingDraftOperationCount,
} from "../utils/drafts";
import type { useModVault } from "./useModVault";

interface DraftDependencies {
  run: ReturnType<typeof useModVault>["run"];
  adopt: ReturnType<typeof useModVault>["adopt"];
  adoptActive: (active: ActiveModsState, preserveInstalled?: boolean) => void;
  refreshActive: (
    showLoading?: boolean,
    refreshMetadata?: boolean,
    forceMetadata?: boolean,
  ) => void;
  refreshSteam: () => Promise<SteamStatus>;
  notifyError: (error: unknown) => void;
  setNotice: (notice: string) => void;
  settings?: AppSettings;
}

export function useDraftChanges(dependencies: DraftDependencies) {
  const changes = useDraftStore((state) => state.changes);
  const applying = useDraftStore((state) => state.applying);
  const activeOrder = useDraftStore((state) => state.activeOrder);
  const activeOrderOperations = useDraftStore((state) => state.activeOrderOperations);
  const activeBasePackageIds = useDraftStore((state) => state.activeBasePackageIds);
  const activeBaseConfigTarget = useDraftStore((state) => state.activeBaseConfigTarget);
  const reviewOpen = useDraftStore((state) => state.reviewOpen);
  const reviewBatch = useDraftStore((state) => state.reviewBatch);
  const reviewActiveOrder = useDraftStore((state) => state.reviewActiveOrder);
  const reviewActiveOrderOperations = useDraftStore((state) => state.reviewActiveOrderOperations);
  const progress = useDraftStore((state) => state.progress);
  const actions = useDraftStore((state) => state.actions);
  async function confirm() {
    const snapshot = actions.beginApply();
    if (!snapshot) {
      return;
    }
    let latest: DraftProgress = {
      step: draftSteps.validate,
      status: draftStatuses.running,
      completed: 0,
      total: 1,
      message: "Saving edits and checking availability",
    };
    const report = (value: DraftProgress) => {
      latest = value;
      actions.reportProgress(value);
    };
    report(latest);
    let stopProgress: (() => void) | undefined;
    let completed = 0;
    try {
      stopProgress = getStore().onSteamProgress?.((value) => {
        report({ ...latest, message: value.message });
      });
      await dependencies.run(async () => {
        if (snapshot.some((change) => isSubscriptionDraftAction(change.action))) {
          const status = await dependencies.refreshSteam();
          if (!status.running) {
            throw new Error(status.error ?? "Start Steam before applying subscription changes.");
          }
        }
        await applyDraftChanges(
          snapshot,
          getStore(),
          {
            progress: report,
            adopt: dependencies.adopt,
            adoptActive: dependencies.adoptActive,
            complete: (id, action) => {
              actions.complete(id, action);
              completed++;
            },
            completeActiveOrder: () => {
              actions.completeActiveOrder();
              if (activeOrder) {
                completed += activeOrderOperations.length;
              }
            },
          },
          {
            settings: dependencies.settings,
            activeOrder,
            activeOrderOperationCount: activeOrderOperations.length,
            expectedActivePackageIds: activeBasePackageIds,
            expectedActiveConfigTarget: activeBaseConfigTarget,
          },
        );
      });
      dependencies.setNotice(`${completed} changes applied; library tags preserved`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report({ ...latest, status: draftStatuses.failed, message });
      dependencies.setNotice(
        `${completed} changes applied; ${remainingDraftOperationCount(snapshot, activeOrderOperations.length, completed)} pending changes retained`,
      );
      dependencies.notifyError(error);
    } finally {
      try {
        stopProgress?.();
      } catch (error) {
        dependencies.notifyError(error);
      } finally {
        actions.endApply();
        dependencies.refreshActive(false);
      }
    }
  }
  return {
    changes,
    activeOrder,
    activeOrderOperations,
    activeBasePackageIds,
    applying,
    actions,
    reviewOpen,
    closeReview: actions.closeReview,
    confirm,
    progress,
    reviewedChanges: reviewBatch ?? changes,
    reviewedActiveOrder: reviewActiveOrder ?? activeOrder,
    reviewedActiveOrderOperations: reviewActiveOrderOperations ?? activeOrderOperations,
  };
}
