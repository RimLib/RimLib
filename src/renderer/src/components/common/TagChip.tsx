import type { ModTag } from "../../../../shared/types";
import { tagChipStyle } from "../../utils/tagColors";

export function TagChip({ tag, title }: { tag: ModTag; title?: string }) {
  return (
    <span className="user-tag" title={title ?? tag.name} style={tagChipStyle(tag.color)}>
      <span>{tag.name}</span>
    </span>
  );
}
