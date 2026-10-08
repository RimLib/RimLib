import { createContext, type ReactNode, useContext, useState } from "react";
import { useStore } from "zustand";

import { requireValue } from "../../../shared/validation";
import { createDraftStore, type DraftStore } from "./draftStore";
import { createWorkspaceStore, type WorkspaceState, type WorkspaceStore } from "./workspaceStore";

const WorkspaceContext = createContext<
  { workspace: WorkspaceStore; drafts: DraftStore } | undefined
>(undefined);

export function WorkspaceStoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => ({
    workspace: createWorkspaceStore(),
    drafts: createDraftStore(),
  }));
  return <WorkspaceContext.Provider value={store}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspaceStore<T>(selector: (state: WorkspaceState) => T): T {
  const store = requireValue(
    useContext(WorkspaceContext),
    "Workspace hooks require WorkspaceStoreProvider",
  );
  return useStore(store.workspace, selector);
}

export function useDraftStore<T>(selector: (state: ReturnType<DraftStore["getState"]>) => T): T {
  const store = requireValue(
    useContext(WorkspaceContext),
    "Draft hooks require WorkspaceStoreProvider",
  );
  return useStore(store.drafts, selector);
}
