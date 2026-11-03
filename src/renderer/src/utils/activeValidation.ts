import { normalizePackageId } from "../../../shared/packages";
import type { Mod, ModDependency } from "../../../shared/types";
import { dependenciesForGameVersion } from "./dependencies";
import { normalizedGameVersion } from "./gameVersions";
import { isModMetadataUnavailable } from "./library";
import { type ModOrderConstraintCode, sortActiveMods } from "./modSort";

export type ActiveModIssueCode =
  | "metadata-unavailable"
  | "missing-dependency"
  | "incompatible-version"
  | "load-order"
  | "duplicate-package-id"
  | "load-order-cycle";

export type ActiveModIssueFix = "activate-dependencies" | "auto-sort";

export interface ActiveModIssue {
  id: string;
  code: ActiveModIssueCode;
  message: string;
  fix?: ActiveModIssueFix;
  orderRule?: ModOrderConstraintCode;
  relatedModId?: string;
}

export interface ActiveModsValidation {
  issues: readonly ActiveModIssue[];
  issuesByModId: ReadonlyMap<string, readonly ActiveModIssue[]>;
  invalidModIds: ReadonlySet<string>;
  missingDependenciesById: ReadonlyMap<string, readonly ModDependency[]>;
}

function parsedMajorMinor(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = normalizedGameVersion(value);
  return /^\d+\.\d+$/.test(normalized) ? normalized : undefined;
}

function issueId(modId: string, code: ActiveModIssueCode, detail = ""): string {
  return `${modId}\0${code}\0${detail}`;
}

/**
 * Validates the projected Active list without changing it. Passing the projected list is
 * intentional: staged activation, deactivation, reorder and auto-sort actions must be reflected
 * immediately while remaining ordinary, reversible draft actions.
 */
export function validateActiveMods(
  activeMods: readonly Mod[],
  gameVersion?: string,
): ActiveModsValidation {
  const issues: ActiveModIssue[] = [];
  const issuesByModId = new Map<string, ActiveModIssue[]>();
  const missingDependenciesById = new Map<string, ModDependency[]>();
  const invalidModIds = new Set<string>();
  const issueIds = new Set<string>();
  const activePackageIds = new Set(
    activeMods.flatMap((mod) => (mod.packageId ? [normalizePackageId(mod.packageId)] : [])),
  );

  const addIssue = (modId: string, issue: ActiveModIssue) => {
    if (issueIds.has(issue.id)) {
      return;
    }
    issueIds.add(issue.id);
    issues.push(issue);
    issuesByModId.set(modId, [...(issuesByModId.get(modId) ?? []), issue]);
    invalidModIds.add(modId);
  };

  const currentVersion = parsedMajorMinor(gameVersion);
  for (const mod of activeMods) {
    if (isModMetadataUnavailable(mod)) {
      addIssue(mod.id, {
        id: issueId(mod.id, "metadata-unavailable"),
        code: "metadata-unavailable",
        message: `${mod.name} has incomplete installed metadata.`,
      });
    }

    const supportedVersions = mod.gameVersions
      .map((candidate) => parsedMajorMinor(candidate))
      .filter((candidate): candidate is string => candidate !== undefined);
    if (
      currentVersion &&
      supportedVersions.length > 0 &&
      !supportedVersions.includes(currentVersion)
    ) {
      addIssue(mod.id, {
        id: issueId(mod.id, "incompatible-version", currentVersion),
        code: "incompatible-version",
        message: `${mod.name} supports RimWorld ${mod.gameVersions.join(", ")}, not ${currentVersion}.`,
      });
    }

    const missing = new Map<string, ModDependency>();
    for (const dependency of dependenciesForGameVersion(mod, gameVersion)) {
      const packageId = normalizePackageId(dependency.packageId);
      if (!packageId || activePackageIds.has(packageId)) {
        continue;
      }
      missing.set(packageId, dependency);
    }
    if (missing.size) {
      const dependencies = [...missing.values()];
      missingDependenciesById.set(mod.id, dependencies);
      for (const dependency of dependencies) {
        const displayName = dependency.displayName?.trim();
        const label = displayName?.length ? displayName : dependency.packageId;
        addIssue(mod.id, {
          id: issueId(mod.id, "missing-dependency", normalizePackageId(dependency.packageId)),
          code: "missing-dependency",
          fix: "activate-dependencies",
          message: `${mod.name} requires active dependency ${label}.`,
        });
      }
    }
  }

  const sortResult = sortActiveMods(activeMods, gameVersion);
  const duplicateModIds = new Set<string>();
  if (!sortResult.ok && sortResult.code === "duplicate-package-id") {
    for (const duplicate of sortResult.duplicates) {
      for (const modId of duplicate.modIds) {
        duplicateModIds.add(modId);
        addIssue(modId, {
          id: issueId(modId, "duplicate-package-id", duplicate.packageId),
          code: "duplicate-package-id",
          message: `Multiple active mods use package ID ${duplicate.packageId}.`,
        });
      }
    }
  }

  const cyclicModIds = new Set(sortResult.cycles.flatMap(({ modIds }) => modIds));
  for (const cycle of sortResult.cycles) {
    const cycleKey = cycle.packageIds.join("->");
    for (const modId of cycle.modIds) {
      addIssue(modId, {
        id: issueId(modId, "load-order-cycle", cycleKey),
        code: "load-order-cycle",
        message: `Load-order rules form a cycle involving ${cycle.packageIds.join(", ")}.`,
      });
    }
  }

  const positions = new Map(activeMods.map((mod, index) => [mod.id, index]));
  for (const constraint of sortResult.constraints) {
    // A cyclic edge has no satisfiable order. The cycle finding is more useful than additionally
    // reporting whichever edge happens to be reversed in the current list.
    if (
      cyclicModIds.has(constraint.predecessorModId) ||
      cyclicModIds.has(constraint.dependentModId)
    ) {
      continue;
    }
    const predecessor = positions.get(constraint.predecessorModId);
    const dependent = positions.get(constraint.dependentModId);
    if (predecessor === undefined || dependent === undefined || predecessor < dependent) {
      continue;
    }
    addIssue(constraint.ownerModId, {
      id: issueId(
        constraint.ownerModId,
        "load-order",
        `${constraint.dependentPackageId}<-${constraint.predecessorPackageId}`,
      ),
      code: "load-order",
      fix: "auto-sort",
      orderRule: constraint.code,
      relatedModId:
        constraint.ownerModId === constraint.predecessorModId
          ? constraint.dependentModId
          : constraint.predecessorModId,
      message: constraint.message,
    });
  }

  // RimWorld's bootstrap packages and their prerequisites form an early tier in the sorter.
  // Mark a tier member itself when a regular mod appears before it (not every regular mod),
  // keeping the diagnostics useful and bounded for very large lists.
  const tierZeroIds = new Set(sortResult.tierZeroModIds);
  // Duplicate package IDs are deliberately excluded from the shared order graph because their
  // identity is ambiguous. Exclude those same rows here so, for example, duplicate Harmony rows
  // are not mistaken for regular mods and do not create a false bootstrap issue on Core.
  const orderDiagnosticMods = activeMods.filter((mod) => !duplicateModIds.has(mod.id));
  const firstRegularIndex = orderDiagnosticMods.findIndex((mod) => !tierZeroIds.has(mod.id));
  if (firstRegularIndex >= 0) {
    for (let index = firstRegularIndex + 1; index < orderDiagnosticMods.length; index += 1) {
      const mod = orderDiagnosticMods[index];
      if (!mod || !tierZeroIds.has(mod.id) || cyclicModIds.has(mod.id)) {
        continue;
      }
      addIssue(mod.id, {
        id: issueId(mod.id, "load-order", "bootstrap-tier"),
        code: "load-order",
        fix: "auto-sort",
        orderRule: "bootstrap",
        message: `${mod.name} must load before regular mods in the bootstrap section.`,
      });
    }
  }

  return {
    issues,
    issuesByModId,
    invalidModIds,
    missingDependenciesById,
  };
}
