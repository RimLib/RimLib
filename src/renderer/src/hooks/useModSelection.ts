import { useEffect, useMemo } from "react";

import type { Mod } from "../../../shared/types";
import { useWorkspaceStore } from "../stores/WorkspaceStoreProvider";
import { reconcileModSelection } from "../utils/modSelection";

export function useModSelection(library: Mod[], subscribed: Mod[]) {
  const selection = useWorkspaceStore((state) => state.selection);
  const actions = useWorkspaceStore((state) => state.actions);
  const ordered = useMemo(
    () => ({
      unsubscribed: library.map((mod) => mod.id),
      subscribed: subscribed.map((mod) => mod.id),
    }),
    [library, subscribed],
  );
  const reconciled = useMemo(
    () => reconcileModSelection(selection, selection.panel ? ordered[selection.panel] : []),
    [selection, ordered],
  );
  useEffect(() => {
    actions.reconcile(ordered);
  }, [actions, ordered]);
  return reconciled;
}
