import { normalizePackageId } from "../../../shared/packages";
import { isWorkshopMod } from "../../../shared/subscriptions";
import type { Mod, ModDependency } from "../../../shared/types";
import { dependenciesForGameVersion } from "./dependencies";

export const autoSortDependencyStatuses = Object.freeze({
  available: "available",
  unavailable: "unavailable",
  ambiguous: "ambiguous",
} as const);

export type AutoSortDependencyStatus =
  (typeof autoSortDependencyStatuses)[keyof typeof autoSortDependencyStatuses];

export interface AutoSortDependencyEntry {
  /** Normalized package ID used to collapse duplicate declarations. */
  packageId: string;
  dependency: ModDependency;
  requiredBy: readonly Mod[];
  status: AutoSortDependencyStatus;
  target?: Mod;
  candidates: readonly Mod[];
}

export interface AutoSortDependencyPlan {
  entries: readonly AutoSortDependencyEntry[];
  availableEntries: readonly AutoSortDependencyEntry[];
  unresolvedEntries: readonly AutoSortDependencyEntry[];
  /** Unique Library rows that can be activated before sorting. */
  availableMods: readonly Mod[];
  /** Number of current or planned Active rows that declare at least one missing dependency. */
  affectedModCount: number;
}

type PlanningDependencyEntry = Omit<AutoSortDependencyEntry, "requiredBy"> & {
  requiredBy: Mod[];
};

/** A Workshop row that needs subscribing must exist in the saved library before it can be staged. */
export function canStageAutoSortDependency(mod: Mod, savedIds: ReadonlySet<string>): boolean {
  return !isWorkshopMod(mod) || mod.subscribed || savedIds.has(mod.id);
}

/** Stable snapshot key used to reject a dependency decision after its inputs have changed. */
export function autoSortDependencyPlanKey(plan: AutoSortDependencyPlan): string {
  return JSON.stringify(
    plan.entries.map((entry) => ({
      packageId: entry.packageId,
      displayName: entry.dependency.displayName?.trim() ?? "",
      status: entry.status,
      targetId: entry.target?.id ?? "",
      candidateIds: entry.candidates.map((candidate) => candidate.id),
      requiredByIds: entry.requiredBy.map((mod) => mod.id),
    })),
  );
}

/**
 * Describe dependencies missing from a projected Active list without throwing when only some can
 * be resolved. The caller decides what "available in Library" means by supplying the candidate
 * rows (normally saved, inactive Library rows).
 */
export function buildAutoSortDependencyPlan(
  activeMods: readonly Mod[],
  libraryCandidates: readonly Mod[],
  gameVersion?: string,
): AutoSortDependencyPlan {
  const activePackageIds = new Set(
    activeMods.flatMap((mod) => (mod.packageId ? [normalizePackageId(mod.packageId)] : [])),
  );
  const projectedPackageIds = new Set(activePackageIds);
  const candidatesByPackage = new Map<string, Mod[]>();
  for (const mod of libraryCandidates) {
    if (!mod.packageId) {
      continue;
    }
    const packageId = normalizePackageId(mod.packageId);
    const candidates = candidatesByPackage.get(packageId) ?? [];
    if (!candidates.some((candidate) => candidate.id === mod.id)) {
      candidates.push(mod);
    }
    candidatesByPackage.set(packageId, candidates);
  }

  const missingByPackage = new Map<string, PlanningDependencyEntry>();
  const pending = [...activeMods];
  const processed = new Set<string>();
  while (pending.length) {
    const mod = pending.shift();
    if (!mod || processed.has(mod.id)) {
      continue;
    }
    processed.add(mod.id);
    for (const dependency of dependenciesForGameVersion(mod, gameVersion)) {
      const packageId = normalizePackageId(dependency.packageId);
      if (activePackageIds.has(packageId)) {
        continue;
      }
      const existing = missingByPackage.get(packageId);
      if (existing) {
        if (!existing.requiredBy.some((dependent) => dependent.id === mod.id)) {
          existing.requiredBy.push(mod);
        }
        if (!existing.dependency.displayName && dependency.displayName) {
          existing.dependency = dependency;
        }
        continue;
      }
      const candidates = candidatesByPackage.get(packageId) ?? [];
      const status =
        candidates.length === 1
          ? autoSortDependencyStatuses.available
          : candidates.length > 1
            ? autoSortDependencyStatuses.ambiguous
            : autoSortDependencyStatuses.unavailable;
      const entry: PlanningDependencyEntry = {
        packageId,
        dependency,
        requiredBy: [mod],
        status,
        target: candidates.length === 1 ? candidates[0] : undefined,
        candidates,
      };
      missingByPackage.set(packageId, entry);
      if (entry.target && !projectedPackageIds.has(packageId)) {
        projectedPackageIds.add(packageId);
        pending.push(entry.target);
      }
    }
  }

  const entries = [...missingByPackage.values()];
  const availableEntries = entries.filter(
    (entry) => entry.status === autoSortDependencyStatuses.available,
  );
  const unresolvedEntries = entries.filter(
    (entry) => entry.status !== autoSortDependencyStatuses.available,
  );
  const availableMods = [
    ...new Map(
      availableEntries.flatMap((entry) => (entry.target ? [[entry.target.id, entry.target]] : [])),
    ).values(),
  ];
  const affectedModCount = new Set(
    entries.flatMap((entry) => entry.requiredBy.map((mod) => mod.id)),
  ).size;

  return { entries, availableEntries, unresolvedEntries, availableMods, affectedModCount };
}
