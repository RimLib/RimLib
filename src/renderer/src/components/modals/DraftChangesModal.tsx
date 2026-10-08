import { Check, CircleCheck, CircleX, LoaderCircle, Undo2, X } from "lucide-react";
import { useState } from "react";

import {
  draftActions,
  type DraftChange,
  type DraftProgress,
  draftStatuses,
  draftStepLabels,
  draftSteps,
} from "../../utils/drafts";
import { DraftBadge } from "../common/DraftBadge";
import { TooltipIconButton } from "../common/TooltipIconButton";

export function DraftChangesModal({
  changes,
  applying,
  progress,
  disabledReason,
  remainingCount,
  onUndo,
  onClose,
  onConfirm,
}: {
  changes: readonly DraftChange[];
  applying: boolean;
  progress?: DraftProgress;
  disabledReason?: string;
  remainingCount: number;
  onUndo: (id: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const deleting = changes.some((change) => change.action === draftActions.remove);
  const finished =
    progress?.status === draftStatuses.complete || progress?.status === draftStatuses.failed;
  const steps = [
    draftSteps.validate,
    ...(changes.some((change) => change.action === draftActions.unsubscribe)
      ? [draftSteps.unsubscribe]
      : []),
    ...(changes.some((change) => change.action === draftActions.subscribe)
      ? [draftSteps.subscribe]
      : []),
    ...(deleting ? [draftSteps.remove] : []),
    draftSteps.finish,
  ];
  const current = progress ? steps.indexOf(progress.step) : -1;
  const disabled = Boolean(disabledReason) || !changes.length || (deleting && !acknowledged);
  return (
    <div className="modal modal-open" role="dialog" aria-modal="true" aria-labelledby="draft-title">
      <div className="modal-box app-modal draft-modal">
        <div className="app-modal-header">
          <h2 id="draft-title">{progress ? "Apply changes" : "Review pending changes"}</h2>
          <TooltipIconButton label="Close" disabled={applying} onClick={onClose}>
            <X size={17} aria-hidden />
          </TooltipIconButton>
        </div>
        {progress ? (
          <div className="draft-progress" aria-live="polite">
            <ol className="draft-steps">
              {steps.map((step, index) => {
                const failed = index === current && progress.status === draftStatuses.failed;
                const done = index < current || progress.status === draftStatuses.complete;
                return (
                  <li
                    key={step}
                    className={
                      failed ? "failed" : done ? "complete" : index === current ? "current" : ""
                    }
                  >
                    {failed ? (
                      <CircleX size={17} aria-hidden />
                    ) : done ? (
                      <CircleCheck size={17} aria-hidden />
                    ) : index === current ? (
                      <LoaderCircle className="animate-spin" size={17} aria-hidden />
                    ) : (
                      <span className="draft-step-marker" />
                    )}
                    <span>{draftStepLabels[step]}</span>
                  </li>
                );
              })}
            </ol>
            <progress
              className="progress progress-primary"
              aria-label="Current step progress"
              value={progress.completed}
              max={Math.max(1, progress.total)}
            />
            <p
              className={progress.status === draftStatuses.failed ? "form-error" : "app-modal-copy"}
            >
              {progress.message}
            </p>
            {finished && remainingCount > 0 && (
              <p className="app-modal-copy">
                {remainingCount} {remainingCount === 1 ? "change remains" : "changes remain"} in the
                draft.
              </p>
            )}
          </div>
        ) : (
          <p className="app-modal-copy">
            {changes.length} pending {changes.length === 1 ? "change" : "changes"}. Steam
            subscriptions and saved records change only after confirmation. Tags and RimWorld's
            enabled configuration are preserved.
          </p>
        )}
        <ul className="draft-review-list" aria-label="Draft changes">
          {changes.map(({ mod, action }) => (
            <li key={mod.id}>
              <div>
                <strong>{mod.name}</strong>
                <span>{mod.author}</span>
              </div>
              <DraftBadge action={action} />
              {!progress && (
                <TooltipIconButton
                  label={`Undo pending change for ${mod.name}`}
                  onClick={() => {
                    onUndo(mod.id);
                  }}
                >
                  <Undo2 size={16} aria-hidden />
                </TooltipIconButton>
              )}
            </li>
          ))}
        </ul>
        {!progress && deleting && (
          <label className="operation-acknowledgement">
            <input
              className="checkbox checkbox-sm"
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => {
                setAcknowledged(event.target.checked);
              }}
            />
            <span>
              I confirm removing the listed records from the library. A database backup will be
              created.
            </span>
          </label>
        )}
        {!progress && disabledReason && <p className="form-error">{disabledReason}</p>}
        <div className="app-modal-actions">
          <button className="ghost-action" type="button" disabled={applying} onClick={onClose}>
            {finished ? "Close" : "Cancel"}
          </button>
          {!progress && (
            <button
              className={deleting ? "danger-action" : "primary-action"}
              type="button"
              disabled={disabled}
              onClick={() => {
                if (!disabled) {
                  onConfirm();
                }
              }}
            >
              <Check size={16} aria-hidden />
              Apply {changes.length} {changes.length === 1 ? "change" : "changes"}
            </button>
          )}
        </div>
      </div>
      <button className="modal-backdrop" type="button" disabled={applying} onClick={onClose}>
        Close
      </button>
    </div>
  );
}
