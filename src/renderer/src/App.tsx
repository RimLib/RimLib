import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { steamStatusSources } from "../../shared/domainConstants";
import {
  isOfficialMod,
  isUsablePackageId,
  normalizePackageId,
  rimWorldPackages,
} from "../../shared/packages";
import { isWorkshopMod } from "../../shared/subscriptions";
import type { ImportedModList, Mod, ModVault } from "../../shared/types";
import { requireValue } from "../../shared/validation";
import { AppHeader } from "./components/AppHeader";
import { AppTopBar } from "./components/AppTopBar";
import { WorkspaceDraftBar } from "./components/common/DraftBar";
import { ErrorNotification } from "./components/common/ErrorNotification";
import { WorkspaceModContextMenu } from "./components/common/ModContextMenu";
import { PanelErrorBoundary } from "./components/common/PanelErrorBoundary";
import { AutoSortDependenciesModal } from "./components/modals/AutoSortDependenciesModal";
import { DraftChangesModal } from "./components/modals/DraftChangesModal";
import { ImportModListModal } from "./components/modals/ImportModListModal";
import { MoveActiveModModal } from "./components/modals/MoveActiveModModal";
import { SettingsModal } from "./components/modals/SettingsModal";
import { TagDialogs } from "./components/modals/TagDialogs";
import { ModInfoPanel } from "./components/panels/ModInfoPanel";
import { ModsPanel } from "./components/panels/ModsPanel";
import { SubscribedModsPanel } from "./components/panels/SubscribedModsPanel";
import { useActionNotifications } from "./hooks/useActionNotifications";
import { useActiveMods } from "./hooks/useActiveMods";
import { useDraftChanges } from "./hooks/useDraftChanges";
import { useFirebaseSync } from "./hooks/useFirebaseSync";
import { useModSelection } from "./hooks/useModSelection";
import { useModVault } from "./hooks/useModVault";
import { useSettingsDialog } from "./hooks/useSettingsDialog";
import { useSteamAvailability } from "./hooks/useSteamAvailability";
import { useTagDialogs } from "./hooks/useTagDialogs";
import { useWorkshopActions } from "./hooks/useWorkshopActions";
import { useWorkshopStatus } from "./hooks/useWorkshopStatus";
import { getStore } from "./services/modStore";
import {
  useDraftStore,
  useWorkspaceStore,
  WorkspaceStoreProvider,
} from "./stores/WorkspaceStoreProvider";
import { buildModViews } from "./utils/activeMods";
import {
  deriveActiveOrderMoves,
  moveActiveModRelative,
  moveActiveModsToPosition,
} from "./utils/activeOrder";
import { validateActiveMods } from "./utils/activeValidation";
import {
  type AutoSortDependencyPlan,
  autoSortDependencyPlanKey,
  buildAutoSortDependencyPlan,
  canStageAutoSortDependency,
} from "./utils/autoSortDependencies";
import { resolveDependencyTargets } from "./utils/dependencies";
import { hasStagedDependencyActivations } from "./utils/draftNotices";
import {
  activeOrderDraftKinds,
  type ActiveOrderDraftOperationInput,
  deriveDraftActivityDelta,
  type DraftAction,
  draftActions,
  draftActiveOrderTemplate,
  isActivityDraftAction,
  normalizeActiveConfigTarget,
  projectActivityPanels,
  stageActivationChanges,
} from "./utils/drafts";
import { reconcileInstalledModMetadata } from "./utils/installedModPersistence";
import {
  activityPanels,
  filterLibrary,
  filterModsByTag,
  matchesModTagFilter,
  modBatchAvailability,
  promoteModsToFront,
  resolveModPriorityId,
} from "./utils/library";
import { buildModListExportPackageIds } from "./utils/modListExport";
import {
  buildModListImportPlan,
  modListImportBaselineError,
  type ModListImportPlan,
  modListImportPlanKey,
} from "./utils/modListImport";
import { modTagTargets } from "./utils/modSelection";
import { sortActiveMods } from "./utils/modSort";
import { tagDialogActions, tagDialogKinds } from "./utils/tagDialogs";
import {
  modFilters,
  type ModPanelMode,
  modPanelModes,
  modSorts,
  modTagFilters,
} from "./utils/uiConstants";

function withPendingDraft(vault: ModVault, pendingDraft: ModVault["pendingDraft"]): ModVault {
  if (JSON.stringify(vault.pendingDraft) === JSON.stringify(pendingDraft)) {
    return vault;
  }
  // Keep an explicit undefined value in runtime state so VaultStore's conservative merge can
  // distinguish clearing a completed/discarded draft from an omitted future field.
  return { ...vault, pendingDraft };
}

function App() {
  return (
    <WorkspaceStoreProvider>
      <Workspace />
    </WorkspaceStoreProvider>
  );
}

function Workspace() {
  const [notice, setNoticeValue] = useState("Loaded local mod library");
  const [dependencyDraftNotice, setDependencyDraftNotice] = useState<{
    message: string;
    modIds: readonly string[];
  }>();
  const dependencyDraftNoticeWasCurrent = useRef(false);
  const setNotice = useCallback((message: string) => {
    dependencyDraftNoticeWasCurrent.current = false;
    setDependencyDraftNotice(undefined);
    setNoticeValue(message);
  }, []);
  const showDependencyDraftNotice = useCallback((message: string, modIds: readonly string[]) => {
    dependencyDraftNoticeWasCurrent.current = false;
    setDependencyDraftNotice({ message, modIds });
  }, []);
  const { notification, notifyError, notifyWarning, perform, dismiss } = useActionNotifications();
  const { refresh: refreshSteam } = useSteamAvailability();
  const draftPersistenceActions = useDraftStore((state) => state.actions);
  const draftPersistenceStatus = useRef<"waiting" | "hydrating" | "ready" | "failed">("waiting");
  const [draftHydrated, setDraftHydrated] = useState(false);
  const prepareVaultForSave = useCallback(
    (currentVault: ModVault) =>
      draftPersistenceStatus.current === "ready"
        ? withPendingDraft(currentVault, draftPersistenceActions.getPendingDraft())
        : currentVault,
    [draftPersistenceActions],
  );
  const { vault, loaded, loadError, busy, update, adopt, run, deleteTag } = useModVault(
    notifyError,
    prepareVaultForSave,
  );
  const { mods, userTags: tags, settings = {} } = vault;
  const folderBased = vault.localSteamState.source === steamStatusSources.workshopFolders;
  const {
    active,
    loading: activeLoading,
    checkingConfiguration: activeCheckingConfiguration,
    metadataLoading: activeMetadataLoading,
    refreshing: activeRefreshing,
    refresh: refreshActive,
    adoptActive,
  } = useActiveMods(settings, loaded);
  useEffect(() => {
    if (!loaded || busy || active.installedMods === undefined) {
      return;
    }
    const observedAt = new Date().toISOString();
    update((previous) =>
      reconcileInstalledModMetadata(previous, active.installedMods ?? [], observedAt),
    );
  }, [active.installedMods, busy, loaded, update]);
  const libraryView = useWorkspaceStore((state) => state.views.unsubscribed);
  const {
    search,
    searchScope,
    sort,
    filter: libraryFilter,
    tagFilter: libraryTagFilter,
  } = libraryView;
  const {
    search: activeSearch,
    searchScope: activeSearchScope,
    sort: activeSort,
    filter: activeFilter,
    tagFilter: activeTagFilter,
  } = useWorkspaceStore((state) => state.views.subscribed);
  const contextMenu = useWorkspaceStore((state) => state.contextMenu);
  const focusedModId = useWorkspaceStore((state) => state.focusedModId);
  const workspaceActions = useWorkspaceStore((state) => state.actions);
  const closeContextMenu = workspaceActions.closeContext;
  const tagIds = useMemo(() => new Set(tags.map((tag) => tag.id)), [tags]);
  const effectiveLibraryTagFilter =
    libraryTagFilter && !tagIds.has(libraryTagFilter) ? modTagFilters.all : libraryTagFilter;
  const effectiveActiveTagFilter =
    activeTagFilter && !tagIds.has(activeTagFilter) ? modTagFilters.all : activeTagFilter;
  useEffect(() => {
    if (effectiveLibraryTagFilter !== libraryTagFilter) {
      workspaceActions.setTagFilter(modPanelModes.inactive, effectiveLibraryTagFilter);
    }
    if (effectiveActiveTagFilter !== activeTagFilter) {
      workspaceActions.setTagFilter(modPanelModes.active, effectiveActiveTagFilter);
    }
  }, [
    activeTagFilter,
    effectiveActiveTagFilter,
    effectiveLibraryTagFilter,
    libraryTagFilter,
    workspaceActions,
  ]);
  const [refreshingModId, setRefreshingModId] = useState<string>();
  const [revealingFolder, setRevealingFolder] = useState(false);
  const activeRevealSequence = useRef(0);
  const [activeRevealRequest, setActiveRevealRequest] = useState<{
    modId: string;
    key: number;
  }>();
  const [autoSortDependencyPlan, setAutoSortDependencyPlan] = useState<AutoSortDependencyPlan>();
  const [moveActiveRequest, setMoveActiveRequest] = useState<{
    modId: string;
    modName: string;
    initialPosition: number;
  }>();
  const [modListImportPlan, setModListImportPlan] = useState<ModListImportPlan>();
  const [libraryPromotion, setLibraryPromotion] = useState<{
    view: typeof libraryView;
    mods: readonly Pick<Mod, "id" | "packageId">[];
  }>();
  const initialSelectionSettled = useRef(false);
  const initialSelectionTarget = useRef<
    { id: string; packageId?: string; panel: ModPanelMode } | undefined
  >(undefined);
  const folderRequest = useRef(false);
  const tagDialogs = useTagDialogs({ busy, update, deleteTag, perform, setNotice });
  const { assign: assignTags } = tagDialogs;
  const firebaseSync = useFirebaseSync({
    vault,
    loaded,
    busy,
    run,
    adopt,
    notifyError,
    setNotice,
  });
  const settingsDialog = useSettingsDialog({
    settings,
    loaded,
    busy,
    run,
    adopt,
    adoptActive,
    notifyError,
    perform,
    setNotice,
    firebaseSync,
  });

  // About.xml metadata corrects stale saved identities and also exposes disabled local mods/DLC.
  const modViews = useMemo(() => buildModViews(active, mods), [active, mods]);
  const displayMods = modViews.allEntries;
  const savedIds = useMemo(() => new Set(mods.map((mod) => mod.id)), [mods]);
  const actualPanels = useMemo(
    () =>
      activityPanels(
        { localSteamState: vault.localSteamState },
        displayMods,
        modViews.activeEntries,
      ),
    [vault.localSteamState, displayMods, modViews.activeEntries],
  );
  const draft = useDraftChanges({
    run,
    adopt,
    adoptActive,
    refreshActive,
    refreshSteam,
    notifyError,
    setNotice,
    settings,
  });
  const actualMods = useMemo(
    () => [...actualPanels.inactive, ...actualPanels.active],
    [actualPanels],
  );
  useEffect(() => {
    if (!loaded || draftPersistenceStatus.current !== "waiting") {
      return;
    }
    draftPersistenceStatus.current = "hydrating";
    try {
      draftPersistenceActions.hydratePendingDraft(vault.pendingDraft, actualMods);
      draftPersistenceStatus.current = "ready";
      setDraftHydrated(true);
    } catch (error) {
      draftPersistenceStatus.current = "failed";
      notifyError(
        `Saved pending changes could not be restored and were left untouched. ${String(error)}`,
      );
    }
  }, [actualMods, draftPersistenceActions, loaded, notifyError, vault.pendingDraft]);
  useEffect(() => {
    draft.actions.rebaseActivityChanges(actualMods);
  }, [actualMods, draft.actions]);
  useEffect(() => {
    if (!draftHydrated || busy) {
      return;
    }
    update((previous) => withPendingDraft(previous, draftPersistenceActions.getPendingDraft()));
  }, [
    busy,
    draft.activeBasePackageIds,
    draft.activeOrder,
    draft.activeOrderOperations,
    draft.changes,
    draftHydrated,
    draftPersistenceActions,
    update,
  ]);
  const draftActionsById = useMemo(() => {
    const result = new Map<string, DraftAction[]>();
    for (const change of draft.changes) {
      result.set(change.mod.id, [...(result.get(change.mod.id) ?? []), change.action]);
    }
    return result;
  }, [draft.changes]);
  const draftActivityDelta = useMemo(
    () => deriveDraftActivityDelta(draft.changes),
    [draft.changes],
  );
  const membershipPanels = useMemo(
    () => projectActivityPanels(actualPanels.inactive, actualPanels.active, draft.changes),
    [actualPanels, draft.changes],
  );
  const projectedActiveOrder = useMemo(
    () =>
      draft.activeOrder ??
      draftActiveOrderTemplate(draft.activeBasePackageIds ?? active.packageIds, draft.changes),
    [active.packageIds, draft.activeBasePackageIds, draft.activeOrder, draft.changes],
  );
  const panels = useMemo(
    () =>
      projectActivityPanels(
        actualPanels.inactive,
        actualPanels.active,
        draft.changes,
        projectedActiveOrder,
      ),
    [actualPanels, draft.changes, projectedActiveOrder],
  );
  const restoreTargets = useMemo(
    () => panels.active.filter((mod) => !isOfficialMod(mod)),
    [panels.active],
  );
  const inactiveCountByTagId = useMemo(
    () =>
      new Map(
        tags.map((tag) => [
          tag.id,
          panels.inactive.filter((mod) => mod.userTagIds?.includes(tag.id)).length,
        ]),
      ),
    [panels.inactive, tags],
  );
  const autoSortDependencyCandidates = useMemo(
    () => membershipPanels.inactive.filter((mod) => canStageAutoSortDependency(mod, savedIds)),
    [membershipPanels.inactive, savedIds],
  );
  const activeValidation = useMemo(
    () => validateActiveMods(panels.active, active.gameVersion),
    [panels.active, active.gameVersion],
  );
  const missingDependenciesById = activeValidation.missingDependenciesById;
  const actualById = useMemo(
    () => new Map([...actualPanels.inactive, ...actualPanels.active].map((mod) => [mod.id, mod])),
    [actualPanels],
  );
  const workshopStatus = useWorkshopStatus(
    loaded,
    Boolean(
      busy ||
      draft.reviewOpen ||
      draft.changes.length ||
      draft.activeOrder ||
      settingsDialog.isOpen ||
      tagDialogs.dialog.kind !== tagDialogKinds.closed ||
      contextMenu ||
      autoSortDependencyPlan ||
      moveActiveRequest ||
      modListImportPlan,
    ),
    settings.workshopModsPath,
    update,
  );
  const workshop = useWorkshopActions({
    run,
    adopt,
    adoptActive,
    refreshActive,
    perform,
    notifyError,
    notifyWarning,
    onWorkshopStatus: workshopStatus.record,
    setNotice,
  });
  const { progress } = workshop;
  // Steam availability is deliberately checked only when the draft is confirmed. Keeping the
  // staging controls independent from the current client state lets users prepare a complete
  // draft while Steam is closed without weakening the apply-time safety check.
  const draftControlsDisabledReason =
    busy || draft.applying ? "An operation is in progress" : undefined;
  const draftControlsDisabled = busy || draft.applying;
  const activeConfigurationError =
    active.error ??
    (activeLoading || activeCheckingConfiguration ? "Checking active mods..." : undefined);
  const activeMetadataUnavailable =
    active.metadataError ??
    (activeMetadataLoading
      ? "Installed mod details are still loading."
      : active.installedMods === undefined
        ? "Installed mod details are unavailable. Use Sync Workshop to retry."
        : undefined);
  const activeMetadataVerified =
    activeMetadataUnavailable === undefined && active.installedMods !== undefined;
  const modListActualPanels = useMemo(() => {
    if (activeMetadataVerified) {
      return actualPanels;
    }
    const planningViews = buildModViews({ ...active, installedMods: undefined }, mods);
    return activityPanels(
      { localSteamState: vault.localSteamState },
      planningViews.allEntries,
      planningViews.activeEntries,
    );
  }, [active, activeMetadataVerified, actualPanels, mods, vault.localSteamState]);
  const modListActualMods = useMemo(
    () => [...modListActualPanels.inactive, ...modListActualPanels.active],
    [modListActualPanels],
  );
  const activeSafetyError = activeConfigurationError ?? activeMetadataUnavailable;
  const restoreDisabledReason =
    draftControlsDisabledReason ??
    activeConfigurationError ??
    (!restoreTargets.length ? "Only RimWorld and DLC are active" : undefined);
  const addTagToActiveDisabledReason = draftControlsDisabledReason ?? activeConfigurationError;
  const importBaselineError = modListImportBaselineError(active.packageIds);
  const retainedActiveConfiguration = Boolean(
    active.error &&
    active.packageIds.length > 0 &&
    active.gameVersion?.trim() &&
    !importBaselineError,
  );
  const modListConfigurationError = retainedActiveConfiguration
    ? undefined
    : activeConfigurationError;
  const importModListDisabledReason =
    draftControlsDisabledReason ??
    modListConfigurationError ??
    importBaselineError ??
    (draft.changes.length || draft.activeOrderOperations.length
      ? "Apply or discard the pending draft before importing a mod list"
      : undefined);
  const exportModListDisabledReason =
    draftControlsDisabledReason ??
    modListConfigurationError ??
    (!active.gameVersion?.trim()
      ? "RimWorld's version could not be read from ModsConfig.xml"
      : undefined);
  const inactiveSubscribedModIds = useMemo(
    () =>
      panels.inactive
        .filter((mod) => mod.subscribed && savedIds.has(mod.id) && isWorkshopMod(mod))
        .map((mod) => mod.id),
    [panels.inactive, savedIds],
  );
  const cleanupDisabledReason =
    draftControlsDisabledReason ??
    (!inactiveSubscribedModIds.length
      ? "No subscribed inactive Workshop mods to unsubscribe"
      : undefined);
  const selectedMod =
    panels.active.find((mod) => mod.id === focusedModId) ??
    panels.inactive.find((mod) => mod.id === focusedModId) ??
    panels.active[0] ??
    panels.inactive[0];
  const promotedInactiveIds = useMemo(() => {
    if (libraryPromotion?.view !== libraryView) {
      return undefined;
    }
    const inactiveIds = new Set(panels.inactive.map((mod) => mod.id));
    return libraryPromotion.mods.flatMap((priority) => {
      const id = resolveModPriorityId(actualMods, priority);
      return id && inactiveIds.has(id) ? [id] : [];
    });
  }, [actualMods, libraryPromotion, libraryView, panels.inactive]);
  const effectiveLibraryFilter =
    libraryFilter === modFilters.pendingDeactivation && !draftActivityDelta.deactivatedIds.size
      ? modFilters.all
      : libraryFilter;
  const effectiveActiveFilter =
    activeFilter === modFilters.pendingActivation && !draftActivityDelta.activatedIds.size
      ? modFilters.all
      : activeFilter;
  const filteredInactive = useMemo(() => {
    const filtered = filterLibrary(
      filterModsByTag(panels.inactive, effectiveLibraryTagFilter),
      search,
      searchScope,
      sort,
      tags,
    );
    const statusFiltered =
      effectiveLibraryFilter === modFilters.pendingDeactivation
        ? filtered.filter((mod) => draftActivityDelta.deactivatedIds.has(mod.id))
        : filtered;
    return promoteModsToFront(statusFiltered, promotedInactiveIds);
  }, [
    panels.inactive,
    promotedInactiveIds,
    search,
    searchScope,
    sort,
    tags,
    effectiveLibraryTagFilter,
    effectiveLibraryFilter,
    draftActivityDelta.deactivatedIds,
  ]);
  const filteredActive = useMemo(() => {
    const searchedAndSorted = filterLibrary(
      filterModsByTag(panels.active, effectiveActiveTagFilter),
      activeSearch,
      activeSearchScope,
      activeSort,
      tags,
      panels.activeOrder,
      activeValidation.invalidModIds,
    );
    if (effectiveActiveFilter === modFilters.invalid) {
      return searchedAndSorted.filter((mod) => activeValidation.invalidModIds.has(mod.id));
    }
    if (effectiveActiveFilter === modFilters.pendingActivation) {
      return searchedAndSorted.filter((mod) => draftActivityDelta.activatedIds.has(mod.id));
    }
    return searchedAndSorted;
  }, [
    panels.active,
    activeSearch,
    activeSearchScope,
    activeSort,
    effectiveActiveFilter,
    effectiveActiveTagFilter,
    tags,
    panels.activeOrder,
    activeValidation.invalidModIds,
    draftActivityDelta.activatedIds,
  ]);
  useEffect(() => {
    const staleNewFilter =
      activeFilter === modFilters.pendingActivation && !draftActivityDelta.activatedIds.size;
    const staleRemovedFilter =
      libraryFilter === modFilters.pendingDeactivation && !draftActivityDelta.deactivatedIds.size;
    if (staleNewFilter || staleRemovedFilter) {
      workspaceActions.setModStatusFilter(modFilters.all);
    }
  }, [activeFilter, draftActivityDelta, libraryFilter, workspaceActions]);
  const focusedId = selectedMod?.id;
  const selection = useModSelection(filteredInactive, filteredActive);
  useEffect(() => {
    if (!libraryPromotion) {
      return;
    }
    if (libraryPromotion.view !== libraryView) {
      setLibraryPromotion(undefined);
      return;
    }
    const inactiveIds = new Set(panels.inactive.map((mod) => mod.id));
    const pendingDeactivationIds = new Set(
      draft.changes.flatMap((change) => {
        if (change.action !== draftActions.deactivate) {
          return [];
        }
        const id = resolveModPriorityId(actualMods, change.mod);
        return id ? [id] : [];
      }),
    );
    const remaining = libraryPromotion.mods.filter((priority) => {
      const id = resolveModPriorityId(actualMods, priority);
      return Boolean(id && (inactiveIds.has(id) || pendingDeactivationIds.has(id)));
    });
    if (remaining.length !== libraryPromotion.mods.length) {
      setLibraryPromotion(remaining.length ? { ...libraryPromotion, mods: remaining } : undefined);
    }
  }, [actualMods, draft.changes, libraryPromotion, libraryView, panels.inactive]);
  useEffect(() => {
    if (initialSelectionSettled.current || !loaded || activeLoading) {
      return;
    }
    const automaticTarget = initialSelectionTarget.current;
    if (automaticTarget) {
      if (focusedModId && focusedModId !== automaticTarget.id) {
        initialSelectionSettled.current = true;
        initialSelectionTarget.current = undefined;
        return;
      }
      const candidates =
        automaticTarget.panel === modPanelModes.active ? panels.active : panels.inactive;
      const targetStillExists = candidates.some((mod) => mod.id === automaticTarget.id);
      if (!targetStillExists) {
        const replacement =
          candidates.find(
            (mod) =>
              automaticTarget.packageId &&
              mod.packageId &&
              normalizePackageId(mod.packageId) === automaticTarget.packageId,
          ) ?? candidates[0];
        if (replacement) {
          workspaceActions.select(
            automaticTarget.panel,
            candidates.map((mod) => mod.id),
            replacement.id,
          );
          initialSelectionTarget.current = {
            id: replacement.id,
            packageId: replacement.packageId
              ? normalizePackageId(replacement.packageId)
              : undefined,
            panel: automaticTarget.panel,
          };
        }
      }
      if (!activeMetadataLoading) {
        initialSelectionSettled.current = true;
        initialSelectionTarget.current = undefined;
      }
      return;
    }
    if (focusedModId || selection.ids.length) {
      initialSelectionSettled.current = true;
      return;
    }
    const activeTarget = panels.active[0];
    const target = activeTarget ?? (active.error ? undefined : panels.inactive[0]);
    if (!target) {
      if (!active.error && !activeMetadataLoading) {
        initialSelectionSettled.current = true;
      }
      return;
    }
    const mode = activeTarget ? modPanelModes.active : modPanelModes.inactive;
    const orderedIds = (activeTarget ? panels.active : panels.inactive).map((mod) => mod.id);
    workspaceActions.select(mode, orderedIds, target.id);
    initialSelectionTarget.current = {
      id: target.id,
      packageId: target.packageId ? normalizePackageId(target.packageId) : undefined,
      panel: mode,
    };
    if (!activeMetadataLoading) {
      initialSelectionSettled.current = true;
      initialSelectionTarget.current = undefined;
    }
  }, [
    active.error,
    activeLoading,
    activeMetadataLoading,
    focusedModId,
    loaded,
    panels.active,
    panels.inactive,
    selection.ids.length,
    workspaceActions,
  ]);
  const projectedInactiveById = useMemo(
    () => new Map(panels.inactive.map((mod) => [mod.id, mod])),
    [panels.inactive],
  );
  const infoModIds = focusedId ? modTagTargets(selection, focusedId) : [];
  const infoRemovalMods = infoModIds.flatMap((id) => {
    const mod = actualById.get(id);
    return mod ? [mod] : [];
  });
  const infoRemovalAvailability = modBatchAvailability(
    infoRemovalMods,
    savedIds,
    draftControlsDisabled,
    panels.activeIds,
  );
  const infoRemovalReason = draftControlsDisabled
    ? "An operation is in progress"
    : infoRemovalMods.length !== infoModIds.length ||
        infoModIds.some((id) => !savedIds.has(id) || !projectedInactiveById.has(id))
      ? "Only saved, inactive mods can be removed from the library"
      : infoRemovalAvailability.removalDisabledReason;
  const infoRemovalRequiresUnsubscribe = infoRemovalMods.some((mod) => mod.subscribed);
  const contextMods = useMemo(() => {
    if (!contextMenu) {
      return [];
    }
    const ids = new Set(contextMenu.modIds);
    return (contextMenu.panel === modPanelModes.active ? filteredActive : filteredInactive).filter(
      (mod) => ids.has(mod.id),
    );
  }, [contextMenu, filteredActive, filteredInactive]);
  const contextRemovalMods = contextMods.flatMap((mod) => {
    const actual = actualById.get(mod.id);
    return actual ? [actual] : [];
  });
  const contextAvailability = modBatchAvailability(
    contextRemovalMods,
    savedIds,
    draftControlsDisabled,
    panels.activeIds,
  );
  if (contextMenu?.panel === modPanelModes.active) {
    contextAvailability.removalDisabledReason =
      "Deactivate mods before removing them from the library";
  }
  const contextRemovalRequiresUnsubscribe = contextRemovalMods.some((mod) => mod.subscribed);
  const subscribeTargets = contextMods.filter((mod) => !mod.subscribed);
  const unsubscribeTargets = contextMods.filter((mod) => mod.subscribed);
  const subscribeAvailability = modBatchAvailability(
    subscribeTargets,
    savedIds,
    draftControlsDisabled,
  );
  const unsubscribeAvailability = modBatchAvailability(
    unsubscribeTargets,
    savedIds,
    draftControlsDisabled,
    panels.activeIds,
  );
  const subscribeDisabledReason = subscribeTargets.length
    ? subscribeAvailability.subscriptionDisabledReason
    : "All selected mods are already subscribed";
  const unsubscribeDisabledReason = unsubscribeTargets.length
    ? unsubscribeAvailability.subscriptionDisabledReason
    : "No selected mods are subscribed";
  const contextPositionDisabledReason =
    contextMenu?.panel !== modPanelModes.active
      ? undefined
      : (draftControlsDisabledReason ??
        activeConfigurationError ??
        (contextMenu.modIds.length !== 1
          ? "Select one active mod to move it to an exact position"
          : panels.active.length < 2
            ? "At least two active mods are required"
            : panels.active.some((mod) => mod.id === contextMenu.modIds[0])
              ? undefined
              : "The selected active mod is no longer available"));
  const contextIncludesCore =
    contextMenu?.panel === modPanelModes.active &&
    contextMods.some((mod) => normalizePackageId(mod.packageId ?? "") === rimWorldPackages.core);
  const contextActivityDisabledReason =
    draftControlsDisabledReason ??
    activeConfigurationError ??
    (contextIncludesCore ? "RimWorld Core must remain active" : undefined);

  function openBulkTags(assigned: boolean) {
    if (!contextMenu || contextAvailability.tagsDisabledReason) {
      return;
    }
    tagDialogs.dispatch({ type: tagDialogActions.bulk, assigned, modIds: contextMenu.modIds });
    closeContextMenu();
  }

  const onAssignTag = useCallback(
    (modId: string, tagId: string, assigned: boolean) => {
      assignTags(modTagTargets(selection, modId), [tagId], assigned);
    },
    [selection, assignTags],
  );

  function stageChanges(action: DraftAction, ids: string[], onStaged?: () => void) {
    void perform(() => {
      if (busy || draft.applying || !ids.length) {
        return;
      }
      if (isActivityDraftAction(action) && activeConfigurationError) {
        throw new Error(activeConfigurationError);
      }
      const targets = [...new Set(ids)].map((id) =>
        requireValue(actualById.get(id), "A selected mod is no longer available."),
      );
      const policy = {
        savedIds,
        activeIds: actualPanels.activeIds,
        activePackageIds: active.packageIds,
        activeConfigTarget: normalizeActiveConfigTarget(settings),
        activeError: action === draftActions.activate ? activeConfigurationError : undefined,
      };
      if (action === draftActions.activate) {
        draft.actions.stageActivation(targets, policy);
        revealAddedActiveMod(targets);
      } else {
        draft.actions.stage(targets, action, policy);
        if (action === draftActions.deactivate) {
          setLibraryPromotion((current) => {
            const previous = current?.view === libraryView ? current.mods : [];
            const next = targets.map(({ id, packageId }) => ({ id, packageId }));
            const nextIds = new Set(next.map((mod) => mod.id));
            return {
              view: libraryView,
              mods: [...next, ...previous.filter((mod) => !nextIds.has(mod.id))],
            };
          });
        }
      }
      onStaged?.();
      closeContextMenu();
    });
  }

  function restoreActiveList() {
    if (restoreDisabledReason) {
      return;
    }
    const count = restoreTargets.length;
    stageChanges(
      draftActions.deactivate,
      restoreTargets.map((mod) => mod.id),
      () => {
        setNotice(
          `Restore staged: ${count} non-official ${count === 1 ? "mod" : "mods"} removed from Active`,
        );
      },
    );
  }

  function addTagToActive(tagId: string) {
    if (addTagToActiveDisabledReason) {
      return;
    }
    const tag = tags.find((candidate) => candidate.id === tagId);
    const targets = panels.inactive.filter((mod) => mod.userTagIds?.includes(tagId));
    if (!tag || !targets.length) {
      return;
    }
    stageChanges(
      draftActions.activate,
      targets.map((mod) => mod.id),
      () => {
        setNotice(
          `${targets.length} ${targets.length === 1 ? "mod" : "mods"} tagged “${tag.name}” staged for activation`,
        );
      },
    );
  }

  function revealAddedActiveMod(targets: readonly Mod[]) {
    const focusTarget = targets[0];
    if (!focusTarget) {
      return;
    }
    const targetMatchesSearch = filterLibrary(
      [focusTarget],
      activeSearch,
      activeSearchScope,
      activeSort,
      tags,
      panels.activeOrder,
      activeValidation.invalidModIds,
    ).length;
    if (!targetMatchesSearch) {
      workspaceActions.setSearch(modPanelModes.active, "");
    }
    if (!matchesModTagFilter(focusTarget, effectiveActiveTagFilter)) {
      workspaceActions.setTagFilter(modPanelModes.active, modTagFilters.all);
    }
    if (activeFilter === modFilters.invalid) {
      workspaceActions.setModStatusFilter(modFilters.all);
    }
    workspaceActions.select(
      modPanelModes.active,
      [...new Set([...panels.active.map((mod) => mod.id), ...targets.map((mod) => mod.id)])],
      focusTarget.id,
    );
    activeRevealSequence.current += 1;
    setActiveRevealRequest({
      modId: focusTarget.id,
      key: activeRevealSequence.current,
    });
  }

  function requestLibraryRemoval(ids: string[]) {
    void perform(() => {
      if (busy || draft.applying || !ids.length) {
        return;
      }
      const targets = [...new Set(ids)].map((id) =>
        requireValue(actualById.get(id), "A selected mod is no longer available."),
      );
      draft.actions.stageRemoval(targets, {
        savedIds,
        activeIds: actualPanels.activeIds,
        activePackageIds: active.packageIds,
        activeConfigTarget: normalizeActiveConfigTarget(settings),
      });
      closeContextMenu();
    });
  }

  function unsubscribeInactiveMods() {
    if (!cleanupDisabledReason) {
      stageChanges(draftActions.unsubscribe, inactiveSubscribedModIds);
    }
  }

  function stageProjectedActiveOrder(
    nextMods: readonly Mod[],
    operation: ActiveOrderDraftOperationInput,
    message: string,
  ) {
    if (activeConfigurationError) {
      throw new Error(activeConfigurationError);
    }
    const currentIds = new Set(panels.active.map((mod) => mod.id));
    if (
      nextMods.length !== panels.active.length ||
      new Set(nextMods.map((mod) => mod.id)).size !== currentIds.size ||
      nextMods.some((mod) => !currentIds.has(mod.id))
    ) {
      throw new Error("The Active list changed before the new load order could be staged.");
    }
    const normalizedPackageIds = new Set<string>();
    const packageIds = nextMods.map((mod) => {
      if (!isUsablePackageId(mod.packageId)) {
        throw new Error(`${mod.name} has no usable package ID and cannot be reordered.`);
      }
      const normalized = normalizePackageId(mod.packageId);
      if (normalizedPackageIds.has(normalized)) {
        throw new Error(`More than one active mod uses package ID ${mod.packageId}.`);
      }
      normalizedPackageIds.add(normalized);
      return mod.packageId;
    });
    draft.actions.setActiveOrder(
      packageIds,
      active.packageIds,
      normalizeActiveConfigTarget(settings),
      operation,
    );
    setNotice(message);
  }

  function reorderActiveMod(sourceId: string, targetId: string, placement: "before" | "after") {
    void perform(() => {
      if (busy || draft.applying) {
        return;
      }
      const next = moveActiveModRelative(panels.active, sourceId, targetId, placement);
      if (next === panels.active) {
        return;
      }
      const source = requireValue(
        panels.active.find((mod) => mod.id === sourceId),
        "The dragged active mod is no longer available.",
      );
      const fromPosition = panels.active.findIndex((mod) => mod.id === sourceId) + 1;
      const position = next.findIndex((mod) => mod.id === sourceId) + 1;
      stageProjectedActiveOrder(
        next,
        {
          kind: activeOrderDraftKinds.manual,
          method: "drag",
          packageId: requireValue(
            source.packageId,
            `${source.name} has no package ID and cannot be reordered.`,
          ),
          modId: source.id,
          modName: source.name,
          fromPosition,
          toPosition: position,
        },
        `${source.name} staged at active position ${position}`,
      );
    });
  }

  function openActivePositionDialog() {
    if (!contextMenu || contextPositionDisabledReason) {
      return;
    }
    const modId = requireValue(contextMenu.modIds[0], "Select an active mod to move.");
    const initialPosition = panels.active.findIndex((mod) => mod.id === modId) + 1;
    const mod = requireValue(
      panels.active[initialPosition - 1],
      "The selected active mod is no longer available.",
    );
    setMoveActiveRequest({ modId, modName: mod.name, initialPosition });
    closeContextMenu();
  }

  function confirmActivePosition(position: number) {
    void perform(() => {
      if (busy || draft.applying) {
        return;
      }
      const request = requireValue(moveActiveRequest, "The move dialog is no longer open.");
      const next = moveActiveModsToPosition(panels.active, [request.modId], position);
      if (next === panels.active) {
        setMoveActiveRequest(undefined);
        return;
      }
      const mod = requireValue(
        panels.active.find((entry) => entry.id === request.modId),
        "The selected active mod is no longer available.",
      );
      const fromPosition = panels.active.findIndex((entry) => entry.id === request.modId) + 1;
      const toPosition = next.findIndex((entry) => entry.id === request.modId) + 1;
      stageProjectedActiveOrder(
        next,
        {
          kind: activeOrderDraftKinds.manual,
          method: "position",
          packageId: requireValue(
            mod.packageId,
            `${mod.name} has no package ID and cannot be reordered.`,
          ),
          modId: mod.id,
          modName: mod.name,
          fromPosition,
          toPosition,
        },
        `${mod.name} staged at active position ${toPosition}`,
      );
      setMoveActiveRequest(undefined);
    });
  }

  function fixDependencies(id: string) {
    void perform(() => {
      if (busy || draft.applying) {
        return;
      }
      if (activeConfigurationError) {
        throw new Error(activeConfigurationError);
      }
      const missing = missingDependenciesById.get(id) ?? [];
      if (!missing.length) {
        return;
      }
      const projectedTargets = resolveDependencyTargets(missing, panels.inactive);
      const targets = projectedTargets.map((mod) =>
        requireValue(actualById.get(mod.id), "A dependency is no longer available in Library."),
      );
      draft.actions.stageActivation(targets, {
        savedIds,
        activeIds: actualPanels.activeIds,
        activePackageIds: active.packageIds,
        activeConfigTarget: normalizeActiveConfigTarget(settings),
        activeError: activeConfigurationError,
      });
      revealAddedActiveMod(targets);
      showDependencyDraftNotice(
        `${targets.length} dependenc${targets.length === 1 ? "y" : "ies"} staged for activation`,
        targets.map((mod) => mod.id),
      );
    });
  }

  function stageAutoSortActiveMods(dependencyTargets: readonly Mod[]) {
    if (busy || draft.applying) {
      return;
    }
    if (activeSafetyError) {
      throw new Error(activeSafetyError);
    }
    const requestedTargets = dependencyTargets.map((mod) =>
      requireValue(actualById.get(mod.id), "A dependency is no longer available in Library."),
    );
    const projectedActiveIds = new Set(membershipPanels.active.map((mod) => mod.id));
    const targetById = new Map(requestedTargets.map((mod) => [mod.id, mod]));
    const targets = membershipPanels.inactive.flatMap((mod) => {
      const target = targetById.get(mod.id);
      return target && !projectedActiveIds.has(mod.id) ? [target] : [];
    });
    if (targets.length !== targetById.size) {
      throw new Error("A dependency is no longer available in Library.");
    }
    const activationPolicy = {
      savedIds,
      activeIds: actualPanels.activeIds,
      activePackageIds: active.packageIds,
      activeConfigTarget: normalizeActiveConfigTarget(settings),
      activeError: activeSafetyError,
    };
    const proposedChanges = targets.length
      ? stageActivationChanges(draft.changes, targets, activationPolicy)
      : draft.changes;
    const sourceOrder = draftActiveOrderTemplate(
      draft.activeBasePackageIds ?? active.packageIds,
      proposedChanges,
    );
    const modsToSort = projectActivityPanels(
      actualPanels.inactive,
      actualPanels.active,
      proposedChanges,
      sourceOrder,
    ).active;
    // Work out the complete order first so a sort failure cannot leave a partial dependency draft.
    const result = sortActiveMods(modsToSort, active.gameVersion);
    if (!result.ok) {
      throw new Error(result.message);
    }
    const packageIds = result.mods.map((mod) =>
      requireValue(mod.packageId, `${mod.name} has no package ID and cannot be sorted.`),
    );
    const moves = requireValue(
      deriveActiveOrderMoves(modsToSort, result.mods),
      "The Active list changed before its auto-sort actions could be staged.",
    );
    if (targets.length) {
      draft.actions.stageActivation(targets, activationPolicy);
    }
    draft.actions.replaceActiveOrder(
      packageIds,
      active.packageIds,
      normalizeActiveConfigTarget(settings),
      moves.map(({ item, fromPosition, toPosition }) => ({
        kind: activeOrderDraftKinds.autoSort,
        packageId: requireValue(
          item.packageId,
          `${item.name} has no package ID and cannot be sorted.`,
        ),
        modId: item.id,
        modName: item.name,
        fromPosition,
        toPosition,
      })),
    );
    workspaceActions.setSort(modPanelModes.active, modSorts.loadOrder);
    setAutoSortDependencyPlan(undefined);
    if (targets.length) {
      revealAddedActiveMod(targets);
    }
    const firstWarning = result.warnings[0];
    const warningSuffix = firstWarning
      ? `; ${firstWarning.message}${result.warnings.length > 1 ? ` (+${result.warnings.length - 1} more)` : ""}`
      : "";
    const message = `Auto-sort staged: ${result.stats.movedCount} active mod${result.stats.movedCount === 1 ? "" : "s"} moved${warningSuffix}`;
    if (targets.length) {
      showDependencyDraftNotice(
        `${targets.length} dependenc${targets.length === 1 ? "y" : "ies"} staged for activation; ${message}`,
        targets.map((mod) => mod.id),
      );
    } else {
      setNotice(message);
    }
  }

  function autoSortActiveMods() {
    void perform(() => {
      if (busy || draft.applying) {
        return;
      }
      if (activeSafetyError) {
        throw new Error(activeSafetyError);
      }
      const plan = buildAutoSortDependencyPlan(
        membershipPanels.active,
        autoSortDependencyCandidates,
        active.gameVersion,
      );
      if (plan.entries.length) {
        setAutoSortDependencyPlan(plan);
        return;
      }
      stageAutoSortActiveMods([]);
    });
  }

  function confirmAutoSortActiveMods(dependencyTargets: readonly Mod[]) {
    void perform(() => {
      if (activeSafetyError) {
        throw new Error(activeSafetyError);
      }
      const reviewedPlan = requireValue(
        autoSortDependencyPlan,
        "The dependency review is no longer open.",
      );
      const currentPlan = buildAutoSortDependencyPlan(
        membershipPanels.active,
        autoSortDependencyCandidates,
        active.gameVersion,
      );
      if (autoSortDependencyPlanKey(currentPlan) !== autoSortDependencyPlanKey(reviewedPlan)) {
        setAutoSortDependencyPlan(currentPlan.entries.length ? currentPlan : undefined);
        throw new Error(
          "Active mods or dependency metadata changed. Review the refreshed dependencies before sorting.",
        );
      }
      stageAutoSortActiveMods(dependencyTargets.length ? currentPlan.availableMods : []);
    });
  }

  async function refreshMetadata(id: string) {
    if (busy || refreshingModId) {
      return;
    }
    workshop.clearProgress();
    setRefreshingModId(id);
    try {
      await run(async () => {
        adopt(await getStore().refreshModMetadata(id));
        setNotice("Workshop metadata refreshed; tags, notes and subscriptions preserved");
      });
    } catch (error) {
      notifyError(error);
    } finally {
      setRefreshingModId(undefined);
    }
  }

  async function revealModFolder(id: string) {
    if (folderRequest.current) {
      return;
    }
    folderRequest.current = true;
    setRevealingFolder(true);
    await perform(async () => {
      try {
        await getStore().revealModFolder(id);
      } finally {
        folderRequest.current = false;
        setRevealingFolder(false);
      }
    });
  }

  async function openWorkshop(id: string) {
    await perform(() => getStore().openWorkshopInBrowser(id));
  }

  function importModList() {
    void perform(async () => {
      if (importModListDisabledReason) {
        return;
      }
      const imported: ImportedModList | null = await run(() => getStore().importModList());
      if (!imported) {
        return;
      }
      const plan = buildModListImportPlan(
        imported,
        modListActualMods,
        modListActualPanels.active,
        active.gameVersion,
        savedIds,
      );
      setModListImportPlan(plan);
      setNotice(`Loaded ${imported.fileName}; review the imported Active list`);
    });
  }

  function confirmModListImport() {
    void perform(() => {
      const openedPlan = requireValue(
        modListImportPlan,
        "The imported mod-list preview is no longer open.",
      );
      if (busy || draft.applying) {
        return;
      }
      if (importModListDisabledReason) {
        throw new Error(importModListDisabledReason);
      }
      // Re-resolve against the current inventory so a background metadata refresh cannot turn the
      // preview into a stale or partial draft. The draft store performs the final baseline check.
      const plan = buildModListImportPlan(
        openedPlan.file,
        modListActualMods,
        modListActualPanels.active,
        active.gameVersion,
        savedIds,
      );
      if (modListImportPlanKey(plan) !== modListImportPlanKey(openedPlan)) {
        setModListImportPlan(plan);
        throw new Error(
          "The installed mods or Active list changed. Review the refreshed import preview before staging it.",
        );
      }
      draft.actions.stageImportedActiveList(
        modListActualPanels.active,
        plan.targetMods,
        {
          savedIds,
          activeIds: modListActualPanels.activeIds,
          activePackageIds: active.packageIds,
          activeConfigTarget: normalizeActiveConfigTarget(settings),
          activeError: modListConfigurationError,
        },
        plan.file.fileName,
      );
      workspaceActions.setSearch(modPanelModes.active, "");
      workspaceActions.setSort(modPanelModes.active, modSorts.loadOrder);
      workspaceActions.setModStatusFilter(modFilters.all);
      const targetIds = plan.targetMods.map((mod) => mod.id);
      const firstTarget = targetIds[0];
      if (firstTarget) {
        workspaceActions.select(modPanelModes.active, targetIds, firstTarget);
      }
      setModListImportPlan(undefined);
      const unchanged =
        plan.targetMods.length === modListActualPanels.active.length &&
        plan.targetMods.every((mod, index) => mod.id === modListActualPanels.active[index]?.id);
      const summary = unchanged
        ? `${plan.file.fileName} already matches the current Active list`
        : `${plan.file.fileName} staged: ${plan.activatedMods.length} added, ${plan.deactivatedMods.length} removed`;
      setNotice(summary);
      if (plan.missingPackageIds.length) {
        notifyWarning(
          `${plan.missingPackageIds.length} unavailable ${plan.missingPackageIds.length === 1 ? "package was" : "packages were"} omitted from the imported draft.`,
        );
      }
    });
  }

  function exportModList() {
    void perform(async () => {
      if (exportModListDisabledReason) {
        return;
      }
      const packageIds = buildModListExportPackageIds(
        panels.active,
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

  function launchRimWorld() {
    void perform(async () => {
      if (
        !loaded ||
        busy ||
        draft.applying ||
        draft.changes.length ||
        draft.activeOrderOperations.length
      ) {
        return;
      }
      await run(() => getStore().launchRimWorld());
      setNotice("RimWorld launch requested through Steam");
    });
  }

  const sharedPanelProps = {
    tags,
    folderBased,
    activeIds: panels.activeIds,
    activeOrder: panels.activeOrder,
    validationIssuesById: activeValidation.issuesByModId,
    invalidCount: activeValidation.invalidModIds.size,
    newCount: draftActivityDelta.activatedIds.size,
    removedCount: draftActivityDelta.deactivatedIds.size,
    removedVisibleCount: filteredInactive.length,
    savedIds,
    activeError: active.error,
    metadataError: active.metadataError,
    activeLoading,
    activeCheckingConfiguration,
    activeMetadataLoading,
    activeRefreshing,
    subscriptionDisabled: draftControlsDisabled,
    subscriptionDisabledReason: draftControlsDisabledReason,
    draftDisabled: busy || draft.applying,
    contextMenuDisabled: busy,
    onSubscribe: (id: string) => {
      stageChanges(draftActions.subscribe, [id]);
    },
    onUnsubscribe: (id: string) => {
      stageChanges(draftActions.unsubscribe, [id]);
    },
    onActivate: (id: string) => {
      stageChanges(draftActions.activate, [id]);
    },
    onDeactivate: (id: string) => {
      stageChanges(draftActions.deactivate, [id]);
    },
  };
  const selectedIsActive = Boolean(selectedMod && panels.activeIds.has(selectedMod.id));
  const selectedMissingDependencies = selectedMod
    ? (missingDependenciesById.get(selectedMod.id) ?? [])
    : [];
  const selectedValidationIssues = selectedMod
    ? (activeValidation.issuesByModId.get(selectedMod.id) ?? [])
    : [];
  const infoSubscriptionReason =
    draftControlsDisabledReason ??
    (selectedMod?.subscribed && selectedIsActive
      ? "Deactivate this mod before unsubscribing"
      : undefined);
  const activeHasMissingDependencies = [...missingDependenciesById.values()].some(
    (dependencies) => dependencies.length > 0,
  );
  const autoSortDisabledReason =
    busy || draft.applying
      ? "An operation is in progress"
      : (activeSafetyError ??
        (panels.active.length < 2 && !activeHasMissingDependencies
          ? "At least two active mods are required"
          : undefined));
  const operationLoading =
    !loaded || busy || draft.applying || Boolean(refreshingModId) || revealingFolder;
  const currentDependencyDraftNotice =
    dependencyDraftNotice &&
    hasStagedDependencyActivations(draft.changes, dependencyDraftNotice.modIds)
      ? dependencyDraftNotice.message
      : undefined;
  useEffect(() => {
    if (currentDependencyDraftNotice) {
      dependencyDraftNoticeWasCurrent.current = true;
    } else if (dependencyDraftNoticeWasCurrent.current) {
      dependencyDraftNoticeWasCurrent.current = false;
      setDependencyDraftNotice(undefined);
    }
  }, [currentDependencyDraftNotice]);
  const operationNotice = !loaded
    ? "Loading database…"
    : draft.applying && draft.progress
      ? draft.progress.message
      : refreshingModId
        ? "Refreshing Workshop metadata…"
        : revealingFolder
          ? "Opening mod folder…"
          : busy && progress
            ? `${progress.message} (${progress.completed}/${progress.total})`
            : busy
              ? "Working…"
              : (currentDependencyDraftNotice ?? notice);

  return (
    <main className="app-shell">
      <AppTopBar />
      <AppHeader
        disabled={!loaded || busy}
        cleanupDisabledReason={cleanupDisabledReason}
        importDisabledReason={importModListDisabledReason}
        exportDisabledReason={exportModListDisabledReason}
        onOpenSettings={() => void settingsDialog.open()}
        onImportModList={importModList}
        onExportModList={exportModList}
        onUnsubscribeInactive={unsubscribeInactiveMods}
        onManageTags={() => {
          tagDialogs.dispatch({ type: tagDialogActions.manage });
        }}
        onSync={() => void workshop.sync()}
        workshopError={workshopStatus.error}
        activeError={active.error}
        metadataError={active.metadataError}
        loading={operationLoading}
        notice={operationNotice}
      />
      {!loaded ? (
        <div className="database-state" role="alert">
          {loadError
            ? `Database could not be loaded. Editing is blocked and your files were preserved. ${loadError}`
            : "Loading database..."}
        </div>
      ) : (
        <section className="workspace-grid" aria-busy={busy}>
          <fieldset className="workspace-controls" disabled={busy}>
            <div className="workspace-main-grid">
              <PanelErrorBoundary name="Mod Info" resetKey={focusedId} onError={notifyError}>
                <ModInfoPanel
                  mod={selectedMod}
                  pendingActions={focusedId ? draftActionsById.get(focusedId) : undefined}
                  tags={tags}
                  removalCount={infoModIds.length}
                  removalDisabledReason={infoRemovalReason}
                  removalRequiresUnsubscribe={infoRemovalRequiresUnsubscribe}
                  subscriptionDisabledReason={infoSubscriptionReason}
                  isRevealingFolder={revealingFolder}
                  isRefreshingMetadata={refreshingModId === selectedMod?.id}
                  onRefreshMetadata={window.modStore ? (id) => void refreshMetadata(id) : undefined}
                  isSaved={Boolean(selectedMod && savedIds.has(selectedMod.id))}
                  active={selectedIsActive}
                  validationIssues={selectedIsActive ? selectedValidationIssues : undefined}
                  missingDependencies={selectedMissingDependencies}
                  dependencyFixDisabledReason={
                    busy || draft.applying
                      ? "An operation is in progress"
                      : activeConfigurationError
                  }
                  onFixDependencies={
                    selectedIsActive && selectedMissingDependencies.length
                      ? (id) => {
                          fixDependencies(id);
                        }
                      : undefined
                  }
                  gameVersion={active.gameVersion}
                  onSubscribe={(id) => {
                    stageChanges(draftActions.subscribe, [id]);
                  }}
                  onUnsubscribe={(id) => {
                    stageChanges(draftActions.unsubscribe, [id]);
                  }}
                  onAddModToLibrary={(id) => {
                    for (const targetId of modTagTargets(selection, id)) {
                      draft.actions.undoAction(targetId, draftActions.remove);
                    }
                  }}
                  onRemoveModFromLibrary={(id) => {
                    requestLibraryRemoval(modTagTargets(selection, id));
                  }}
                  onRevealModFolder={window.modStore ? (id) => void revealModFolder(id) : undefined}
                  onOpenWorkshop={(id) => void openWorkshop(id)}
                  onAssignTag={onAssignTag}
                  onCreateTag={(initialName, modId) => {
                    tagDialogs.dispatch({
                      type: tagDialogActions.create,
                      initialName,
                      modIds: modTagTargets(selection, modId),
                    });
                  }}
                />
              </PanelErrorBoundary>
              <PanelErrorBoundary
                name="Library"
                resetKey={`${search}:${searchScope}:${sort}:${libraryFilter}:${String(effectiveLibraryTagFilter)}`}
                onError={notifyError}
              >
                <ModsPanel
                  {...sharedPanelProps}
                  mode={modPanelModes.inactive}
                  mods={filteredInactive}
                  totalCount={panels.inactive.length}
                />
              </PanelErrorBoundary>
              <PanelErrorBoundary
                name="Active"
                resetKey={`${activeSearch}:${activeSearchScope}:${activeSort}:${activeFilter}:${String(effectiveActiveTagFilter)}`}
                onError={notifyError}
              >
                <SubscribedModsPanel
                  {...sharedPanelProps}
                  mods={filteredActive}
                  totalCount={panels.active.length}
                  revealRequest={activeRevealRequest}
                  onRestore={restoreActiveList}
                  restoreDisabledReason={restoreDisabledReason}
                  onAutoSort={autoSortActiveMods}
                  autoSortDisabledReason={autoSortDisabledReason}
                  onReorderActive={reorderActiveMod}
                  reorderDisabledReason={draftControlsDisabledReason ?? activeConfigurationError}
                />
              </PanelErrorBoundary>
            </div>
          </fieldset>
        </section>
      )}
      <TagDialogs
        workflow={tagDialogs}
        mods={displayMods}
        tags={tags}
        disabled={busy}
        inactiveCountByTagId={inactiveCountByTagId}
        addToActiveDisabledReason={addTagToActiveDisabledReason}
        onAddTagToActive={addTagToActive}
      />
      {autoSortDependencyPlan && (
        <AutoSortDependenciesModal
          plan={autoSortDependencyPlan}
          disabled={busy || draft.applying}
          decisionDisabledReason={activeSafetyError}
          onClose={() => {
            setAutoSortDependencyPlan(undefined);
          }}
          onSortWithoutAdding={() => {
            confirmAutoSortActiveMods([]);
          }}
          onAddAndSort={confirmAutoSortActiveMods}
        />
      )}
      {moveActiveRequest && (
        <MoveActiveModModal
          modNames={[moveActiveRequest.modName]}
          activeCount={panels.active.length}
          initialPosition={moveActiveRequest.initialPosition}
          onClose={() => {
            setMoveActiveRequest(undefined);
          }}
          onConfirm={confirmActivePosition}
        />
      )}
      {modListImportPlan && (
        <ImportModListModal
          plan={modListImportPlan}
          disabled={draft.applying}
          confirmDisabledReason={importModListDisabledReason}
          onClose={() => {
            setModListImportPlan(undefined);
          }}
          onConfirm={confirmModListImport}
        />
      )}
      <WorkspaceDraftBar disabled={!loaded || busy} onRun={launchRimWorld} />
      {draft.reviewOpen && (
        <DraftChangesModal
          changes={draft.reviewedChanges}
          activeOrderOperations={draft.reviewedActiveOrderOperations}
          applying={draft.applying}
          progress={draft.progress}
          remainingCount={draft.changes.length + draft.activeOrderOperations.length}
          onUndo={draft.actions.undo}
          onUndoActiveOrder={draft.actions.undoActiveOrder}
          onClose={draft.closeReview}
          onConfirm={() => void draft.confirm()}
        />
      )}
      {settingsDialog.isOpen && (
        <SettingsModal
          {...settingsDialog.modalProps}
          detectedPath={active.configPath}
          configError={active.error}
        />
      )}
      {notification && (
        <ErrorNotification
          message={notification.message}
          kind={notification.kind}
          onDismiss={dismiss}
        />
      )}
      {contextMenu && (
        <WorkspaceModContextMenu
          count={contextMods.length}
          tagsDisabledReason={contextAvailability.tagsDisabledReason}
          activityDisabledReason={contextActivityDisabledReason}
          removalDisabledReason={contextAvailability.removalDisabledReason}
          removalRequiresUnsubscribe={contextRemovalRequiresUnsubscribe}
          positionDisabledReason={contextPositionDisabledReason}
          subscribeDisabledReason={subscribeDisabledReason}
          unsubscribeDisabledReason={unsubscribeDisabledReason}
          removeTagsDisabledReason={
            tags.some((tag) => contextMods.some((mod) => mod.userTagIds?.includes(tag.id)))
              ? undefined
              : "No tags assigned to this selection"
          }
          onAddTags={() => {
            openBulkTags(true);
          }}
          onRemoveTags={() => {
            openBulkTags(false);
          }}
          onAddToActive={() => {
            if (!contextActivityDisabledReason) {
              stageChanges(draftActions.activate, contextMenu.modIds);
            }
          }}
          onRemoveFromActive={() => {
            if (!contextActivityDisabledReason) {
              stageChanges(draftActions.deactivate, contextMenu.modIds);
            }
          }}
          onMoveToPosition={openActivePositionDialog}
          onSubscribe={() => {
            if (!subscribeDisabledReason) {
              stageChanges(
                draftActions.subscribe,
                subscribeTargets.map((mod) => mod.id),
              );
            }
          }}
          onUnsubscribe={() => {
            if (!unsubscribeDisabledReason) {
              stageChanges(
                draftActions.unsubscribe,
                unsubscribeTargets.map((mod) => mod.id),
              );
            }
          }}
          onRemoveFromLibrary={() => {
            if (!contextAvailability.removalDisabledReason) {
              requestLibraryRemoval(contextMenu.modIds);
            }
          }}
        />
      )}
    </main>
  );
}

export default App;
