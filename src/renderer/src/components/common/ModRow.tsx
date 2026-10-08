import { ArrowLeft, ArrowRight, Play, TriangleAlert, Undo2 } from "lucide-react";
import { memo } from "react";

import { subscriptionCommands } from "../../../../shared/domainConstants";
import { isOfficialMod } from "../../../../shared/packages";
import { isWorkshopMod } from "../../../../shared/subscriptions";
import type { Mod, ModDependency, ModTag, SubscriptionCommand } from "../../../../shared/types";
import { useDraftStore, useWorkspaceStore } from "../../stores/WorkspaceStoreProvider";
import type { DraftAction } from "../../utils/drafts";
import { getModHue } from "../../utils/mods";
import type { MenuPoint, ModPanelMode, SelectionModifiers } from "../../utils/modSelection";
import { DraftBadge } from "./DraftBadge";
import { ModImage } from "./ModImage";
import { TagChip } from "./TagChip";
import { TooltipIconButton } from "./TooltipIconButton";

export interface ModRowViewProps {
  mod: Mod;
  tags: ModTag[];
  selected: boolean;
  focused?: boolean;
  active?: boolean;
  missingDependencies?: readonly ModDependency[];
  subscriptionDisabled?: boolean;
  subscriptionDisabledReason?: string;
  draftDisabled?: boolean;
  editable?: boolean;
  subscriptionAction: SubscriptionCommand;
  onSelect: (id: string, modifiers?: SelectionModifiers) => void;
  onToggle: (id: string) => void;
  onContextMenu?: (id: string, point: MenuPoint) => void;
  pendingAction?: DraftAction;
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
  const pendingAction = useDraftStore(
    (state) => state.changes.find((change) => change.mod.id === id)?.action,
  );
  const undoDraft = useDraftStore((state) => state.actions.undo);

  return (
    <ModRowView
      {...props}
      selected={selected}
      focused={focused}
      pendingAction={pendingAction}
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
  missingDependencies = [],
  editable = true,
  subscriptionAction,
  subscriptionDisabled = false,
  subscriptionDisabledReason,
  draftDisabled = false,
  onSelect,
  onToggle,
  onContextMenu,
  pendingAction,
  onUndoDraft,
}: ModRowViewProps) {
  const assigned = tags.filter((tag) => mod.userTagIds?.includes(tag.id));
  const locked = isOfficialMod(mod);
  const unsubscribe = subscriptionAction === subscriptionCommands.unsubscribe;
  const activeProtection = unsubscribe && active;
  const actionDisabled = pendingAction
    ? draftDisabled || !onUndoDraft
    : subscriptionDisabled || !editable || !isWorkshopMod(mod) || Boolean(activeProtection);
  const actionLabel = pendingAction
    ? `Undo pending change for ${mod.name}`
    : subscriptionAction === subscriptionCommands.subscribe
      ? `Subscribe to ${mod.name}`
      : `Unsubscribe from ${mod.name}`;
  const action = (
    <TooltipIconButton
      aria-label={actionLabel}
      label={
        pendingAction
          ? actionLabel
          : activeProtection
            ? "Active mods cannot be unsubscribed"
            : !editable
              ? "Sync Workshop folders to save this mod before changing its subscription"
              : !isWorkshopMod(mod)
                ? "Local mods have no Steam subscription"
                : subscriptionDisabled
                  ? (subscriptionDisabledReason ?? "Subscription changes are unavailable")
                  : actionLabel
      }
      placement={unsubscribe ? "right" : "left"}
      className={`icon-button ${unsubscribe ? "danger" : "success"}`}
      disabled={actionDisabled}
      onClick={() => {
        if (!actionDisabled) {
          if (pendingAction) {
            onUndoDraft?.(mod.id);
          } else {
            onToggle(mod.id);
          }
        }
      }}
    >
      {pendingAction ? (
        <Undo2 size={16} aria-hidden />
      ) : unsubscribe ? (
        <ArrowLeft size={16} aria-hidden />
      ) : (
        <ArrowRight size={16} aria-hidden />
      )}
    </TooltipIconButton>
  );
  return (
    <div
      className={`mod-row ${unsubscribe ? "action-start" : ""} ${selected ? "selected" : ""} ${pendingAction ? `pending-${pendingAction}` : ""}`}
      role="listitem"
      aria-current={focused ? "true" : undefined}
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
      {unsubscribe && action}
      <button
        type="button"
        className="mod-row-main"
        aria-pressed={selected}
        onClick={(event) => {
          onSelect(mod.id, {
            shiftKey: event.shiftKey,
            metaKey: event.metaKey,
            ctrlKey: event.ctrlKey,
          });
        }}
      >
        <span className={mod.thumbnail ? "thumb has-image" : `thumb ${getModHue(mod)}`}>
          <ModImage key={mod.id} src={mod.thumbnail} refreshedAt={mod.metadataUpdatedAt} lazy />
        </span>
        <span className="mod-row-copy">
          <strong title={mod.name}>{mod.name}</strong>
          <span>{mod.author}</span>
        </span>
        <span className="mod-row-status" title={assigned.map((tag) => tag.name).join(", ")}>
          {active && (
            <span className="active-pill">
              <Play size={11} aria-hidden />
              Active
            </span>
          )}
          {missingDependencies.length > 0 && (
            <span
              className="dependency-warning-pill"
              title={`Missing active dependencies: ${missingDependencies.map((dependency) => dependency.displayName ?? dependency.packageId).join(", ")}`}
            >
              <TriangleAlert size={11} aria-hidden />
              {missingDependencies.length === 1
                ? "1 missing dependency"
                : `${missingDependencies.length} missing dependencies`}
            </span>
          )}
          {pendingAction && <DraftBadge action={pendingAction} />}
          {assigned.slice(0, 2).map((tag) => (
            <TagChip key={tag.id} tag={tag} />
          ))}
          {assigned.length > 2 && <span className="extra-tags">+{assigned.length - 2}</span>}
          {!mod.workshopId && (
            <span className="unsubscribed-pill">{locked ? "Core / DLC" : "Local"}</span>
          )}
        </span>
      </button>
      {!unsubscribe && action}
    </div>
  );
});
