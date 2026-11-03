import { useMemo } from "react";

import { isOfficialMod } from "../../../shared/packages";
import type { ActiveModsState, LocalSteamState, Mod, ModTag } from "../../../shared/types";
import { buildModViews } from "../utils/activeMods";
import type { ActiveModsValidation } from "../utils/activeValidation";
import { validateActiveMods } from "../utils/activeValidation";
import { canStageAutoSortDependency } from "../utils/autoSortDependencies";
import {
  deriveDraftActivityDelta,
  type DraftAction,
  draftActiveOrderTemplate,
  type DraftActivityDelta,
  type DraftChange,
  projectActivityPanels,
} from "../utils/drafts";
import { activityPanels } from "../utils/library";

export interface WorkspaceProjectionDraft {
  changes: readonly DraftChange[];
  activeOrder?: readonly string[];
  activeBasePackageIds?: readonly string[];
}

export interface WorkspaceProjectionInput {
  active: ActiveModsState;
  mods: Mod[];
  tags: readonly ModTag[];
  localSteamState: LocalSteamState;
  draft: WorkspaceProjectionDraft;
}

export interface WorkspaceProjection {
  displayMods: Mod[];
  savedIds: ReadonlySet<string>;
  actualPanels: ReturnType<typeof activityPanels>;
  actualMods: Mod[];
  draftActionsById: ReadonlyMap<string, readonly DraftAction[]>;
  draftActivityDelta: DraftActivityDelta;
  membershipPanels: ReturnType<typeof projectActivityPanels>;
  panels: ReturnType<typeof projectActivityPanels>;
  restoreTargets: Mod[];
  inactiveCountByTagId: ReadonlyMap<string, number>;
  autoSortDependencyCandidates: Mod[];
  activeValidation: ActiveModsValidation;
  actualById: ReadonlyMap<string, Mod>;
}

/**
 * Derives the renderer's current mod universe and projected draft view without performing I/O.
 * The memoization remains deliberately granular: metadata, tags and draft edits can change
 * independently in large libraries, so unrelated projections should keep their references.
 */
export function useWorkspaceProjection({
  active,
  mods,
  tags,
  localSteamState,
  draft,
}: WorkspaceProjectionInput): WorkspaceProjection {
  const modViews = useMemo(() => buildModViews(active, mods), [active, mods]);
  const displayMods = modViews.allEntries;
  const savedIds = useMemo(() => new Set(mods.map((mod) => mod.id)), [mods]);
  const actualPanels = useMemo(
    () => activityPanels({ localSteamState }, displayMods, modViews.activeEntries),
    [localSteamState, displayMods, modViews.activeEntries],
  );
  const actualMods = useMemo(
    () => [...actualPanels.inactive, ...actualPanels.active],
    [actualPanels],
  );
  const draftActionsById = useMemo(() => {
    const result = new Map<string, DraftAction[]>();
    for (const change of draft.changes) {
      result.set(change.mod.id, [...(result.get(change.mod.id) ?? []), change.action]);
    }
    return result;
  }, [draft.changes]);
  const draftActivityDelta = useMemo(
    () => deriveDraftActivityDelta(draft.changes),
    [draft.changes],
  );
  const membershipPanels = useMemo(
    () => projectActivityPanels(actualPanels.inactive, actualPanels.active, draft.changes),
    [actualPanels, draft.changes],
  );
  const projectedActiveOrder = useMemo(
    () =>
      draft.activeOrder ??
      draftActiveOrderTemplate(draft.activeBasePackageIds ?? active.packageIds, draft.changes),
    [active.packageIds, draft.activeBasePackageIds, draft.activeOrder, draft.changes],
  );
  const panels = useMemo(
    () =>
      projectActivityPanels(
        actualPanels.inactive,
        actualPanels.active,
        draft.changes,
        projectedActiveOrder,
      ),
    [actualPanels, draft.changes, projectedActiveOrder],
  );
  const restoreTargets = useMemo(
    () => panels.active.filter((mod) => !isOfficialMod(mod)),
    [panels.active],
  );
  const inactiveCountByTagId = useMemo(
    () =>
      new Map(
        tags.map((tag) => [
          tag.id,
          panels.inactive.filter((mod) => mod.userTagIds?.includes(tag.id)).length,
        ]),
      ),
    [panels.inactive, tags],
  );
  const autoSortDependencyCandidates = useMemo(
    () => membershipPanels.inactive.filter((mod) => canStageAutoSortDependency(mod, savedIds)),
    [membershipPanels.inactive, savedIds],
  );
  const activeValidation = useMemo(
    () => validateActiveMods(panels.active, active.gameVersion),
    [panels.active, active.gameVersion],
  );
  const actualById = useMemo(
    () => new Map([...actualPanels.inactive, ...actualPanels.active].map((mod) => [mod.id, mod])),
    [actualPanels],
  );

  return {
    displayMods,
    savedIds,
    actualPanels,
    actualMods,
    draftActionsById,
    draftActivityDelta,
    membershipPanels,
    panels,
    restoreTargets,
    inactiveCountByTagId,
    autoSortDependencyCandidates,
    activeValidation,
    actualById,
  };
}
