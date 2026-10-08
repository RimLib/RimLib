import { Check, X } from "lucide-react";
import { useState } from "react";

import { tagNameExists } from "../../../../shared/tags";
import type { ModTag } from "../../../../shared/types";
import { tagColors } from "../../data/defaults";
import { maxTagNameLength } from "../../utils/uiConstants";
import { ColorPicker } from "../common/ColorPicker";
import { TooltipIconButton } from "../common/TooltipIconButton";

export function TagEditorModal({
  tag,
  initialName,
  tags,
  onClose,
  onSave,
}: {
  tag?: ModTag;
  initialName: string;
  tags: ModTag[];
  onClose: () => void;
  onSave: (name: string, color: string) => void;
}) {
  const [name, setName] = useState(tag?.name ?? initialName);
  const [color, setColor] = useState(
    tag?.color.match(/^#[0-9a-f]{6}$/i)
      ? tag.color
      : (tagColors[tags.length % tagColors.length] ?? "#7fbf90"),
  );
  const duplicate = tagNameExists(tags, name, tag?.id);
  return (
    <div
      className="modal modal-open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tag-editor-title"
    >
      <form
        className="modal-box app-modal"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() && !duplicate) {
            onSave(name.trim(), color);
          }
        }}
      >
        <div className="app-modal-header">
          <h2 id="tag-editor-title">{tag ? "Edit tag" : "New tag"}</h2>
          <TooltipIconButton label="Close" onClick={onClose}>
            <X size={17} aria-hidden />
          </TooltipIconButton>
        </div>
        <input
          autoFocus
          maxLength={maxTagNameLength}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          placeholder="Tag name"
          aria-label="Tag name"
        />
        {duplicate && (
          <p className="form-error" role="alert">
            A tag with this name already exists.
          </p>
        )}
        <ColorPicker colors={tagColors} color={color} onChange={setColor} />
        <button className="primary-action" type="submit" disabled={!name.trim() || duplicate}>
          <Check size={16} aria-hidden />
          Save tag
        </button>
      </form>
      <button className="modal-backdrop" type="button" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
