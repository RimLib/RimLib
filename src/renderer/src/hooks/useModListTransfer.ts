import { useMemo, useState } from "react";

import type { ActiveModsState, AppSettings, LocalSteamState, Mod } from "../../../shared/types";
import { requireValue } from "../../../shared/validation";
import { getStore } from "../services/modStore";
import type { WorkspaceState } from "../stores/workspaceStore";
import { buildModViews } from "../utils/activeMods";
import { normalizeActiveConfigTarget } from "../utils/drafts";
import { activityPanels } from "../utils/library";
import { buildModListExportPackageIds } from "../utils/modListExport";
import {
  buildModListImportPlan,
  modListImportBaselineError,
  type ModListImportPlan,
  modListImportPlanKey,
} from "../utils/modListImport";
import { modFilters, modPanelModes, modSorts } from "../utils/uiConstants";
import type { useActionNotifications } from "./useActionNotifications";
import type { useDraftChanges } from "./useDraftChanges";
import type { useModVault } from "./useModVault";

type DraftState = ReturnType<typeof useDraftChanges>;
type ModListDraft = Pick<DraftState, "activeOrderOperations" | "applying" | "changes"> & {
  actions: Pick<DraftState["actions"], "stageImportedActiveList">;
};

type ModListWorkspaceActions = Pick<
  WorkspaceState["actions"],
  "select" | "setModStatusFilter" | "setSearch" | "setSort"
>;

export interface ModListTransferDependencies {
  active: ActiveModsState;
  activeConfigurationError?: string;
  activeMetadataVerified: boolean;
  actualPanels: ReturnType<typeof activityPanels>;
  busy: boolean;
  draft: ModListDraft;
  draftControlsDisabledReason?: string;
  localSteamState: LocalSteamState;
  mods: Mod[];
  notifyWarning: ReturnType<typeof useActionNotifications>["notifyWarning"];
  perform: ReturnType<typeof useActionNotifications>["perform"];
  projectedActiveMods: readonly Mod[];
  run: ReturnType<typeof useModVault>["run"];
  savedIds: ReadonlySet<string>;
  settings: AppSettings;
  setNotice: (notice: string) => void;
  workspaceActions: ModListWorkspaceActions;
}

export interface ModListTransfer {
  plan?: ModListImportPlan;
  importDisabledReason?: string;
  exportDisabledReason?: string;
  openImport: () => void;
  confirmImport: () => void;
  closeImport: () => void;
  exportList: () => void;
}

/**
 * Owns the complete native mod-list import/export workflow. Import confirmation always rebuilds
 * the reviewed plan from the latest inventory before staging it, keeping stale-preview validation
 * beside the action it protects.
 */
export function useModListTransfer({
  active,
  activeConfigurationError,
  activeMetadataVerified,
  actualPanels,
  busy,
  draft,
  draftControlsDisabledReason,
  localSteamState,
  mods,
  notifyWarning,
  perform,
  projectedActiveMods,
  run,
  savedIds,
  settings,
  setNotice,
  workspaceActions,
}: ModListTransferDependencies): ModListTransfer {
  const [plan, setPlan] = useState<ModListImportPlan>();
  const actualImportPanels = useMemo(() => {
    if (activeMetadataVerified) {
      return actualPanels;
    }
    const planningViews = buildModViews({ ...active, installedMods: undefined }, mods);
    return activityPanels(
      { localSteamState },
      planningViews.allEntries,
      planningViews.activeEntries,
    );
  }, [active, activeMetadataVerified, actualPanels, mods, localSteamState]);
  const actualImportMods = useMemo(
    () => [...actualImportPanels.inactive, ...actualImportPanels.active],
    [actualImportPanels],
  );
  const importBaselineError = modListImportBaselineError(active.packageIds);
  const retainedActiveConfiguration = Boolean(
    active.error &&
    active.packageIds.length > 0 &&
    active.gameVersion?.trim() &&
    !importBaselineError,
  );
  const configurationError = retainedActiveConfiguration ? undefined : activeConfigurationError;
  const importDisabledReason =
    draftControlsDisabledReason ??
    configurationError ??
    importBaselineError ??
    (draft.changes.length || draft.activeOrderOperations.length
      ? "Apply or discard the pending draft before importing a mod list"
      : undefined);
  const exportDisabledReason =
    draftControlsDisabledReason ??
    configurationError ??
    (!active.gameVersion?.trim()
      ? "RimWorld's version could not be read from ModsConfig.xml"
      : undefined);

  function openImport() {
    void perform(async () => {
      if (importDisabledReason) {
        return;
      }
      const imported = await run(() => getStore().importModList());
      if (!imported) {
        return;
      }
      setPlan(
        buildModListImportPlan(
          imported,
          actualImportMods,
          actualImportPanels.active,
          active.gameVersion,
          savedIds,
        ),
      );
      setNotice(`Loaded ${imported.fileName}; review the imported Active list`);
    });
  }

  function confirmImport() {
    void perform(() => {
      const openedPlan = requireValue(plan, "The imported mod-list preview is no longer open.");
      if (busy || draft.applying) {
        return;
      }
      if (importDisabledReason) {
        throw new Error(importDisabledReason);
      }
      // Re-resolve against the current inventory so a background metadata refresh cannot turn the
      // preview into a stale or partial draft. The draft store performs the final baseline check.
      const currentPlan = buildModListImportPlan(
        openedPlan.file,
        actualImportMods,
        actualImportPanels.active,
        active.gameVersion,
        savedIds,
      );
      if (modListImportPlanKey(currentPlan) !== modListImportPlanKey(openedPlan)) {
        setPlan(currentPlan);
        throw new Error(
          "The installed mods or Active list changed. Review the refreshed import preview before staging it.",
        );
      }
      draft.actions.stageImportedActiveList(
        actualImportPanels.active,
        currentPlan.targetMods,
        {
          savedIds,
          activeIds: actualImportPanels.activeIds,
          activePackageIds: active.packageIds,
          activeConfigTarget: normalizeActiveConfigTarget(settings),
          activeError: configurationError,
        },
        currentPlan.file.fileName,
      );
      workspaceActions.setSearch(modPanelModes.active, "");
      workspaceActions.setSort(modPanelModes.active, modSorts.loadOrder);
      workspaceActions.setModStatusFilter(modFilters.all);
      const targetIds = currentPlan.targetMods.map((mod) => mod.id);
      const firstTarget = targetIds[0];
      if (firstTarget) {
        workspaceActions.select(modPanelModes.active, targetIds, firstTarget);
      }
      setPlan(undefined);
      const unchanged =
        currentPlan.targetMods.length === actualImportPanels.active.length &&
        currentPlan.targetMods.every(
          (mod, index) => mod.id === actualImportPanels.active[index]?.id,
        );
      setNotice(
        unchanged
          ? `${currentPlan.file.fileName} already matches the current Active list`
          : `${currentPlan.file.fileName} staged: ${currentPlan.activatedMods.length} added, ${currentPlan.deactivatedMods.length} removed`,
      );
      if (currentPlan.missingPackageIds.length) {
        notifyWarning(
          `${currentPlan.missingPackageIds.length} unavailable ${currentPlan.missingPackageIds.length === 1 ? "package was" : "packages were"} omitted from the imported draft.`,
        );
      }
    });
  }

  function exportList() {
    void perform(async () => {
      if (exportDisabledReason) {
        return;
      }
      const packageIds = buildModListExportPackageIds(
        projectedActiveMods,
        activeMetadataVerified ? (active.installedMods ?? []) : [],
      );
      const result = await run(() =>
        getStore().exportModList({
          gameVersion: requireValue(
            active.gameVersion?.trim(),
            "RimWorld's version could not be read from ModsConfig.xml.",
          ),
          packageIds,
        }),
      );
      if (result) {
        const metadataNote = !activeMetadataVerified
          ? "; installed-copy hints were omitted because mod folders are unavailable"
          : "";
        const configurationNote = retainedActiveConfiguration
          ? "; used the last readable Active configuration"
          : "";
        setNotice(
          `Exported ${result.packageCount} ${result.packageCount === 1 ? "mod" : "mods"} to ${result.fileName}${metadataNote}${configurationNote}`,
        );
      }
    });
  }

  return {
    plan,
    importDisabledReason,
    exportDisabledReason,
    openImport,
    confirmImport,
    closeImport: () => {
      setPlan(undefined);
    },
    exportList,
  };
}
