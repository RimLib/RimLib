import { draftActions, type DraftChange } from "./drafts";

/** A dependency notice is current only while every dependency remains staged for activation. */
export function hasStagedDependencyActivations(
  changes: readonly DraftChange[],
  modIds: readonly string[],
): boolean {
  if (!modIds.length) {
    return false;
  }
  const stagedIds = new Set(
    changes.flatMap((change) => (change.action === draftActions.activate ? [change.mod.id] : [])),
  );
  return modIds.every((id) => stagedIds.has(id));
}
