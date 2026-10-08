import { Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useState } from "react";

import type { ModTag } from "../../../../shared/types";
import { tooltipPlacements } from "../../utils/tooltips";
import { EmptyState } from "../common/EmptyState";
import { TagChip } from "../common/TagChip";
import { TooltipIconButton } from "../common/TooltipIconButton";

export function ManageTagsModal({
  tags,
  onCreate,
  onEdit,
  onDelete,
  onClose,
}: {
  tags: ModTag[];
  onCreate: () => void;
  onEdit: (tag: ModTag) => void;
  onDelete: (tag: ModTag) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = tags.filter((tag) =>
    tag.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <div
      className="modal modal-open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manage-tags-title"
    >
      <div className="modal-box app-modal tag-manager-modal">
        <div className="app-modal-header">
          <div className="tag-manager-heading">
            <h2 id="manage-tags-title">Tags</h2>
            <span>{tags.length} tags</span>
          </div>
          <div className="modal-header-actions">
            <TooltipIconButton
              label="Create tag"
              placement={tooltipPlacements.bottom}
              onClick={onCreate}
            >
              <Plus size={17} aria-hidden />
            </TooltipIconButton>
            <TooltipIconButton label="Close" placement={tooltipPlacements.bottom} onClick={onClose}>
              <X size={17} aria-hidden />
            </TooltipIconButton>
          </div>
        </div>
        <div className="search-box">
          <Search size={16} aria-hidden />
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            placeholder="Search tags"
            aria-label="Search tags"
          />
        </div>
        <div className="tag-manager-list" role="list">
          {filtered.map((tag) => (
            <div className="tag-manager-row" role="listitem" key={tag.id}>
              <TagChip tag={tag} />
              <TooltipIconButton
                label="Edit tag"
                aria-label={`Edit ${tag.name}`}
                placement={tooltipPlacements.left}
                onClick={() => {
                  onEdit(tag);
                }}
              >
                <Pencil size={15} aria-hidden />
              </TooltipIconButton>
              <TooltipIconButton
                label="Delete tag"
                aria-label={`Delete ${tag.name}`}
                placement={tooltipPlacements.left}
                className="icon-button danger"
                onClick={() => {
                  onDelete(tag);
                }}
              >
                <Trash2 size={15} aria-hidden />
              </TooltipIconButton>
            </div>
          ))}
          {!filtered.length && (
            <EmptyState label={tags.length ? "No matching tags" : "No tags yet"} />
          )}
        </div>
      </div>
      <button className="modal-backdrop" type="button" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
