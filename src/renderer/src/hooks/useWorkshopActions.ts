import { useCallback, useEffect, useState } from "react";

import type { ActiveModsState, SteamOperationProgress } from "../../../shared/types";
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

  async function sync() {
    clearProgress();
    await perform(async () => {
      try {
        await run(async () => {
          const result = await getStore().syncSubscribedMods();
          adopt(result.vault);
          adoptActive(result.activeMods);
          // A sync can add, remove, or update About.xml files. Do not let a settled inventory cache
          // hide those changes for the rest of this session.
          refreshActive(false, true, true);
          setNotice(
            workshopResultNotice(result, "Workshop folders synchronized; saved mods retained"),
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
