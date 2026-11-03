import {
  Archive,
  CheckCircle2,
  ChevronDown,
  CircleMinus,
  CirclePlus,
  ListFilter,
  LoaderCircle,
  RotateCcw,
  Search,
  SortDesc,
  Sparkles,
  Tag,
  TriangleAlert,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { subscriptionCommands } from "../../../../shared/domainConstants";
import type { Mod, ModTag } from "../../../../shared/types";
import { useVirtualMods } from "../../hooks/useVirtualMods";
import { useWorkspaceStore } from "../../stores/WorkspaceStoreProvider";
import type { ActiveDropPlacement } from "../../utils/activeOrder";
import type { ActiveModIssue } from "../../utils/activeValidation";
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
  type ModFilter,
  modFilters,
  modPanelModes,
  modSorts,
  type ModTagFilter,
  modTagFilters,
  type SearchScope,
  searchScopes,
} from "../../utils/uiConstants";
import { EmptyState } from "../common/EmptyState";
import { ModRow, ModRowView } from "../common/ModRow";
import { PanelTitle } from "../common/PanelTitle";
import { TooltipIconButton } from "../common/TooltipIconButton";

export interface ModsPanelViewProps {
  mode: ModPanelMode;
  folderBased?: boolean;
  mods: Mod[];
  totalCount: number;
  tags: ModTag[];
  selectedModId?: string;
  selectedModIds?: ReadonlySet<string>;
  revealRequest?: {
    modId: string;
    key: number;
  };
  search: string;
  searchScope: SearchScope;
  sort: ModSort;
  tagFilter?: ModTagFilter;
  activeIds: ReadonlySet<string>;
  activeOrder?: ReadonlyMap<string, number>;
  validationIssuesById?: ReadonlyMap<string, readonly ActiveModIssue[]>;
  invalidCount?: number;
  newCount?: number;
  removedCount?: number;
  removedVisibleCount?: number;
  filter?: ModFilter;
  statusFilter?: ModFilter;
  savedIds?: ReadonlySet<string>;
  activeError?: string;
  metadataError?: string;
  activeLoading?: boolean;
  activeCheckingConfiguration?: boolean;
  activeMetadataLoading?: boolean;
  activeRefreshing?: boolean;
  subscriptionDisabled?: boolean;
  subscriptionDisabledReason?: string;
  draftDisabled?: boolean;
  draftActionsById?: ReadonlyMap<string, DraftAction>;
  onUndoDraft?: (id: string) => void;
  onSearch: (value: string) => void;
  onSearchScope: (value: SearchScope) => void;
  onSort: (value: ModSort) => void;
  onTagFilter?: (value: ModTagFilter) => void;
  onFilter?: (value: ModFilter) => void;
  onStatusFilter?: (value: ModFilter) => void;
  onSelect: (id: string, modifiers?: SelectionModifiers) => void;
  onContextMenu?: (id: string, point: MenuPoint) => void;
  onSubscribe: (id: string) => void;
  onUnsubscribe: (id: string) => void;
  onActivate?: (id: string) => void;
  onDeactivate?: (id: string) => void;
  onRestore?: () => void;
  restoreDisabledReason?: string;
  onAutoSort?: () => void;
  autoSortDisabledReason?: string;
  onReorderActive?: (sourceId: string, targetId: string, placement: ActiveDropPlacement) => void;
  reorderDisabledReason?: string;
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
  | "activeOrder"
  | "validationIssuesById"
  | "invalidCount"
  | "newCount"
  | "removedCount"
  | "removedVisibleCount"
  | "savedIds"
  | "activeError"
  | "metadataError"
  | "activeLoading"
  | "activeCheckingConfiguration"
  | "activeMetadataLoading"
  | "activeRefreshing"
  | "subscriptionDisabled"
  | "subscriptionDisabledReason"
  | "draftDisabled"
  | "onSubscribe"
  | "onUnsubscribe"
  | "onActivate"
  | "onDeactivate"
  | "onRestore"
  | "restoreDisabledReason"
  | "onAutoSort"
  | "autoSortDisabledReason"
  | "onReorderActive"
  | "reorderDisabledReason"
  | "revealRequest"
> & {
  contextMenuDisabled?: boolean;
};

interface ActiveModStatusFiltersProps {
  displayedTotal: string;
  filter: ModFilter;
  invalidCount: number;
  newCount: number;
  removedCount: number;
  removedVisibleCount: number;
  totalCount: number;
  visibleCount: number;
  onFilter?: (value: ModFilter) => void;
}

const tagFilterOptionValues = Object.freeze({
  all: "all-tags",
  untagged: "untagged",
  tagPrefix: "tag:",
});

function tagFilterOptionValue(tagFilter: ModTagFilter): string {
  if (tagFilter === modTagFilters.all) {
    return tagFilterOptionValues.all;
  }
  if (tagFilter === modTagFilters.untagged) {
    return tagFilterOptionValues.untagged;
  }
  return `${tagFilterOptionValues.tagPrefix}${encodeURIComponent(tagFilter)}`;
}

function parseTagFilterOption(value: string): ModTagFilter | undefined {
  if (value === tagFilterOptionValues.all) {
    return modTagFilters.all;
  }
  if (value === tagFilterOptionValues.untagged) {
    return modTagFilters.untagged;
  }
  if (!value.startsWith(tagFilterOptionValues.tagPrefix)) {
    return undefined;
  }
  try {
    return decodeURIComponent(value.slice(tagFilterOptionValues.tagPrefix.length));
  } catch {
    return undefined;
  }
}

export function ActiveModStatusFilters({
  displayedTotal,
  filter,
  invalidCount,
  newCount,
  removedCount,
  removedVisibleCount,
  totalCount,
  visibleCount,
  onFilter,
}: ActiveModStatusFiltersProps) {
  const expectedVisibleCount =
    filter === modFilters.invalid
      ? invalidCount
      : filter === modFilters.pendingActivation
        ? newCount
        : filter === modFilters.pendingDeactivation
          ? removedCount
          : totalCount;
  const actualVisibleCount =
    filter === modFilters.pendingDeactivation ? removedVisibleCount : visibleCount;
  const toggleFilter = (target: ModFilter) => {
    onFilter?.(filter === target ? modFilters.all : target);
  };
  return (
    <div className="mod-status-filters" role="group" aria-label="Active mod status filters">
      <button
        type="button"
        className="mod-status-filter"
        aria-label={`Show all ${displayedTotal} active mods`}
        aria-controls="subscribed-mods-list"
        aria-pressed={filter === modFilters.all}
        onClick={() => {
          toggleFilter(modFilters.all);
        }}
      >
        {displayedTotal} total
      </button>
      <button
        type="button"
        className="mod-status-filter invalid"
        aria-label={`Show ${invalidCount} invalid active ${invalidCount === 1 ? "mod" : "mods"}`}
        aria-controls="subscribed-mods-list"
        aria-pressed={filter === modFilters.invalid}
        onClick={() => {
          toggleFilter(modFilters.invalid);
        }}
      >
        <TriangleAlert size={12} aria-hidden />
        {invalidCount} invalid
      </button>
      <button
        type="button"
        className="mod-status-filter removed"
        aria-label={`Show ${removedCount} removed ${removedCount === 1 ? "mod" : "mods"} in Library`}
        aria-controls="unsubscribed-mods-list"
        aria-pressed={filter === modFilters.pendingDeactivation}
        onClick={() => {
          toggleFilter(modFilters.pendingDeactivation);
        }}
      >
        <CircleMinus size={12} aria-hidden />
        {removedCount} removed
      </button>
      <button
        type="button"
        className="mod-status-filter new"
        aria-label={`Show ${newCount} new active ${newCount === 1 ? "mod" : "mods"}`}
        aria-controls="subscribed-mods-list"
        aria-pressed={filter === modFilters.pendingActivation}
        onClick={() => {
          toggleFilter(modFilters.pendingActivation);
        }}
      >
        <CirclePlus size={12} aria-hidden />
        {newCount} new
      </button>
      {actualVisibleCount !== expectedVisibleCount && (
        <span className="mod-status-visible">{actualVisibleCount} shown</span>
      )}
    </div>
  );
}

export const ModsPanel = memo(function ModsPanel({
  contextMenuDisabled = false,
  ...props
}: ModsPanelProps) {
  const { mode, mods } = props;
  const view = useWorkspaceStore((state) => state.views[mode]);
  const inactiveFilter = useWorkspaceStore((state) => state.views[modPanelModes.inactive].filter);
  const focusedModId = useWorkspaceStore((state) => state.focusedModId);
  const selection = useWorkspaceStore((state) => state.selection);
  const workspaceActions = useWorkspaceStore((state) => state.actions);
  const tagFilter =
    view.tagFilter && !props.tags.some((tag) => tag.id === view.tagFilter)
      ? modTagFilters.all
      : view.tagFilter;
  useEffect(() => {
    if (tagFilter !== view.tagFilter) {
      workspaceActions.setTagFilter(mode, tagFilter);
    }
  }, [mode, tagFilter, view.tagFilter, workspaceActions]);
  const filter =
    (view.filter === modFilters.pendingActivation && !props.newCount) ||
    (view.filter === modFilters.pendingDeactivation && !props.removedCount)
      ? modFilters.all
      : view.filter;
  const effectiveInactiveFilter =
    inactiveFilter === modFilters.pendingDeactivation && !props.removedCount
      ? modFilters.all
      : inactiveFilter;
  const statusFilter =
    effectiveInactiveFilter === modFilters.pendingDeactivation
      ? effectiveInactiveFilter
      : filter === modFilters.invalid || filter === modFilters.pendingActivation
        ? filter
        : modFilters.all;
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
      tagFilter={tagFilter}
      filter={filter}
      statusFilter={statusFilter}
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
      onTagFilter={(value) => {
        workspaceActions.setTagFilter(mode, value);
      }}
      onFilter={(value) => {
        workspaceActions.setFilter(mode, value);
      }}
      onStatusFilter={(value) => {
        workspaceActions.setModStatusFilter(value);
      }}
      onSelect={onSelect}
    />
  );
});

export const ModsPanelView = memo(function ModsPanelView({
  mode,
  folderBased: _folderBased = false,
  mods,
  totalCount,
  tags,
  selectedModId,
  selectedModIds,
  revealRequest,
  search,
  searchScope,
  sort,
  tagFilter = modTagFilters.all,
  activeIds,
  activeOrder,
  validationIssuesById,
  invalidCount = 0,
  newCount = 0,
  removedCount = 0,
  removedVisibleCount = removedCount,
  filter = modFilters.all,
  statusFilter = filter,
  savedIds,
  activeError,
  metadataError,
  activeLoading,
  activeCheckingConfiguration,
  activeMetadataLoading,
  activeRefreshing,
  subscriptionDisabled = false,
  subscriptionDisabledReason,
  draftDisabled = false,
  draftActionsById,
  onUndoDraft,
  onSearch,
  onSearchScope,
  onSort,
  onTagFilter,
  onFilter,
  onStatusFilter,
  onSelect,
  onContextMenu,
  onSubscribe,
  onUnsubscribe,
  onActivate,
  onDeactivate,
  onRestore,
  restoreDisabledReason,
  onAutoSort,
  autoSortDisabledReason,
  onReorderActive,
  reorderDisabledReason,
  connectedRows,
}: ModsPanelViewProps) {
  const activePanel = mode === modPanelModes.active;
  const effectiveTagFilter =
    tagFilter && !tags.some((tag) => tag.id === tagFilter) ? modTagFilters.all : tagFilter;
  const title = activePanel ? "Active" : "Library";
  const label = activePanel ? "Active mods" : "Library mods";
  const configurationPending = activePanel && Boolean(activeLoading);
  const activeBusy =
    activePanel && Boolean(activeLoading || activeMetadataLoading || activeRefreshing);
  const displayedTotal = configurationPending && totalCount === 0 ? "—" : String(totalCount);
  const loadingMessage = activeLoading
    ? "Loading active mods…"
    : activeMetadataLoading
      ? "Loading mod details…"
      : activeRefreshing
        ? "Checking active mods…"
        : undefined;
  const revealIndex = revealRequest ? mods.findIndex((mod) => mod.id === revealRequest.modId) : -1;
  const virtual = useVirtualMods(
    mods,
    `${search}:${searchScope}:${sort}:${filter}:${String(effectiveTagFilter)}`,
    revealRequest ? { key: revealRequest.key, index: revealIndex } : undefined,
  );
  const rowSubscriptionDisabled = subscriptionDisabled;
  const rowSubscriptionReason = subscriptionDisabledReason;
  const showReorderHandle = activePanel && sort === modSorts.loadOrder;
  const effectiveReorderDisabledReason =
    reorderDisabledReason ??
    (search.trim() ? "Clear the Active search to drag mods" : undefined) ??
    (effectiveTagFilter !== modTagFilters.all ? "Show all tags to drag mods" : undefined) ??
    (filter !== modFilters.all ? "Show all Active mods to drag mods" : undefined) ??
    (mods.length < 2 ? "At least two active mods are required" : undefined) ??
    (!onReorderActive ? "Drag reordering is unavailable" : undefined);
  const reorderable = showReorderHandle && !effectiveReorderDisabledReason;
  const draggedModIdRef = useRef<string | undefined>(undefined);
  const [draggedModId, setDraggedModId] = useState<string>();
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    placement: ActiveDropPlacement;
  }>();
  useEffect(() => {
    if (!reorderable) {
      draggedModIdRef.current = undefined;
      setDraggedModId(undefined);
      setDropTarget(undefined);
    }
  }, [reorderable]);
  const clearDrag = useCallback(() => {
    draggedModIdRef.current = undefined;
    setDraggedModId(undefined);
    setDropTarget(undefined);
  }, []);
  return (
    <section
      className={`panel library-panel ${activePanel ? "subscribed-panel active-panel" : "unsubscribed-panel inactive-panel"}`}
      aria-label={label}
    >
      <PanelTitle
        icon={activePanel ? <CheckCircle2 size={18} /> : <Archive size={18} />}
        title={title}
      >
        {activePanel && onRestore && (
          <TooltipIconButton
            className="ghost-action restore-action px-2.5 text-xs whitespace-nowrap"
            aria-label="Restore active mods"
            label={
              restoreDisabledReason ??
              "Keep RimWorld and DLC active; stage all other active mods for deactivation"
            }
            disabled={Boolean(restoreDisabledReason)}
            onClick={onRestore}
          >
            <RotateCcw size={15} aria-hidden />
            Restore
          </TooltipIconButton>
        )}
        {activePanel && (
          <TooltipIconButton
            className="ghost-action auto-sort-action px-2.5 text-xs whitespace-nowrap"
            label={autoSortDisabledReason ?? "Auto-sort active mods"}
            disabled={Boolean(autoSortDisabledReason) || !onAutoSort}
            onClick={onAutoSort}
          >
            <Sparkles size={15} aria-hidden />
            Auto-sort
          </TooltipIconButton>
        )}
        <span
          className="count-badge"
          aria-label={configurationPending && totalCount === 0 ? "Mod count loading" : undefined}
        >
          {displayedTotal} mods
        </span>
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
              aria-label={`Search ${label.toLowerCase()}`}
            />
          </div>
          <label className="search-scope-box">
            <ListFilter className="select-leading-icon" size={16} aria-hidden />
            <select
              className="select"
              aria-label={`Search ${label.toLowerCase()} by`}
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
          <label className="tag-filter-box">
            <Tag className="select-leading-icon" size={16} aria-hidden />
            <select
              className="select"
              aria-label={`Filter ${label.toLowerCase()} by tag`}
              value={tagFilterOptionValue(effectiveTagFilter)}
              onChange={(event) => {
                const next = parseTagFilterOption(event.target.value);
                if (next !== undefined) {
                  onTagFilter?.(next);
                }
              }}
            >
              <option value={tagFilterOptionValues.all}>All tags</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tagFilterOptionValue(tag.id)}>
                  {tag.name}
                </option>
              ))}
              <option value={tagFilterOptionValues.untagged}>Untagged</option>
            </select>
            <ChevronDown className="select-chevron" size={15} aria-hidden />
          </label>
          <label className="sort-box">
            <SortDesc className="select-leading-icon" size={16} aria-hidden />
            <select
              className="select"
              aria-label={`Sort ${label.toLowerCase()}`}
              value={sort}
              onChange={(event) => {
                if (isModSort(event.target.value)) {
                  onSort(event.target.value);
                }
              }}
            >
              {activePanel && <option value={modSorts.loadOrder}>Load order</option>}
              {!activePanel && <option value={modSorts.notSubscribed}>Not subscribed first</option>}
              <option value={modSorts.invalid}>Invalid first</option>
              <option value={modSorts.newest}>Newest first</option>
              <option value={modSorts.oldest}>Oldest first</option>
            </select>
            <ChevronDown className="select-chevron" size={15} aria-hidden />
          </label>
        </div>
      </div>
      <div
        id={`${mode}-mods-list`}
        className="mod-list virtualized"
        ref={virtual.ref}
        onScroll={virtual.onScroll}
        role="list"
        aria-busy={activePanel ? activeBusy : undefined}
      >
        <div style={{ height: virtual.top }} />
        {virtual.visible.map((mod) => {
          const rowProps = {
            mod,
            tags,
            active: activePanel,
            loadOrder: activePanel ? activeOrder?.get(mod.id) : undefined,
            validationIssues: activePanel ? validationIssuesById?.get(mod.id) : undefined,
            subscriptionDisabled: rowSubscriptionDisabled,
            subscriptionDisabledReason: rowSubscriptionReason,
            draftDisabled,
            subscriptionAction: activePanel
              ? subscriptionCommands.unsubscribe
              : subscriptionCommands.subscribe,
            editable: !savedIds || savedIds.has(mod.id),
            onToggle: mod.subscribed ? onUnsubscribe : onSubscribe,
            onToggleActive: activePanel ? onDeactivate : onActivate,
            activeToggleDisabledReason:
              activeError ??
              (activeLoading
                ? "Active mod configuration is still loading"
                : activeCheckingConfiguration
                  ? "Checking active mods..."
                  : undefined),
            showReorderHandle,
            reorderable,
            reorderDisabledReason: effectiveReorderDisabledReason,
            dragging: draggedModId === mod.id,
            dropPlacement: dropTarget?.id === mod.id ? dropTarget.placement : undefined,
            onReorderDragStart: (id: string) => {
              draggedModIdRef.current = id;
              setDraggedModId(id);
              setDropTarget(undefined);
            },
            onReorderDragOver: (id: string, placement: ActiveDropPlacement) => {
              const sourceId = draggedModIdRef.current;
              setDropTarget(sourceId && sourceId !== id ? { id, placement } : undefined);
            },
            onReorderDrop: (id: string, placement: ActiveDropPlacement) => {
              const sourceId = draggedModIdRef.current;
              if (sourceId && sourceId !== id) {
                onReorderActive?.(sourceId, id, placement);
              }
              clearDrag();
            },
            onReorderDragEnd: clearDrag,
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
              configurationPending
                ? "Loading active mods…"
                : totalCount
                  ? activePanel && filter === modFilters.invalid
                    ? invalidCount
                      ? "No matching invalid mods"
                      : "No invalid mods"
                    : activePanel && filter === modFilters.pendingActivation
                      ? newCount
                        ? "No matching new mods"
                        : "No new mods"
                      : !activePanel && filter === modFilters.pendingDeactivation
                        ? removedCount
                          ? "No matching removed mods"
                          : "No removed mods"
                        : "No matching mods"
                  : activePanel
                    ? "No active mods"
                    : "No library mods"
            }
          />
        )}
      </div>
      <div className="selection-status">
        {activePanel ? (
          <ActiveModStatusFilters
            displayedTotal={displayedTotal}
            filter={statusFilter}
            invalidCount={invalidCount}
            newCount={newCount}
            removedCount={removedCount}
            removedVisibleCount={removedVisibleCount}
            totalCount={totalCount}
            visibleCount={mods.length}
            onFilter={onStatusFilter ?? onFilter}
          />
        ) : (
          <span
            className="shrink-0"
            aria-label={
              configurationPending && totalCount === 0
                ? "Visible and total mod count loading"
                : undefined
            }
          >
            {configurationPending && totalCount === 0
              ? "— / — mods"
              : `${mods.length} / ${displayedTotal} mods`}
          </span>
        )}
        {loadingMessage ? (
          <span
            className="inline-flex min-w-0 items-center gap-1.5 truncate"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <LoaderCircle
              className="shrink-0 animate-spin motion-reduce:animate-none"
              size={14}
              aria-hidden
            />
            {loadingMessage}
          </span>
        ) : (
          <span className="min-w-0 truncate">
            {activePanel
              ? activeError
                ? "Active unavailable"
                : metadataError
                  ? "Mod details unavailable"
                  : selectedModIds?.size
                    ? `${selectedModIds.size} selected`
                    : `${mods.filter((mod) => activeIds.has(mod.id)).length} active`
              : selectedModIds?.size
                ? `${selectedModIds.size} selected`
                : ""}
          </span>
        )}
      </div>
    </section>
  );
});
