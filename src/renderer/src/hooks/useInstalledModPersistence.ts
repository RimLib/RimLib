import { useEffect } from "react";

import type { InstalledModMetadata } from "../../../shared/types";
import { reconcileInstalledModMetadata } from "../utils/installedModPersistence";
import type { useModVault } from "./useModVault";

interface InstalledModPersistenceDependencies {
  busy: boolean;
  installedMods: readonly InstalledModMetadata[] | undefined;
  loaded: boolean;
  update: ReturnType<typeof useModVault>["update"];
}

/**
 * Checkpoints scanner-owned About.xml metadata without allowing an incomplete or in-flight scan
 * to replace the saved inventory.
 */
export function useInstalledModPersistence({
  busy,
  installedMods,
  loaded,
  update,
}: InstalledModPersistenceDependencies) {
  useEffect(() => {
    if (!loaded || busy || installedMods === undefined) {
      return;
    }
    const observedAt = new Date().toISOString();
    update((previous) => reconcileInstalledModMetadata(previous, installedMods, observedAt));
  }, [busy, installedMods, loaded, update]);
}
