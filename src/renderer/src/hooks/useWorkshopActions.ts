import { useCallback, useEffect, useState } from "react";

import { workshopSyncModes } from "../../../shared/domainConstants";
import type {
  ActiveModsState,
  SteamOperationProgress,
  WorkshopSyncMode,
} from "../../../shared/types";
import { getStore } from "../services/modStore";
import { workshopResultNotice, workshopWarningMessage } from "../services/workshopActions";
import type { useActionNotifications } from "./useActionNotifications";
import type { useModVault } from "./useModVault";

interface WorkshopActionDependencies {
  run: ReturnType<typeof useModVault>["run"];
  adopt: ReturnType<typeof useModVault>["adopt"];
  adoptActive: (active: ActiveModsState, preserveInstalled?: boolean) => void;
  refreshActive: (
    showLoading?: boolean,
    refreshMetadata?: boolean,
    forceMetadata?: boolean,
  ) => void;
  perform: ReturnType<typeof useActionNotifications>["perform"];
  notifyError: (error: unknown) => void;
  notifyWarning: (message: string) => void;
  onWorkshopStatus: (error?: string) => void;
  setNotice: (message: string) => void;
}

export function useWorkshopActions({
  run,
  adopt,
  adoptActive,
  refreshActive,
  perform,
  notifyError,
  notifyWarning,
  onWorkshopStatus,
  setNotice,
}: WorkshopActionDependencies) {
  const [progress, setProgress] = useState<SteamOperationProgress>();
  const clearProgress = useCallback(() => {
    setProgress(undefined);
  }, []);

  useEffect(
    () =>
      getStore().onSteamProgress?.((value) => {
        if (value.vault) {
          adopt(value.vault);
        }
        setProgress(value);
      }),
    [adopt],
  );

  async function sync(mode: WorkshopSyncMode = workshopSyncModes.full) {
    clearProgress();
    await perform(async () => {
      try {
        await run(async () => {
          const result = await getStore().syncSubscribedMods(mode);
          adopt(result.vault);
          adoptActive(result.activeMods);
          // Either sync mode can add or remove About.xml files. Do not let a settled inventory
          // cache hide those changes for the rest of this session.
          refreshActive(false, true, true);
          setNotice(
            workshopResultNotice(
              result,
              mode === workshopSyncModes.full
                ? "Workshop folders synchronized; saved mods retained"
                : "Workshop additions and removals refreshed; existing metadata retained",
            ),
          );
          onWorkshopStatus(
            result.folderWarnings?.length ? result.folderWarnings.join("; ") : undefined,
          );
          if (result.failures.length) {
            notifyError(result.failures.join("; "));
          } else if (result.warnings?.length) {
            notifyWarning(workshopWarningMessage(result.warnings));
          }
        });
      } catch (error) {
        onWorkshopStatus(String(error));
        throw error;
      }
    });
  }

  return {
    progress,
    clearProgress,
    sync,
  };
}
