import { useEffect, useMemo, useRef } from "react";

import { workshopSyncModes } from "../../../shared/domainConstants";
import type { InstalledModMetadata, ModVault, WorkshopSyncMode } from "../../../shared/types";
import { effectiveWorkshopMetadataAttemptedIds } from "../../../shared/vault";

interface AutomaticWorkshopMetadataDependencies {
  desktopAvailable: boolean;
  draftReady: boolean;
  installedMods: readonly InstalledModMetadata[] | undefined;
  loaded: boolean;
  paused: boolean;
  sync: (mode: WorkshopSyncMode) => Promise<void> | void;
  vault: Pick<ModVault, "localSteamState" | "mods">;
}

/**
 * Enriches locally discovered Workshop rows once per app session. The persisted attempt set keeps
 * completed requests quiet across sessions; this in-memory set also prevents a failed request from
 * immediately looping while the current session remains open.
 */
export function useAutomaticWorkshopMetadata({
  desktopAvailable,
  draftReady,
  installedMods,
  loaded,
  paused,
  sync,
  vault,
}: AutomaticWorkshopMetadataDependencies) {
  const sessionAttempts = useRef(new Set<string>());
  const persistedAttempts = useMemo(() => effectiveWorkshopMetadataAttemptedIds(vault), [vault]);
  const pendingIds = useMemo(
    () => [
      ...new Set(
        (installedMods ?? []).flatMap(({ workshopId }) =>
          workshopId && !persistedAttempts.has(workshopId) ? [workshopId] : [],
        ),
      ),
    ],
    [installedMods, persistedAttempts],
  );

  useEffect(() => {
    if (!loaded || !draftReady || paused || !desktopAvailable) {
      return;
    }
    const pending = pendingIds.filter((id) => !sessionAttempts.current.has(id));
    if (!pending.length) {
      return;
    }
    pending.forEach((id) => sessionAttempts.current.add(id));
    // About.xml data remains available immediately; public metadata follows without a full sync.
    void sync(workshopSyncModes.light);
  }, [desktopAvailable, draftReady, loaded, paused, pendingIds, sync]);
}
