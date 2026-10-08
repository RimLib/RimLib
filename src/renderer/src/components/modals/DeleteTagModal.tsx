import { Trash2, X } from "lucide-react";

import type { ModTag } from "../../../../shared/types";
import { TooltipIconButton } from "../common/TooltipIconButton";
export function DeleteTagModal({
  tag,
  count,
  onClose,
  onConfirm,
}: {
  tag: ModTag;
  count: number;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="modal modal-open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-tag-title"
    >
      <div className="modal-box app-modal">
        <div className="app-modal-header">
          <h2 id="delete-tag-title">Delete tag</h2>
          <TooltipIconButton label="Close" onClick={onClose}>
            <X size={17} aria-hidden />
          </TooltipIconButton>
        </div>
        <p className="app-modal-copy">
          Delete <strong>{tag.name}</strong> and remove it from {count} saved mods? Your library and
          Steam subscriptions will be kept.
        </p>
        <div className="app-modal-actions">
          <button type="button" className="ghost-action" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="danger-action" onClick={onConfirm}>
            <Trash2 size={16} aria-hidden />
            Delete tag
          </button>
        </div>
      </div>
      <button type="button" className="modal-backdrop" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
