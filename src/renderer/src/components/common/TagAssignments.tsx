import { Plus, Search, Tags } from "lucide-react";
import { useState } from "react";

import { tagNameExists } from "../../../../shared/tags";
import type { ModTag } from "../../../../shared/types";
import { TagChip } from "./TagChip";
import { TooltipIconButton } from "./TooltipIconButton";

export function TagAssignments({
  tags,
  assignedIds,
  onToggle,
  onCreate,
}: {
  tags: ModTag[];
  assignedIds: string[];
  onToggle: (id: string, assigned: boolean) => void;
  onCreate: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = tags.filter((tag) =>
    tag.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const duplicate = tagNameExists(tags, query);
  return (
    <section className="tag-assignments" aria-label="Mod tags">
      <div className="tag-section-heading">
        <strong>
          <Tags size={15} aria-hidden />
          Tags
        </strong>
        <span>{assignedIds.length}</span>
      </div>
      <div className="tag-search">
        <div className="search-box">
          <Search size={15} aria-hidden />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Find or create a tag"
            aria-label="Search mod tags"
          />
        </div>
        <TooltipIconButton
          label={query.trim() ? `Create tag ${query.trim()}` : "Create tag"}
          disabled={duplicate}
          onClick={() => {
            onCreate(query.trim());
          }}
        >
          <Plus size={16} aria-hidden />
        </TooltipIconButton>
      </div>
      <div className="assignment-options">
        {filtered.map((tag) => (
          <label className="tag-option" key={tag.id}>
            <input
              type="checkbox"
              className="checkbox checkbox-xs"
              checked={assignedIds.includes(tag.id)}
              onChange={(event) => {
                onToggle(tag.id, event.target.checked);
              }}
            />
            <TagChip tag={tag} />
          </label>
        ))}
        {!filtered.length && <p className="tag-empty">No matching tags</p>}
      </div>
    </section>
  );
}
