import { ListOrdered, X } from "lucide-react";
import { type SyntheticEvent, useState } from "react";

import { keyboardKeys } from "../../utils/uiConstants";
import { TooltipIconButton } from "../common/TooltipIconButton";

export interface MoveActiveModModalProps {
  modNames: readonly string[];
  activeCount: number;
  initialPosition: number;
  onConfirm: (position: number) => void;
  onClose: () => void;
}

export type MoveActivePositionValidation =
  { position: number; error?: undefined } | { position?: undefined; error: string };

export function validateMoveActivePosition(
  value: string,
  activeCount: number,
): MoveActivePositionValidation {
  const maximum = Math.floor(activeCount);
  if (maximum < 1) {
    return { error: "There are no Active positions available." };
  }

  const normalized = value.trim();
  if (!normalized) {
    return { error: "Enter a position." };
  }
  if (!/^\d+$/.test(normalized)) {
    return { error: `Enter a whole number between 1 and ${maximum}.` };
  }

  const position = Number(normalized);
  if (!Number.isSafeInteger(position) || position < 1 || position > maximum) {
    return { error: `Enter a position between 1 and ${maximum}.` };
  }
  return { position };
}

function selectionCopy(modNames: readonly string[]) {
  if (modNames.length === 1) {
    return <strong>{modNames[0]}</strong>;
  }
  if (modNames.length > 1) {
    return (
      <>
        <strong>
          {modNames.length} {modNames.length === 1 ? "mod" : "mods"}
        </strong>{" "}
        ({modNames.join(", ")})
      </>
    );
  }
  return <strong>the selected mod</strong>;
}

export function MoveActiveModModal({
  modNames,
  activeCount,
  initialPosition,
  onConfirm,
  onClose,
}: MoveActiveModModalProps) {
  const [value, setValue] = useState(String(initialPosition));
  const validation = validateMoveActivePosition(value, activeCount);
  const unchanged = validation.position === initialPosition;
  const title = modNames.length === 1 ? "Move active mod" : "Move active mods";
  const descriptionId = "move-active-mod-description";
  const feedbackId = "move-active-mod-feedback";

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (validation.position !== undefined && !unchanged) {
      onConfirm(validation.position);
    }
  }

  return (
    <div
      className="modal modal-open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-active-mod-title"
      aria-describedby={descriptionId}
      onKeyDown={(event) => {
        if (event.key === keyboardKeys.escape) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <form className="modal-box app-modal" noValidate onSubmit={submit}>
        <div className="app-modal-header">
          <h2 id="move-active-mod-title">{title}</h2>
          <TooltipIconButton label="Close" onClick={onClose}>
            <X size={17} aria-hidden />
          </TooltipIconButton>
        </div>
        <p className="app-modal-copy" id={descriptionId}>
          Move {selectionCopy(modNames)} to a new position in the Active list. The load-order change
          stays pending until you apply it.
        </p>
        <label className="app-modal-field" htmlFor="move-active-mod-position">
          <span>Position (1–{Math.max(0, Math.floor(activeCount))})</span>
          <input
            id="move-active-mod-position"
            autoFocus
            type="number"
            inputMode="numeric"
            min={1}
            max={Math.max(1, Math.floor(activeCount))}
            step={1}
            value={value}
            aria-invalid={Boolean(validation.error)}
            aria-describedby={feedbackId}
            onChange={(event) => {
              setValue(event.target.value);
            }}
          />
        </label>
        <p
          className={validation.error ? "form-error" : "app-modal-copy"}
          id={feedbackId}
          role={validation.error ? "alert" : undefined}
        >
          {validation.error ??
            (unchanged
              ? `Currently at position ${initialPosition}. Choose a different position.`
              : `Stage this move to position ${validation.position}.`)}
        </p>
        <div className="app-modal-actions">
          <button className="ghost-action" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-action"
            type="submit"
            disabled={validation.position === undefined || unchanged}
          >
            <ListOrdered size={16} aria-hidden />
            Stage move
          </button>
        </div>
      </form>
      <button className="modal-backdrop" type="button" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
