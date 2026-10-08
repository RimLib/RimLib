import { createStore, type StoreApi } from "zustand/vanilla";

import type { Mod } from "../../../shared/types";
import {
  type DraftAction,
  type DraftChange,
  type DraftPolicy,
  type DraftProgress,
  stageDraftChanges,
} from "../utils/drafts";

interface DraftState {
  readonly changes: readonly DraftChange[];
  readonly applying: boolean;
  readonly reviewOpen: boolean;
  readonly reviewBatch?: readonly DraftChange[];
  readonly progress?: DraftProgress;
  readonly actions: {
    stage: (mods: readonly Mod[], action: DraftAction, policy: DraftPolicy) => void;
    undo: (id: string) => void;
    discard: () => void;
    openReview: () => void;
    closeReview: () => void;
    reportProgress: (progress: DraftProgress) => void;
    beginApply: () => readonly DraftChange[] | undefined;
    complete: (id: string) => void;
    endApply: () => void;
  };
}
export type DraftStore = Pick<StoreApi<DraftState>, "getState" | "getInitialState" | "subscribe">;

export function createDraftStore(): DraftStore {
  const store = createStore<DraftState>()((set, get) => ({
    changes: [],
    applying: false,
    reviewOpen: false,
    reviewBatch: undefined,
    progress: undefined,
    actions: {
      stage: (mods, action, policy) => {
        set((state) => {
          if (state.applying) {
            return state;
          }
          const changes = stageDraftChanges(state.changes, mods, action, policy);
          return changes === state.changes ? state : { changes };
        });
      },
      undo: (id) => {
        set((state) =>
          state.applying || !state.changes.some((change) => change.mod.id === id)
            ? state
            : { changes: state.changes.filter((change) => change.mod.id !== id) },
        );
      },
      discard: () => {
        set((state) => (state.applying || !state.changes.length ? state : { changes: [] }));
      },
      openReview: () => {
        set((state) =>
          state.reviewOpen || state.applying || !state.changes.length
            ? state
            : { reviewOpen: true, reviewBatch: undefined, progress: undefined },
        );
      },
      closeReview: () => {
        set((state) => (!state.reviewOpen || state.applying ? state : { reviewOpen: false }));
      },
      reportProgress: (progress) => {
        set({ progress });
      },
      beginApply: () => {
        const { changes, applying } = get();
        if (applying || !changes.length) {
          return undefined;
        }
        set({ applying: true, reviewBatch: changes });
        return changes;
      },
      complete: (id) => {
        set((state) =>
          !state.applying || !state.changes.some((change) => change.mod.id === id)
            ? state
            : { changes: state.changes.filter((change) => change.mod.id !== id) },
        );
      },
      endApply: () => {
        set((state) => (state.applying ? { applying: false } : state));
      },
    },
  }));
  return {
    getState: store.getState,
    getInitialState: store.getInitialState,
    subscribe: store.subscribe,
  };
}
