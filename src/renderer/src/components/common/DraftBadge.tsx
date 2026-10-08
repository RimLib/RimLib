import { type DraftAction, draftActionLabels } from "../../utils/drafts";

export function DraftBadge({ action }: { action: DraftAction }) {
  return <span className={`draft-badge draft-${action}`}>{draftActionLabels[action]}</span>;
}
