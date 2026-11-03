import { Clock3 } from "lucide-react";

import { type DraftAction, draftActionLabels } from "../../utils/drafts";

export type DraftIndicatorKind = DraftAction | "order";

export function DraftBadge({ action, label }: { action: DraftIndicatorKind; label?: string }) {
  return (
    <span className={`draft-badge draft-${action}`}>
      <Clock3 size={11} strokeWidth={2.25} aria-hidden />
      <span>{label ?? (action === "order" ? "Pending order" : draftActionLabels[action])}</span>
    </span>
  );
}
