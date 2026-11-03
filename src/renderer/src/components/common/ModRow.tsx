import { GripVertical, TriangleAlert } from "lucide-react";
import { type DragEvent, memo, useMemo } from "react";

import { isOfficialMod, normalizePackageId, rimWorldPackages } from "../../../../shared/packages";
import type { Mod, ModTag, SubscriptionCommand } from "../../../../shared/types";
import { useDraftStore, useWorkspaceStore } from "../../stores/WorkspaceStoreProvider";
import type { ActiveModIssue } from "../../utils/activeValidation";
import type { DraftAction } from "../../utils/drafts";
import { getModHue } from "../../utils/mods";
import type { MenuPoint, ModPanelMode, SelectionModifiers } from "../../utils/modSelection";
import { DraftBadge } from "./DraftBadge";
import { ModImage } from "./ModImage";
import { OfficialMarker } from "./OfficialMarker";
import { TagChip } from "./TagChip";

export interface ModRowViewProps {
  mod: Mod;
  tags: ModTag[];
  selected: boolean;
  focused?: boolean;
  active?: boolean;
  loadOrder?: number;
  validationIssues?: readonly ActiveModIssue[];
  subscriptionDisabled?: boolean;
  subscriptionDisabledReason?: string;
  draftDisabled?: boolean;
  editable?: boolean;
  subscriptionAction: SubscriptionCommand;
  onSelect: (id: string, modifiers?: SelectionModifiers) => void;
  onToggle: (id: string) => void;
  onToggleActive?: (id: string) => void;
  activeToggleDisabledReason?: string;
  onContextMenu?: (id: string, point: MenuPoint) => void;
  showReorderHandle?: boolean;
  reorderable?: boolean;
  reorderDisabledReason?: string;
  dragging?: boolean;
  dropPlacement?: "before" | "after";
  onReorderDragStart?: (id: string) => void;
  onReorderDragOver?: (id: string, placement: "before" | "after") => void;
  onReorderDrop?: (id: string, placement: "before" | "after") => void;
  onReorderDragEnd?: () => void;
  pendingAction?: DraftAction;
  pendingActions?: readonly DraftAction[];
  onUndoDraft?: (id: string) => void;
}

export type ModRowProps = Omit<
  ModRowViewProps,
  "selected" | "focused" | "pendingAction" | "onUndoDraft" | "onSelect" | "onContextMenu"
> & {
  mode: ModPanelMode;
  orderedIds: readonly string[];
  contextMenuDisabled?: boolean;
};

export const ModRow = memo(function ModRow({
  mode,
  orderedIds,
  contextMenuDisabled = false,
  ...props
}: ModRowProps) {
  const { id } = props.mod;
  const selected = useWorkspaceStore(
    (state) => state.selection.panel === mode && state.selection.ids.includes(id),
  );
  const focused = useWorkspaceStore((state) => state.focusedModId === id);
  const workspaceActions = useWorkspaceStore((state) => state.actions);
  const draftChanges = useDraftStore((state) => state.changes);
  const pendingActions = useMemo(
    () => draftChanges.filter((change) => change.mod.id === id).map((change) => change.action),
    [draftChanges, id],
  );
  const undoDraft = useDraftStore((state) => state.actions.undo);

  return (
    <ModRowView
      {...props}
      selected={selected}
      focused={focused}
      pendingActions={pendingActions}
      onUndoDraft={undoDraft}
      onSelect={(modId, modifiers) => {
        workspaceActions.select(mode, orderedIds, modId, modifiers);
      }}
      onContextMenu={
        contextMenuDisabled
          ? undefined
          : (modId, point) => {
              workspaceActions.openContext(mode, orderedIds, modId, point);
            }
      }
    />
  );
});

export const ModRowView = memo(function ModRowView({
  mod,
  tags,
  selected,
  focused,
  active,
  loadOrder,
  validationIssues,
  editable: _editable = true,
  subscriptionAction: _subscriptionAction,
  subscriptionDisabled: _subscriptionDisabled = false,
  subscriptionDisabledReason: _subscriptionDisabledReason,
  draftDisabled = false,
  onSelect,
  onToggle: _onToggle,
  onToggleActive,
  activeToggleDisabledReason,
  onContextMenu,
  showReorderHandle = false,
  reorderable = false,
  reorderDisabledReason,
  dragging = false,
  dropPlacement,
  onReorderDragStart,
  onReorderDragOver,
  onReorderDrop,
  onReorderDragEnd,
  pendingAction,
  pendingActions,
  onUndoDraft: _onUndoDraft,
}: ModRowViewProps) {
  const assigned = tags.filter((tag) => mod.userTagIds?.includes(tag.id));
  const displayedTags = selected ? assigned : assigned.slice(0, 2);
  const hiddenTags = selected ? [] : assigned.slice(2);
  const tagNames = assigned.map((tag) => tag.name).join(", ");
  const official = isOfficialMod(mod);
  const locked = official && normalizePackageId(mod.packageId ?? "") === rimWorldPackages.core;
  const actions = pendingActions ?? (pendingAction ? [pendingAction] : []);
  const activityDisabled = draftDisabled || locked || Boolean(activeToggleDisabledReason);
  const validationCount = validationIssues?.length ?? 0;
  const onlyMissingDependencies = validationIssues?.every(
    ({ code }) => code === "missing-dependency",
  );
  const validationLabel = onlyMissingDependencies
    ? validationCount === 1
      ? "1 missing dependency"
      : `${validationCount} missing dependencies`
    : validationCount === 1
      ? "1 validation error"
      : `${validationCount} validation errors`;
  const validationTitle = validationIssues?.map(({ message }) => message).join("\n");
  return (
    <div
      className={`mod-row ${selected ? "selected" : ""} ${dragging ? "dragging" : ""} ${dropPlacement ? `drop-${dropPlacement}` : ""} ${actions.map((action) => `pending-${action}`).join(" ")}`}
      role="listitem"
      aria-current={focused ? "true" : undefined}
      onDragOver={(event) => {
        if (!reorderable || !onReorderDragOver) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const rect = event.currentTarget.getBoundingClientRect();
        onReorderDragOver(mod.id, event.clientY < rect.top + rect.height / 2 ? "before" : "after");
      }}
      onDrop={(event) => {
        if (!reorderable || !onReorderDrop) {
          return;
        }
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        onReorderDrop(mod.id, event.clientY < rect.top + rect.height / 2 ? "before" : "after");
      }}
      onContextMenu={(event) => {
        if (!onContextMenu) {
          return;
        }
        event.preventDefault();
        event.currentTarget
          .querySelector<HTMLButtonElement>(".mod-row-main")
          ?.focus({ preventScroll: true });
        const rect = event.currentTarget.getBoundingClientRect();
        onContextMenu(
          mod.id,
          event.clientX || event.clientY
            ? { x: event.clientX, y: event.clientY }
            : { x: rect.left + 40, y: rect.top + rect.height / 2 },
        );
      }}
    >
      <button
        type="button"
        className="mod-row-main"
        aria-pressed={selected}
        title={
          activeToggleDisabledReason ??
          (locked
            ? "RimWorld Core must remain active"
            : active
              ? "Double-click to stage deactivation"
              : "Double-click to stage activation")
        }
        onClick={(event) => {
          onSelect(mod.id, {
            shiftKey: event.shiftKey,
            metaKey: event.metaKey,
            ctrlKey: event.ctrlKey,
          });
        }}
        onDoubleClick={() => {
          if (!activityDisabled) {
            onToggleActive?.(mod.id);
          }
        }}
      >
        <span className={mod.thumbnail ? "thumb has-image" : `thumb ${getModHue(mod)}`}>
          <ModImage key={mod.id} src={mod.thumbnail} refreshedAt={mod.metadataUpdatedAt} lazy />
        </span>
        <span className="mod-row-copy">
          <strong title={mod.name}>{mod.name}</strong>
          <span>{mod.author}</span>
        </span>
        <span className="mod-row-status" title={tagNames || undefined}>
          {official && <OfficialMarker />}
          {validationCount > 0 && (
            <span className="dependency-warning-pill" title={validationTitle}>
              <TriangleAlert size={11} aria-hidden />
              {validationLabel}
            </span>
          )}
          {actions.map((action) => (
            <DraftBadge key={action} action={action} />
          ))}
          {displayedTags.map((tag) => (
            <TagChip key={tag.id} tag={tag} title={selected ? tagNames : undefined} />
          ))}
          {hiddenTags.length > 0 && (
            <span
              className="extra-tags"
              title={tagNames}
              aria-label={`${hiddenTags.length} more ${hiddenTags.length === 1 ? "tag" : "tags"}: ${hiddenTags.map((tag) => tag.name).join(", ")}`}
            >
              +{hiddenTags.length}
            </span>
          )}
          {!mod.workshopId && !official && <span className="unsubscribed-pill">Local</span>}
        </span>
        {active && (showReorderHandle || loadOrder !== undefined) && (
          <span className="mod-row-order">
            {showReorderHandle && (
              <span
                className={`drag-handle ${reorderable ? "" : "disabled"}`}
                draggable={reorderable}
                title={
                  reorderable
                    ? `Drag ${mod.name} to change its load position`
                    : reorderDisabledReason
                }
                onDragStart={(event: DragEvent<HTMLSpanElement>) => {
                  if (!reorderable || !onReorderDragStart) {
                    event.preventDefault();
                    return;
                  }
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", mod.id);
                  onReorderDragStart(mod.id);
                }}
                onDragEnd={onReorderDragEnd}
                aria-hidden="true"
              >
                <GripVertical size={15} />
              </span>
            )}
            {loadOrder !== undefined && (
              <span className="load-order-number" aria-label={`Load order ${loadOrder}`}>
                {loadOrder}
              </span>
            )}
          </span>
        )}
      </button>
    </div>
  );
});
