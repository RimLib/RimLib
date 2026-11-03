import { useEffect, useRef } from "react";

import { normalizePackageId } from "../../../shared/packages";
import type { Mod } from "../../../shared/types";
import { type ModPanelMode, modPanelModes } from "../utils/uiConstants";

interface InitialModSelectionOptions {
  loaded: boolean;
  activeLoading: boolean;
  activeMetadataLoading: boolean;
  activeError?: string;
  focusedModId?: string;
  selectedCount: number;
  activeMods: readonly Mod[];
  inactiveMods: readonly Mod[];
  select: (panel: ModPanelMode, orderedIds: readonly string[], id: string) => boolean;
}

/**
 * Chooses the initial workspace row while allowing late installed metadata to replace a temporary
 * identity. Once the user focuses another row, this hook permanently yields control for the rest
 * of the mounted workspace session.
 */
export function useInitialModSelection({
  loaded,
  activeLoading,
  activeMetadataLoading,
  activeError,
  focusedModId,
  selectedCount,
  activeMods,
  inactiveMods,
  select,
}: InitialModSelectionOptions) {
  const settled = useRef(false);
  const automaticTarget = useRef<
    { id: string; packageId?: string; panel: ModPanelMode } | undefined
  >(undefined);

  useEffect(() => {
    if (settled.current || !loaded || activeLoading) {
      return;
    }
    const currentTarget = automaticTarget.current;
    if (currentTarget) {
      if (focusedModId && focusedModId !== currentTarget.id) {
        settled.current = true;
        automaticTarget.current = undefined;
        return;
      }
      const candidates = currentTarget.panel === modPanelModes.active ? activeMods : inactiveMods;
      const targetStillExists = candidates.some((mod) => mod.id === currentTarget.id);
      if (!targetStillExists) {
        const replacement =
          candidates.find(
            (mod) =>
              currentTarget.packageId &&
              mod.packageId &&
              normalizePackageId(mod.packageId) === currentTarget.packageId,
          ) ?? candidates[0];
        if (replacement) {
          select(
            currentTarget.panel,
            candidates.map((mod) => mod.id),
            replacement.id,
          );
          automaticTarget.current = {
            id: replacement.id,
            packageId: replacement.packageId
              ? normalizePackageId(replacement.packageId)
              : undefined,
            panel: currentTarget.panel,
          };
        }
      }
      if (!activeMetadataLoading) {
        settled.current = true;
        automaticTarget.current = undefined;
      }
      return;
    }
    if (focusedModId || selectedCount) {
      settled.current = true;
      return;
    }
    const activeTarget = activeMods[0];
    const target = activeTarget ?? (activeError ? undefined : inactiveMods[0]);
    if (!target) {
      if (!activeError && !activeMetadataLoading) {
        settled.current = true;
      }
      return;
    }
    const mode = activeTarget ? modPanelModes.active : modPanelModes.inactive;
    const orderedIds = (activeTarget ? activeMods : inactiveMods).map((mod) => mod.id);
    select(mode, orderedIds, target.id);
    automaticTarget.current = {
      id: target.id,
      packageId: target.packageId ? normalizePackageId(target.packageId) : undefined,
      panel: mode,
    };
    if (!activeMetadataLoading) {
      settled.current = true;
      automaticTarget.current = undefined;
    }
  }, [
    activeError,
    activeLoading,
    activeMetadataLoading,
    activeMods,
    focusedModId,
    inactiveMods,
    loaded,
    select,
    selectedCount,
  ]);
}
