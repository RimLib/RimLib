import type { ModTag } from "../../../../shared/types";
import { tagChipStyle } from "../../utils/tagColors";

export function TagChip({ tag }: { tag: ModTag }) {
  return (
    <span className="user-tag" title={tag.name} style={tagChipStyle(tag.color)}>
      <span>{tag.name}</span>
    </span>
  );
}
