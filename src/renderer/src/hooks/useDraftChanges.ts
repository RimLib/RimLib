import type { ActiveModsState, SteamStatus } from "../../../shared/types";
import { applyDraftChanges } from "../services/draftActions";
import { getStore } from "../services/modStore";
import { useDraftStore } from "../stores/WorkspaceStoreProvider";
import { draftActions, type DraftProgress, draftStatuses, draftSteps } from "../utils/drafts";
import type { useModVault } from "./useModVault";

interface DraftDependencies {
  run: ReturnType<typeof useModVault>["run"];
  adopt: ReturnType<typeof useModVault>["adopt"];
  adoptActive: (active: ActiveModsState) => void;
  refreshActive: (showLoading?: boolean) => void;
  refreshSteam: () => Promise<SteamStatus>;
  notifyError: (error: unknown) => void;
  setNotice: (notice: string) => void;
}

export function useDraftChanges(dependencies: DraftDependencies) {
  const changes = useDraftStore((state) => state.changes);
  const applying = useDraftStore((state) => state.applying);
  const reviewOpen = useDraftStore((state) => state.reviewOpen);
  const reviewBatch = useDraftStore((state) => state.reviewBatch);
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
        if (snapshot.some((change) => change.action !== draftActions.remove)) {
          const status = await dependencies.refreshSteam();
          if (!status.running) {
            throw new Error(status.error ?? "Start Steam before applying subscription changes.");
          }
        }
        await applyDraftChanges(snapshot, getStore(), {
          progress: report,
          adopt: dependencies.adopt,
          adoptActive: dependencies.adoptActive,
          complete: (id) => {
            actions.complete(id);
            completed++;
          },
        });
      });
      dependencies.setNotice(
        `${completed} changes applied; library tags and RimWorld configuration preserved`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report({ ...latest, status: draftStatuses.failed, message });
      dependencies.setNotice(
        `${completed} changes applied; ${snapshot.length - completed} pending changes retained`,
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
    applying,
    actions,
    reviewOpen,
    closeReview: actions.closeReview,
    confirm,
    progress,
    reviewedChanges: reviewBatch ?? changes,
  };
}
