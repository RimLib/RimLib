import { Check, CircleCheck, CircleX, LoaderCircle, Undo2, X } from "lucide-react";
import { useState } from "react";

import {
  activeOrderDraftKinds,
  type ActiveOrderDraftOperation,
  draftActions,
  type DraftChange,
  draftOperationCount,
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
  activeOrderOperations = [],
  remainingCount,
  onUndo,
  onUndoActiveOrder,
  onClose,
  onConfirm,
}: {
  changes: readonly DraftChange[];
  applying: boolean;
  progress?: DraftProgress;
  disabledReason?: string;
  activeOrderOperations?: readonly ActiveOrderDraftOperation[];
  remainingCount: number;
  onUndo: (id: string) => void;
  onUndoActiveOrder: (operationId: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const deleting = changes.some((change) => change.action === draftActions.remove);
  const changeCount = draftOperationCount(changes, activeOrderOperations.length);
  const finished =
    progress?.status === draftStatuses.complete || progress?.status === draftStatuses.failed;
  const steps = [
    draftSteps.validate,
    ...(changes.some((change) => change.action === draftActions.subscribe)
      ? [draftSteps.subscribe]
      : []),
    ...(activeOrderOperations.length > 0 ||
    changes.some(
      (change) =>
        change.action === draftActions.activate || change.action === draftActions.deactivate,
    )
      ? [draftSteps.configure]
      : []),
    ...(changes.some((change) => change.action === draftActions.unsubscribe)
      ? [draftSteps.unsubscribe]
      : []),
    ...(deleting ? [draftSteps.remove] : []),
    draftSteps.finish,
  ];
  const current = progress ? steps.indexOf(progress.step) : -1;
  const disabled = Boolean(disabledReason) || !changeCount || (deleting && !acknowledged);
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
            {changeCount} pending {changeCount === 1 ? "change" : "changes"}. Steam subscriptions,
            saved records, active mods and load order change only after confirmation. Tags are
            preserved.
          </p>
        )}
        <ul className="draft-review-list" aria-label="Draft changes">
          {changes.map(({ mod, action }) => (
            <li key={`${mod.id}:${action}`}>
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
          {activeOrderOperations.map((operation) => (
            <li key={operation.id}>
              <div>
                <strong>{operation.modName}</strong>
                <span>
                  {operation.kind === activeOrderDraftKinds.autoSort
                    ? "Auto-sort: move"
                    : operation.kind === activeOrderDraftKinds.import
                      ? "Import: move"
                      : "Move"}{" "}
                  from position {operation.fromPosition} to position {operation.toPosition}
                  {operation.kind === activeOrderDraftKinds.import
                    ? ` · ${operation.fileName}`
                    : ""}
                </span>
              </div>
              <DraftBadge action="order" />
              {!progress && (
                <TooltipIconButton
                  label={`Undo pending load order change for ${operation.modName}`}
                  onClick={() => {
                    onUndoActiveOrder(operation.id);
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
              Apply {changeCount} {changeCount === 1 ? "change" : "changes"}
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
