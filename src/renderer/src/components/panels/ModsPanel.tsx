import { Archive, CheckCircle2, ChevronDown, ListFilter, Search, SortDesc } from "lucide-react";
import { memo, useCallback, useMemo } from "react";

import { subscriptionCommands } from "../../../../shared/domainConstants";
import type { Mod, ModDependency, ModTag } from "../../../../shared/types";
import { useVirtualMods } from "../../hooks/useVirtualMods";
import { useWorkspaceStore } from "../../stores/WorkspaceStoreProvider";
import type { DraftAction } from "../../utils/drafts";
import type { ModSort } from "../../utils/library";
import {
  type MenuPoint,
  type ModPanelMode,
  reconcileModSelection,
  type SelectionModifiers,
} from "../../utils/modSelection";
import {
  isModSort,
  isSearchScope,
  modPanelModes,
  modSorts,
  type SearchScope,
  searchScopes,
} from "../../utils/uiConstants";
import { EmptyState } from "../common/EmptyState";
import { ModRow, ModRowView } from "../common/ModRow";
import { PanelTitle } from "../common/PanelTitle";

export interface ModsPanelViewProps {
  mode: ModPanelMode;
  folderBased?: boolean;
  mods: Mod[];
  totalCount: number;
  tags: ModTag[];
  selectedModId?: string;
  selectedModIds?: ReadonlySet<string>;
  search: string;
  searchScope: SearchScope;
  sort: ModSort;
  activeIds: ReadonlySet<string>;
  activeOrder?: ReadonlyMap<string, number>;
  missingDependenciesById?: ReadonlyMap<string, readonly ModDependency[]>;
  savedIds?: ReadonlySet<string>;
  activeError?: string;
  activeLoading?: boolean;
  subscriptionDisabled?: boolean;
  subscriptionDisabledReason?: string;
  draftDisabled?: boolean;
  draftActionsById?: ReadonlyMap<string, DraftAction>;
  onUndoDraft?: (id: string) => void;
  onSearch: (value: string) => void;
  onSearchScope: (value: SearchScope) => void;
  onSort: (value: ModSort) => void;
  onSelect: (id: string, modifiers?: SelectionModifiers) => void;
  onContextMenu?: (id: string, point: MenuPoint) => void;
  onSubscribe: (id: string) => void;
  onUnsubscribe: (id: string) => void;
  connectedRows?: {
    orderedIds: readonly string[];
    contextMenuDisabled: boolean;
  };
}

export type ModsPanelProps = Pick<
  ModsPanelViewProps,
  | "mode"
  | "folderBased"
  | "mods"
  | "totalCount"
  | "tags"
  | "activeIds"
  | "missingDependenciesById"
  | "savedIds"
  | "activeError"
  | "activeLoading"
  | "subscriptionDisabled"
  | "subscriptionDisabledReason"
  | "draftDisabled"
  | "onSubscribe"
  | "onUnsubscribe"
> & {
  contextMenuDisabled?: boolean;
};

export const ModsPanel = memo(function ModsPanel({
  contextMenuDisabled = false,
  ...props
}: ModsPanelProps) {
  const { mode, mods } = props;
  const view = useWorkspaceStore((state) => state.views[mode]);
  const focusedModId = useWorkspaceStore((state) => state.focusedModId);
  const selection = useWorkspaceStore((state) => state.selection);
  const workspaceActions = useWorkspaceStore((state) => state.actions);
  const orderedIds = useMemo(() => mods.map((mod) => mod.id), [mods]);
  const visibleSelection = useMemo(
    () => reconcileModSelection(selection, selection.panel === mode ? orderedIds : []),
    [mode, orderedIds, selection],
  );
  const selectedModIds = useMemo(() => new Set(visibleSelection.ids), [visibleSelection.ids]);
  const onSelect = useCallback(
    (id: string, modifiers?: SelectionModifiers) => {
      workspaceActions.select(mode, orderedIds, id, modifiers);
    },
    [mode, orderedIds, workspaceActions],
  );
  return (
    <ModsPanelView
      {...props}
      selectedModId={focusedModId}
      selectedModIds={selectedModIds}
      search={view.search}
      searchScope={view.searchScope}
      sort={view.sort}
      connectedRows={{ orderedIds, contextMenuDisabled }}
      onSearch={(value) => {
        workspaceActions.setSearch(mode, value);
      }}
      onSearchScope={(value) => {
        workspaceActions.setSearchScope(mode, value);
      }}
      onSort={(value) => {
        workspaceActions.setSort(mode, value);
      }}
      onSelect={onSelect}
    />
  );
});

export const ModsPanelView = memo(function ModsPanelView({
  mode,
  folderBased = false,
  mods,
  totalCount,
  tags,
  selectedModId,
  selectedModIds,
  search,
  searchScope,
  sort,
  activeIds,
  missingDependenciesById,
  savedIds,
  activeError,
  activeLoading,
  subscriptionDisabled = false,
  subscriptionDisabledReason,
  draftDisabled = false,
  draftActionsById,
  onUndoDraft,
  onSearch,
  onSearchScope,
  onSort,
  onSelect,
  onContextMenu,
  onSubscribe,
  onUnsubscribe,
  connectedRows,
}: ModsPanelViewProps) {
  const subscribed = mode === modPanelModes.subscribed;
  const title = subscribed ? (folderBased ? "Workshop" : "Subscribed") : "Library";
  const label = subscribed
    ? folderBased
      ? "Local Workshop mods"
      : "Subscribed mods"
    : folderBased
      ? "Saved library mods"
      : "Unsubscribed library mods";
  const virtual = useVirtualMods(mods, `${search}:${searchScope}:${sort}`);
  const rowSubscriptionDisabled =
    subscriptionDisabled || (subscribed && (Boolean(activeError) || activeLoading));
  const rowSubscriptionReason =
    subscribed && (activeError || activeLoading)
      ? "Active status could not be verified. Unsubscribe is disabled."
      : subscriptionDisabledReason;
  return (
    <section
      className={`panel library-panel ${subscribed ? "subscribed-panel" : "unsubscribed-panel"}`}
      aria-label={label}
    >
      <PanelTitle
        icon={subscribed ? <CheckCircle2 size={18} /> : <Archive size={18} />}
        title={title}
      >
        <span className="count-badge">{totalCount} mods</span>
      </PanelTitle>
      <div className="library-filters">
        <div className="library-toolbar">
          <div className="search-box">
            <Search size={17} aria-hidden />
            <input
              value={search}
              onChange={(event) => {
                onSearch(event.target.value);
              }}
              placeholder="Search mods"
              aria-label={`Search ${title.toLowerCase()} mods`}
            />
          </div>
          <label className="search-scope-box">
            <ListFilter className="select-leading-icon" size={16} aria-hidden />
            <select
              className="select"
              aria-label={`Search ${title.toLowerCase()} mods by`}
              value={searchScope}
              onChange={(event) => {
                if (isSearchScope(event.target.value)) {
                  onSearchScope(event.target.value);
                }
              }}
            >
              <option value={searchScopes.all}>All</option>
              <option value={searchScopes.title}>Title</option>
              <option value={searchScopes.author}>Author</option>
              <option value={searchScopes.description}>Description</option>
              <option value={searchScopes.tags}>Tags</option>
            </select>
            <ChevronDown className="select-chevron" size={15} aria-hidden />
          </label>
          <label className="sort-box">
            <SortDesc className="select-leading-icon" size={16} aria-hidden />
            <select
              className="select"
              aria-label={`Sort ${title.toLowerCase()} mods`}
              value={sort}
              onChange={(event) => {
                if (isModSort(event.target.value)) {
                  onSort(event.target.value);
                }
              }}
            >
              {subscribed && <option value={modSorts.active}>Active first</option>}
              <option value={modSorts.newest}>Newest first</option>
              <option value={modSorts.oldest}>Oldest first</option>
            </select>
            <ChevronDown className="select-chevron" size={15} aria-hidden />
          </label>
        </div>
      </div>
      <div
        className="mod-list virtualized"
        ref={virtual.ref}
        onScroll={virtual.onScroll}
        role="list"
      >
        <div style={{ height: virtual.top }} />
        {virtual.visible.map((mod) => {
          const rowProps = {
            mod,
            tags,
            active: subscribed && activeIds.has(mod.id),
            missingDependencies: subscribed ? missingDependenciesById?.get(mod.id) : undefined,
            subscriptionDisabled: rowSubscriptionDisabled,
            subscriptionDisabledReason: rowSubscriptionReason,
            draftDisabled,
            subscriptionAction: subscribed
              ? subscriptionCommands.unsubscribe
              : subscriptionCommands.subscribe,
            editable: !savedIds || savedIds.has(mod.id),
            onToggle: subscribed ? onUnsubscribe : onSubscribe,
          };
          return connectedRows ? (
            <ModRow
              key={mod.id}
              {...rowProps}
              mode={mode}
              orderedIds={connectedRows.orderedIds}
              contextMenuDisabled={connectedRows.contextMenuDisabled}
            />
          ) : (
            <ModRowView
              key={mod.id}
              {...rowProps}
              selected={selectedModIds ? selectedModIds.has(mod.id) : selectedModId === mod.id}
              focused={selectedModId === mod.id}
              pendingAction={draftActionsById?.get(mod.id)}
              onUndoDraft={onUndoDraft}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
            />
          );
        })}
        <div style={{ height: virtual.bottom }} />
        {!mods.length && (
          <EmptyState
            label={
              totalCount
                ? "No matching mods"
                : subscribed
                  ? folderBased
                    ? "No installed Workshop mods"
                    : "No subscribed mods"
                  : folderBased
                    ? "No uninstalled mods saved"
                    : "No unsubscribed mods saved"
            }
          />
        )}
      </div>
      <div className="selection-status">
        <span>
          {mods.length} / {totalCount} mods
        </span>
        <span>
          {selectedModIds?.size
            ? `${selectedModIds.size} selected`
            : subscribed
              ? activeLoading
                ? "Checking Active..."
                : activeError
                  ? "Active unavailable"
                  : `${mods.filter((mod) => activeIds.has(mod.id)).length} active`
              : ""}
        </span>
      </div>
    </section>
  );
});
