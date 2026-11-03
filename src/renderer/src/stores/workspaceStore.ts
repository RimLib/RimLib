import { createStore, type StoreApi } from "zustand/vanilla";

import {
  contextModSelection,
  type MenuPoint,
  type ModContextTarget,
  type ModSelection,
  reconcileModSelection,
  type SelectionModifiers,
  selectModRow,
} from "../utils/modSelection";
import {
  type ModFilter,
  modFilters,
  type ModPanelMode,
  type ModSort,
  modSorts,
  type ModTagFilter,
  modTagFilters,
  type SearchScope,
  searchScopes,
} from "../utils/uiConstants";

export interface ModPanelView {
  readonly search: string;
  readonly searchScope: SearchScope;
  readonly sort: ModSort;
  readonly filter: ModFilter;
  readonly tagFilter: ModTagFilter;
}

export type VisibleModIds = Readonly<Record<ModPanelMode, readonly string[]>>;

interface WorkspaceActions {
  focus: (id?: string) => void;
  setSearch: (panel: ModPanelMode, search: string) => void;
  setSearchScope: (panel: ModPanelMode, searchScope: SearchScope) => void;
  setSort: (panel: ModPanelMode, sort: ModSort) => void;
  setFilter: (panel: ModPanelMode, filter: ModFilter) => void;
  setTagFilter: (panel: ModPanelMode, tagFilter: ModTagFilter) => void;
  setModStatusFilter: (filter: ModFilter) => void;
  select: (
    panel: ModPanelMode,
    orderedIds: readonly string[],
    id: string,
    modifiers?: SelectionModifiers,
  ) => boolean;
  openContext: (
    panel: ModPanelMode,
    orderedIds: readonly string[],
    id: string,
    point: MenuPoint,
  ) => boolean;
  closeContext: () => void;
  reconcile: (visible: VisibleModIds) => void;
}

export interface WorkspaceState {
  readonly views: Readonly<Record<ModPanelMode, ModPanelView>>;
  readonly focusedModId?: string;
  readonly selection: ModSelection;
  readonly contextMenu?: ModContextTarget;
  readonly actions: WorkspaceActions;
}

// Consumers can observe state and invoke named actions, but cannot bypass them with setState.
export type WorkspaceStore = Pick<
  StoreApi<WorkspaceState>,
  "getState" | "getInitialState" | "subscribe"
>;

export function createWorkspaceStore(): WorkspaceStore {
  const store = createStore<WorkspaceState>()((set) => {
    const emptySelection: ModSelection = { ids: [] };
    function setView(panel: ModPanelMode, patch: Partial<ModPanelView>) {
      set((state) => {
        const previous = state.views[panel];
        const next = { ...previous, ...patch };
        if (
          next.search === previous.search &&
          next.searchScope === previous.searchScope &&
          next.sort === previous.sort &&
          next.filter === previous.filter &&
          next.tagFilter === previous.tagFilter
        ) {
          return state;
        }
        return {
          views: { ...state.views, [panel]: next },
          contextMenu: state.contextMenu?.panel === panel ? undefined : state.contextMenu,
        };
      });
    }

    return {
      views: {
        unsubscribed: {
          search: "",
          searchScope: searchScopes.all,
          sort: modSorts.newest,
          filter: modFilters.all,
          tagFilter: modTagFilters.all,
        },
        subscribed: {
          search: "",
          searchScope: searchScopes.all,
          sort: modSorts.loadOrder,
          filter: modFilters.all,
          tagFilter: modTagFilters.all,
        },
      },
      focusedModId: undefined,
      selection: emptySelection,
      actions: {
        focus: (id) => {
          set((state) => (state.focusedModId === id ? state : { focusedModId: id }));
        },
        setSearch: (panel, search) => {
          setView(panel, { search });
        },
        setSearchScope: (panel, searchScope) => {
          setView(panel, { searchScope });
        },
        setSort: (panel, sort) => {
          setView(panel, { sort });
        },
        setFilter: (panel, filter) => {
          setView(panel, { filter });
        },
        setTagFilter: (panel, tagFilter) => {
          setView(panel, { tagFilter });
        },
        setModStatusFilter: (filter) => {
          set((state) => {
            const inactiveFilter =
              filter === modFilters.pendingDeactivation ? filter : modFilters.all;
            const activeFilter =
              filter === modFilters.invalid || filter === modFilters.pendingActivation
                ? filter
                : modFilters.all;
            const inactiveView = state.views.unsubscribed;
            const activeView = state.views.subscribed;
            const nextInactive =
              inactiveView.filter === inactiveFilter
                ? inactiveView
                : { ...inactiveView, filter: inactiveFilter };
            const nextActive =
              activeView.filter === activeFilter
                ? activeView
                : { ...activeView, filter: activeFilter };
            if (nextInactive === inactiveView && nextActive === activeView) {
              return state;
            }
            return {
              views: {
                ...state.views,
                unsubscribed: nextInactive,
                subscribed: nextActive,
              },
              contextMenu: undefined,
            };
          });
        },
        select: (panel, orderedIds, id, modifiers) => {
          if (!orderedIds.includes(id)) {
            return false;
          }
          set((state) => ({
            focusedModId: id,
            selection: selectModRow(state.selection, panel, orderedIds, id, modifiers),
            contextMenu: undefined,
          }));
          return true;
        },
        openContext: (panel, orderedIds, id, point) => {
          if (!orderedIds.includes(id)) {
            return false;
          }
          set((state) => {
            const selection = contextModSelection(state.selection, panel, orderedIds, id);
            return {
              focusedModId: id,
              selection,
              contextMenu: { ...point, panel, modIds: [...selection.ids] },
            };
          });
          return true;
        },
        closeContext: () => {
          set((state) => (state.contextMenu ? { contextMenu: undefined } : state));
        },
        reconcile: (visible) => {
          set((state) => {
            const reconciled = reconcileModSelection(
              state.selection,
              state.selection.panel ? visible[state.selection.panel] : [],
            );
            const selection = !reconciled.panel ? emptySelection : reconciled;
            const menu = state.contextMenu;
            const contextMenu = menu?.modIds.every((id) => visible[menu.panel].includes(id))
              ? menu
              : undefined;
            return selection === state.selection && contextMenu === menu
              ? state
              : { selection, contextMenu };
          });
        },
      },
    };
  });
  return {
    getState: store.getState,
    getInitialState: store.getInitialState,
    subscribe: store.subscribe,
  };
}
