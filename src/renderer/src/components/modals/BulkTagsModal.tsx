import { Plus, Search, Tag, Tags, X } from "lucide-react";
import { type SyntheticEvent, useEffect, useRef, useState } from "react";

import { tagNameExists } from "../../../../shared/tags";
import type { Mod, ModTag } from "../../../../shared/types";
import { keyboardKeys } from "../../utils/uiConstants";
import { TagChip } from "../common/TagChip";
import { TooltipIconButton } from "../common/TooltipIconButton";

export interface BulkTagsModalProps {
  mods: Mod[];
  tags: ModTag[];
  assigned: boolean;
  disabled?: boolean;
  hidden?: boolean;
  createdTagId?: string;
  onClose: () => void;
  onConfirm: (tagIds: string[]) => void;
  onCreateTag: (name: string) => void;
}

export function BulkTagsModal({
  mods,
  tags,
  assigned,
  disabled = false,
  hidden = false,
  createdTagId,
  onClose,
  onConfirm,
  onCreateTag,
}: BulkTagsModalProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!hidden) {
      input.current?.focus({ preventScroll: true });
    }
  }, [hidden]);
  useEffect(() => {
    if (createdTagId) {
      setSelected((previous) => [...new Set([...previous, createdTagId])]);
      setQuery("");
    }
  }, [createdTagId]);
  const available = tags.filter(
    (tag) => assigned || mods.some((mod) => mod.userTagIds?.includes(tag.id)),
  );
  const filtered = available.filter((tag) =>
    tag.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const chosen = selected.filter((id) => available.some((tag) => tag.id === id));
  const createDisabled = disabled || tagNameExists(tags, query);

  function submit(event: SyntheticEvent) {
    event.preventDefault();
    if (!disabled && chosen.length && mods.length) {
      onConfirm(chosen);
    }
  }

  return (
    <div
      className={`modal ${hidden ? "hidden" : "modal-open"}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-tags-title"
      onKeyDown={(event) => {
        if (event.key === keyboardKeys.escape && !disabled && !hidden) {
          onClose();
        }
      }}
    >
      <form className="modal-box app-modal" onSubmit={submit}>
        <div className="app-modal-header">
          <h2 id="bulk-tags-title">{assigned ? "Add tags" : "Remove tags"}</h2>
          <TooltipIconButton label="Close" disabled={disabled} onClick={onClose}>
            <X size={17} aria-hidden />
          </TooltipIconButton>
        </div>
        <p className="app-modal-copy">
          <strong>
            {mods.length} {mods.length === 1 ? "mod" : "mods"}
          </strong>
        </p>
        <div className="flex min-w-0 gap-2">
          <div className="search-box h-9">
            <Search size={16} aria-hidden />
            <input
              ref={input}
              autoFocus
              value={query}
              disabled={disabled}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="Search tags"
              aria-label="Search tags for selected mods"
            />
          </div>
          {assigned && (
            <TooltipIconButton
              label={query.trim() ? `Create tag ${query.trim()}` : "Create tag"}
              disabled={createDisabled}
              onClick={() => {
                onCreateTag(query.trim());
              }}
            >
              <Plus size={17} aria-hidden />
            </TooltipIconButton>
          )}
        </div>
        <div className="bulk-tag-options">
          {filtered.map((tag) => (
            <label className="tag-option bulk-tag-option" key={tag.id}>
              <input
                className="checkbox checkbox-xs"
                type="checkbox"
                checked={chosen.includes(tag.id)}
                disabled={disabled}
                onChange={(event) => {
                  setSelected((previous) =>
                    event.target.checked
                      ? [...new Set([...previous, tag.id])]
                      : previous.filter((id) => id !== tag.id),
                  );
                }}
              />
              <TagChip tag={tag} />
              <small>
                {mods.filter((mod) => mod.userTagIds?.includes(tag.id)).length}/{mods.length}
              </small>
            </label>
          ))}
          {!filtered.length && (
            <p className="tag-empty">
              {available.length
                ? "No matching tags"
                : assigned
                  ? "No tags yet"
                  : "No tags assigned"}
            </p>
          )}
        </div>
        <div className="app-modal-actions">
          <button className="ghost-action" type="button" disabled={disabled} onClick={onClose}>
            Cancel
          </button>
          <button
            className={assigned ? "primary-action" : "danger-action"}
            type="submit"
            disabled={disabled || !chosen.length || !mods.length}
          >
            {assigned ? <Tags size={16} aria-hidden /> : <Tag size={16} aria-hidden />}
            {assigned ? "Add tags" : "Remove tags"}
          </button>
        </div>
      </form>
      <button className="modal-backdrop" type="button" disabled={disabled} onClick={onClose}>
        Close
      </button>
    </div>
  );
}
