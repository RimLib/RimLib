import { keyboardKeys, type ModPanelMode, viewportPadding } from "./uiConstants";
export type { ModPanelMode } from "./uiConstants";
export interface SelectionModifiers {
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}
export interface ModSelection {
  panel?: ModPanelMode;
  ids: string[];
  anchorId?: string;
}
export interface MenuPoint {
  x: number;
  y: number;
}
export interface ModContextTarget extends MenuPoint {
  panel: ModPanelMode;
  modIds: string[];
}

export const emptyModSelection: ModSelection = { ids: [] };

export function modTagTargets(selection: ModSelection, modId: string): string[] {
  return selection.ids.includes(modId) ? [...selection.ids] : [modId];
}

export function reconcileModSelection(
  selection: ModSelection,
  orderedIds: readonly string[],
): ModSelection {
  const selected = new Set(selection.ids);
  const ids = orderedIds.filter((id) => selected.has(id));
  const anchorId = orderedIds.includes(selection.anchorId ?? "") ? selection.anchorId : undefined;
  if (!ids.length && !anchorId) {
    return selection.ids.length || selection.panel ? emptyModSelection : selection;
  }
  if (
    anchorId === selection.anchorId &&
    ids.length === selection.ids.length &&
    ids.every((id, index) => id === selection.ids[index])
  ) {
    return selection;
  }
  return { ...selection, ids, anchorId };
}

export function selectModRow(
  selection: ModSelection,
  panel: ModPanelMode,
  orderedIds: readonly string[],
  id: string,
  modifiers: SelectionModifiers = {},
): ModSelection {
  if (!orderedIds.includes(id)) {
    return selection;
  }
  const previous =
    selection.panel === panel ? reconcileModSelection(selection, orderedIds) : emptyModSelection;
  const toggle = modifiers.metaKey || modifiers.ctrlKey;
  const anchor = orderedIds.indexOf(previous.anchorId ?? "");
  if (modifiers.shiftKey && anchor >= 0) {
    const index = orderedIds.indexOf(id);
    const range = orderedIds.slice(Math.min(anchor, index), Math.max(anchor, index) + 1);
    const selected = new Set(toggle ? [...previous.ids, ...range] : range);
    return {
      panel,
      ids: orderedIds.filter((entry) => selected.has(entry)),
      anchorId: previous.anchorId,
    };
  }
  if (toggle) {
    const selected = new Set(previous.ids);
    if (selected.has(id)) {
      selected.delete(id);
    } else {
      selected.add(id);
    }
    return { panel, ids: orderedIds.filter((entry) => selected.has(entry)), anchorId: id };
  }
  return { panel, ids: [id], anchorId: id };
}

export function contextModSelection(
  selection: ModSelection,
  panel: ModPanelMode,
  orderedIds: readonly string[],
  id: string,
): ModSelection {
  const previous =
    selection.panel === panel ? reconcileModSelection(selection, orderedIds) : emptyModSelection;
  return previous.ids.includes(id) ? previous : selectModRow(previous, panel, orderedIds, id);
}

export function positionContextMenu(
  point: MenuPoint,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  return {
    left: Math.max(
      viewportPadding,
      Math.min(point.x, viewport.width - size.width - viewportPadding),
    ),
    top: Math.max(
      viewportPadding,
      Math.min(point.y, viewport.height - size.height - viewportPadding),
    ),
  };
}

export function menuFocusIndex(key: string, current: number, count: number): number | undefined {
  if (!count) {
    return undefined;
  }
  if (key === keyboardKeys.home) {
    return 0;
  }
  if (key === keyboardKeys.end) {
    return count - 1;
  }
  if (key === keyboardKeys.arrowDown) {
    return current < 0 ? 0 : (current + 1) % count;
  }
  if (key === keyboardKeys.arrowUp) {
    return current < 0 ? count - 1 : (current + count - 1) % count;
  }
  return undefined;
}
