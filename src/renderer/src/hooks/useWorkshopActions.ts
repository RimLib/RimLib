import { useCallback, useEffect, useState } from "react";

import type { ActiveModsState, SteamOperationProgress } from "../../../shared/types";
import { getStore } from "../services/modStore";
import { workshopResultNotice } from "../services/workshopActions";
import type { useActionNotifications } from "./useActionNotifications";
import type { useModVault } from "./useModVault";

interface WorkshopActionDependencies {
  run: ReturnType<typeof useModVault>["run"];
  adopt: ReturnType<typeof useModVault>["adopt"];
  adoptActive: (active: ActiveModsState) => void;
  refreshActive: (showLoading?: boolean) => void;
  perform: ReturnType<typeof useActionNotifications>["perform"];
  notifyError: (error: unknown) => void;
  setNotice: (message: string) => void;
}

export function useWorkshopActions({
  run,
  adopt,
  adoptActive,
  refreshActive,
  perform,
  notifyError,
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
    await perform(() =>
      run(async () => {
        const result = await getStore().syncSubscribedMods();
        adopt(result.vault);
        adoptActive(result.activeMods);
        refreshActive(false);
        setNotice(
          workshopResultNotice(result, "Workshop folders synchronized; saved mods retained"),
        );
        if (result.failures.length) {
          notifyError(result.failures.join("; "));
        }
      }),
    );
  }

  return {
    progress,
    clearProgress,
    sync,
  };
}
