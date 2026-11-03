import { Check, Play, RotateCcw } from "lucide-react";

import { useDraftStore } from "../../stores/WorkspaceStoreProvider";
import {
  type ActiveOrderDraftOperation,
  type DraftChange,
  draftCounts,
  draftOperationCount,
} from "../../utils/drafts";
import { DraftBadge } from "./DraftBadge";

export function WorkspaceDraftBar({ disabled, onRun }: { disabled: boolean; onRun: () => void }) {
  const changes = useDraftStore((state) => state.changes);
  const applying = useDraftStore((state) => state.applying);
  const activeOrderOperations = useDraftStore((state) => state.activeOrderOperations);
  const actions = useDraftStore((state) => state.actions);

  return (
    <DraftBar
      changes={changes}
      activeOrderOperations={activeOrderOperations}
      disabled={disabled}
      applying={applying}
      onReview={actions.openReview}
      onDiscard={actions.discard}
      onRun={onRun}
    />
  );
}

export function DraftBar({
  changes,
  activeOrderOperations = [],
  disabled,
  applying,
  onReview,
  onDiscard,
  onRun,
}: {
  changes: readonly DraftChange[];
  activeOrderOperations?: readonly ActiveOrderDraftOperation[];
  disabled: boolean;
  applying: boolean;
  onReview: () => void;
  onDiscard: () => void;
  onRun: () => void;
}) {
  const counts = draftCounts(changes);
  const pendingCount = draftOperationCount(changes, activeOrderOperations.length);
  return (
    <footer className="draft-bar" aria-label="Pending changes">
      <div className="draft-summary" role="status">
        <strong>
          {applying
            ? "Applying changes"
            : `${pendingCount} pending ${pendingCount === 1 ? "change" : "changes"}`}
        </strong>
        {counts.subscribe > 0 && (
          <DraftBadge action="subscribe" label={`${counts.subscribe} subscribe`} />
        )}
        {counts.unsubscribe > 0 && (
          <DraftBadge action="unsubscribe" label={`${counts.unsubscribe} unsubscribe`} />
        )}
        {counts.remove > 0 && <DraftBadge action="remove" label={`${counts.remove} remove`} />}
        {counts.activate > 0 && (
          <DraftBadge action="activate" label={`${counts.activate} activate`} />
        )}
        {counts.deactivate > 0 && (
          <DraftBadge action="deactivate" label={`${counts.deactivate} deactivate`} />
        )}
        {activeOrderOperations.length > 0 && (
          <DraftBadge
            action="order"
            label={
              activeOrderOperations.length === 1
                ? "load order"
                : `${activeOrderOperations.length} load order changes`
            }
          />
        )}
      </div>
      <div className="draft-bar-actions">
        {pendingCount ? (
          <>
            <button
              className="ghost-action"
              type="button"
              disabled={disabled || applying}
              onClick={onDiscard}
            >
              <RotateCcw size={16} aria-hidden />
              Discard draft
            </button>
            <button
              className="primary-action"
              type="button"
              disabled={disabled || applying}
              onClick={onReview}
            >
              <Check size={16} aria-hidden />
              Confirm changes
            </button>
          </>
        ) : (
          <button
            className="primary-action"
            type="button"
            disabled={disabled || applying}
            onClick={onRun}
          >
            <Play size={16} aria-hidden />
            Run RimWorld
          </button>
        )}
      </div>
    </footer>
  );
}
