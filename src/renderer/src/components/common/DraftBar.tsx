import { Check, RotateCcw } from "lucide-react";

import { useDraftStore } from "../../stores/WorkspaceStoreProvider";
import { type DraftChange, draftCounts } from "../../utils/drafts";

export function WorkspaceDraftBar({ disabled }: { disabled: boolean }) {
  const changes = useDraftStore((state) => state.changes);
  const applying = useDraftStore((state) => state.applying);
  const actions = useDraftStore((state) => state.actions);

  return (
    <DraftBar
      changes={changes}
      disabled={disabled}
      applying={applying}
      onReview={actions.openReview}
      onDiscard={actions.discard}
    />
  );
}

export function DraftBar({
  changes,
  disabled,
  applying,
  onReview,
  onDiscard,
}: {
  changes: readonly DraftChange[];
  disabled: boolean;
  applying: boolean;
  onReview: () => void;
  onDiscard: () => void;
}) {
  const counts = draftCounts(changes);
  return (
    <footer className="draft-bar" aria-label="Pending changes">
      <div className="draft-summary" role="status">
        <strong>
          {applying
            ? "Applying changes"
            : `${changes.length} pending ${changes.length === 1 ? "change" : "changes"}`}
        </strong>
        {counts.subscribe > 0 && (
          <span className="draft-badge draft-subscribe">{counts.subscribe} subscribe</span>
        )}
        {counts.unsubscribe > 0 && (
          <span className="draft-badge draft-unsubscribe">{counts.unsubscribe} unsubscribe</span>
        )}
        {counts.remove > 0 && (
          <span className="draft-badge draft-remove">{counts.remove} remove</span>
        )}
      </div>
      <div className="draft-bar-actions">
        <button
          className="ghost-action"
          type="button"
          disabled={disabled || applying || !changes.length}
          onClick={onDiscard}
        >
          <RotateCcw size={16} aria-hidden />
          Discard draft
        </button>
        <button
          className="primary-action"
          type="button"
          disabled={disabled || applying || !changes.length}
          onClick={onReview}
        >
          <Check size={16} aria-hidden />
          Confirm changes
        </button>
      </div>
    </footer>
  );
}
