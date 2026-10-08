import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { modActivities, steamStatusSources } from "../../shared/domainConstants";
import { createActivityLookup } from "../../shared/subscriptions";
import { requireValue } from "../../shared/validation";
import { AppHeader } from "./components/AppHeader";
import { AppTopBar } from "./components/AppTopBar";
import { WorkspaceDraftBar } from "./components/common/DraftBar";
import { ErrorNotification } from "./components/common/ErrorNotification";
import { WorkspaceModContextMenu } from "./components/common/ModContextMenu";
import { PanelErrorBoundary } from "./components/common/PanelErrorBoundary";
import { DraftChangesModal } from "./components/modals/DraftChangesModal";
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
import { useWorkspaceStore, WorkspaceStoreProvider } from "./stores/WorkspaceStoreProvider";
import { buildActiveMods } from "./utils/activeMods";
import { indexMissingDependencies } from "./utils/dependencies";
import { type DraftAction, draftActions, projectDraftPanels } from "./utils/drafts";
import { filterLibrary, modBatchAvailability, subscriptionPanels } from "./utils/library";
import { modTagTargets } from "./utils/modSelection";
import { tagDialogActions, tagDialogKinds } from "./utils/tagDialogs";
import { modPanelModes, searchScopes } from "./utils/uiConstants";

function App() {
  return (
    <WorkspaceStoreProvider>
      <Workspace />
    </WorkspaceStoreProvider>
  );
}

function Workspace() {
  const [notice, setNotice] = useState("Loaded local mod library");
  const { notification, notifyError, perform, dismiss } = useActionNotifications();
  const { status: steamStatus, refresh: refreshSteam } = useSteamAvailability();
  const { vault, loaded, loadError, busy, update, adopt, run, deleteTag } =
    useModVault(notifyError);
  const { mods, userTags: tags, settings = {} } = vault;
  const folderBased = vault.localSteamState.source === steamStatusSources.workshopFolders;
  const {
    active,
    loading: activeLoading,
    refresh: refreshActive,
    adoptActive,
  } = useActiveMods(settings, loaded);
  const { search, searchScope, sort } = useWorkspaceStore((state) => state.views.unsubscribed);
  const {
    search: subscribedSearch,
    searchScope: subscribedSearchScope,
    sort: subscribedSort,
  } = useWorkspaceStore((state) => state.views.subscribed);
  const contextMenu = useWorkspaceStore((state) => state.contextMenu);
  const focusedModId = useWorkspaceStore((state) => state.focusedModId);
  const workspaceActions = useWorkspaceStore((state) => state.actions);
  const closeContextMenu = workspaceActions.closeContext;
  const [refreshingModId, setRefreshingModId] = useState<string>();
  const [revealingFolder, setRevealingFolder] = useState(false);
  const folderRequest = useRef(false);
  const tagDialogs = useTagDialogs({
    busy,
    update,
    deleteTag,
    perform,
    setNotice,
  });
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
  // Installed About.xml metadata corrects stale package ids without changing saved user data.
  const activeView = useMemo(() => buildActiveMods(active, mods), [active, mods]);
  const displayMods = useMemo(() => {
    const installed = new Map(activeView.entries.map((mod) => [mod.id, mod]));
    return mods.map((mod) => {
      const entry = installed.get(mod.id);
      return entry
        ? { ...mod, ...entry, subscribed: mod.subscribed, userTagIds: mod.userTagIds }
        : mod;
    });
  }, [mods, activeView]);
  const byId = useMemo(() => new Map(displayMods.map((mod) => [mod.id, mod])), [displayMods]);
  const savedIds = useMemo(() => new Set(byId.keys()), [byId]);
  const actualPanels = useMemo(
    () =>
      subscriptionPanels(
        { localSteamState: vault.localSteamState },
        displayMods,
        active,
        activeView.entries,
      ),
    [vault.localSteamState, displayMods, active, activeView],
  );
  const draft = useDraftChanges({
    run,
    adopt,
    adoptActive,
    refreshActive,
    refreshSteam,
    notifyError,
    setNotice,
  });
  const draftActionsById = useMemo(
    () => new Map(draft.changes.map((change) => [change.mod.id, change.action])),
    [draft.changes],
  );
  const panels = useMemo(
    () => ({
      ...actualPanels,
      ...projectDraftPanels(
        actualPanels.unsubscribed,
        actualPanels.subscribed,
        draft.changes,
        actualPanels.activeIds,
      ),
    }),
    [actualPanels, draft.changes],
  );
  const missingDependenciesById = useMemo(
    () =>
      indexMissingDependencies(
        actualPanels.subscribed,
        actualPanels.activeIds,
        active.packageIds,
        active.gameVersion,
      ),
    [actualPanels, active.gameVersion, active.packageIds],
  );
  const actualById = useMemo(
    () =>
      new Map(
        [...actualPanels.unsubscribed, ...actualPanels.subscribed].map((mod) => [mod.id, mod]),
      ),
    [actualPanels],
  );
  const workshop = useWorkshopActions({
    run,
    adopt,
    adoptActive,
    refreshActive,
    perform,
    notifyError,
    setNotice,
  });
  const { progress } = workshop;
  const workshopError = useWorkshopStatus(
    loaded,
    Boolean(
      busy ||
      draft.reviewOpen ||
      draft.changes.length ||
      settingsDialog.isOpen ||
      tagDialogs.dialog.kind !== tagDialogKinds.closed ||
      contextMenu,
    ),
    settings.workshopModsPath,
    update,
  );
  const steamError = steamStatus.error?.trim();
  const steamUnavailableReason =
    steamError !== undefined && steamError.length > 0
      ? steamError
      : "Start Steam before changing subscriptions.";
  const subscriptionDisabledReason =
    busy || draft.applying
      ? "An operation is in progress"
      : !steamStatus.running
        ? steamUnavailableReason
        : undefined;
  const subscriptionDisabled = busy || draft.applying || !steamStatus.running;
  const draftApplyDisabledReason =
    draft.changes.some((change) => change.action !== draftActions.remove) && !steamStatus.running
      ? steamUnavailableReason
      : undefined;
  const selectedMod =
    actualPanels.subscribed.find((mod) => mod.id === focusedModId) ??
    actualPanels.unsubscribed.find((mod) => mod.id === focusedModId) ??
    actualPanels.unsubscribed[0] ??
    actualPanels.subscribed[0];
  const filtered = useMemo(
    () => filterLibrary(panels.unsubscribed, search, searchScope, sort, tags),
    [panels.unsubscribed, search, searchScope, sort, tags],
  );
  const filteredSubscribed = useMemo(
    () =>
      filterLibrary(
        panels.subscribed,
        subscribedSearch,
        subscribedSearchScope,
        subscribedSort,
        tags,
        panels.activeOrder,
      ),
    [
      panels.subscribed,
      subscribedSearch,
      subscribedSearchScope,
      subscribedSort,
      tags,
      panels.activeOrder,
    ],
  );
  const focusedId = selectedMod?.id;
  useEffect(() => {
    workspaceActions.focus(focusedId);
  }, [focusedId, workspaceActions]);
  const inactiveModIds = useMemo(() => {
    const activity = createActivityLookup(active);
    return filterLibrary(
      actualPanels.subscribed,
      "",
      searchScopes.all,
      subscribedSort,
      [],
      actualPanels.activeOrder,
    )
      .filter((mod) => savedIds.has(mod.id) && activity(mod) === modActivities.inactive)
      .map((mod) => mod.id);
  }, [active, actualPanels, savedIds, subscribedSort]);
  const cleanupDisabledReason =
    subscriptionDisabledReason ??
    (activeLoading
      ? "Checking Active mods..."
      : active.error || active.metadataError
        ? "Active status could not be verified. Cleanup is disabled."
        : !inactiveModIds.length
          ? "No saved non-active Workshop mods to unsubscribe"
          : undefined);

  const selection = useModSelection(filtered, filteredSubscribed);
  const libraryById = useMemo(
    () => new Map(actualPanels.unsubscribed.map((mod) => [mod.id, mod])),
    [actualPanels.unsubscribed],
  );
  const infoModIds = focusedId ? modTagTargets(selection, focusedId) : [];
  const infoRemovalReason = busy
    ? "An operation is in progress"
    : infoModIds.some((id) => !savedIds.has(id) || !libraryById.has(id))
      ? "Only saved, unsubscribed mods can be removed from the library"
      : undefined;
  const contextMods = useMemo(() => {
    if (!contextMenu) {
      return [];
    }
    const ids = new Set(contextMenu.modIds);
    return (contextMenu.panel === modPanelModes.subscribed ? filteredSubscribed : filtered).filter(
      (mod) => ids.has(mod.id),
    );
  }, [contextMenu, filtered, filteredSubscribed]);
  const contextAvailability = modBatchAvailability(
    contextMods,
    savedIds,
    busy,
    subscriptionDisabled,
    subscriptionDisabledReason,
    panels.activeIds,
    active.error ?? active.metadataError ?? (activeLoading ? "Checking Active" : undefined),
  );
  if (contextMods.some((mod) => actualById.get(mod.id)?.subscribed)) {
    contextAvailability.removalDisabledReason =
      "Apply the pending unsubscribe before removing subscribed mods from the library";
  }
  function openBulkTags(assigned: boolean) {
    if (!contextMenu || contextAvailability.tagsDisabledReason) {
      return;
    }
    tagDialogs.dispatch({ type: tagDialogActions.bulk, assigned, modIds: contextMenu.modIds });
    closeContextMenu();
  }

  const onAssignTag = useCallback(
    (modId: string, tagId: string, assigned: boolean) => {
      const modIds = modTagTargets(selection, modId);
      assignTags(modIds, [tagId], assigned);
    },
    [selection, assignTags],
  );

  function stageChanges(action: DraftAction, ids: string[]) {
    void perform(() => {
      if (busy || draft.applying || !ids.length) {
        return;
      }
      if (action !== draftActions.remove && subscriptionDisabled) {
        return;
      }
      const unique = [...new Set(ids)];
      draft.actions.stage(
        unique.map((id) =>
          requireValue(actualById.get(id), "A selected mod is no longer available."),
        ),
        action,
        {
          savedIds,
          activeIds: actualPanels.activeIds,
          activeError:
            active.error ?? active.metadataError ?? (activeLoading ? "Checking Active" : undefined),
        },
      );
      closeContextMenu();
    });
  }

  function requestLibraryRemoval(ids: string[]) {
    stageChanges(draftActions.remove, ids);
  }

  function stageInactive() {
    if (!cleanupDisabledReason) {
      stageChanges(draftActions.unsubscribe, inactiveModIds);
    }
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

  const sharedPanelProps = {
    tags,
    folderBased,
    activeIds: panels.activeIds,
    missingDependenciesById,
    savedIds,
    subscriptionDisabled,
    subscriptionDisabledReason,
    draftDisabled: busy || draft.applying,
    contextMenuDisabled: busy,
    onSubscribe: (id: string) => {
      stageChanges(draftActions.subscribe, [id]);
    },
    onUnsubscribe: (id: string) => {
      stageChanges(draftActions.unsubscribe, [id]);
    },
  };

  return (
    <main className="app-shell">
      <AppTopBar />
      <AppHeader
        disabled={!loaded || busy}
        cleanupDisabledReason={cleanupDisabledReason}
        onOpenSettings={() => void settingsDialog.open()}
        onUnsubscribeInactive={stageInactive}
        onManageTags={() => {
          tagDialogs.dispatch({ type: tagDialogActions.manage });
        }}
        onSync={() => void workshop.sync()}
        workshopError={workshopError}
        activeError={active.error ?? active.metadataError}
        notice={
          draft.applying && draft.progress
            ? draft.progress.message
            : busy && progress
              ? `${progress.message} (${progress.completed}/${progress.total})`
              : notice
        }
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
                  pendingAction={focusedId ? draftActionsById.get(focusedId) : undefined}
                  tags={tags}
                  removalCount={infoModIds.length}
                  removalDisabledReason={infoRemovalReason}
                  isRevealingFolder={revealingFolder}
                  isRefreshingMetadata={refreshingModId === selectedMod?.id}
                  onRefreshMetadata={window.modStore ? (id) => void refreshMetadata(id) : undefined}
                  locallyDetected={
                    folderBased &&
                    (!selectedMod?.workshopId ||
                      vault.localSteamState.pending[selectedMod.workshopId] === undefined)
                  }
                  isSaved={Boolean(selectedMod && byId.has(selectedMod.id))}
                  active={Boolean(selectedMod && panels.activeIds.has(selectedMod.id))}
                  missingDependencies={
                    selectedMod ? missingDependenciesById.get(selectedMod.id) : undefined
                  }
                  gameVersion={active.gameVersion}
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
                resetKey={`${search}:${searchScope}:${sort}`}
                onError={notifyError}
              >
                <ModsPanel
                  {...sharedPanelProps}
                  mode={modPanelModes.unsubscribed}
                  mods={filtered}
                  totalCount={panels.unsubscribed.length}
                />
              </PanelErrorBoundary>
              <PanelErrorBoundary
                name="Workshop"
                resetKey={`${subscribedSearch}:${subscribedSearchScope}:${subscribedSort}`}
                onError={notifyError}
              >
                <SubscribedModsPanel
                  {...sharedPanelProps}
                  mods={filteredSubscribed}
                  totalCount={panels.subscribed.length}
                  activeError={active.error ?? active.metadataError}
                  activeLoading={activeLoading}
                />
              </PanelErrorBoundary>
            </div>
          </fieldset>
        </section>
      )}
      <TagDialogs workflow={tagDialogs} mods={displayMods} tags={tags} disabled={busy} />
      <WorkspaceDraftBar disabled={!loaded || busy} />
      {draft.reviewOpen && (
        <DraftChangesModal
          changes={draft.reviewedChanges}
          applying={draft.applying}
          progress={draft.progress}
          disabledReason={draftApplyDisabledReason}
          remainingCount={draft.changes.length}
          onUndo={draft.actions.undo}
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
      {notification && <ErrorNotification message={notification.message} onDismiss={dismiss} />}
      {contextMenu && (
        <WorkspaceModContextMenu
          count={contextMods.length}
          {...contextAvailability}
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
          onSubscription={() => {
            if (contextAvailability.subscriptionDisabledReason) {
              return;
            }
            const { panel, modIds } = contextMenu;
            closeContextMenu();
            stageChanges(
              panel === modPanelModes.subscribed
                ? draftActions.unsubscribe
                : draftActions.subscribe,
              modIds,
            );
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
