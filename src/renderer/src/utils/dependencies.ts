import { normalizePackageId } from "../../../shared/packages";
import type { Mod, ModDependency } from "../../../shared/types";
import { matchingVersionedGroup, normalizedGameVersion } from "./gameVersions";

export function dependencyAppliesToGameVersion(
  dependency: ModDependency,
  gameVersion?: string,
): boolean {
  return (
    !dependency.gameVersions?.length ||
    Boolean(
      gameVersion &&
      dependency.gameVersions.some(
        (candidate) => normalizedGameVersion(candidate) === normalizedGameVersion(gameVersion),
      ),
    )
  );
}

export function dependenciesForGameVersion(
  mod: Pick<Mod, "dependencies" | "dependenciesByVersion">,
  gameVersion?: string,
): ModDependency[] {
  const matching = matchingVersionedGroup(mod.dependenciesByVersion ?? [], gameVersion);
  const dependencies = matching ? matching.dependencies : (mod.dependencies ?? []);
  return dependencies.filter((dependency) =>
    dependencyAppliesToGameVersion(dependency, gameVersion),
  );
}

export function missingDependencies(
  mod: Pick<Mod, "dependencies" | "dependenciesByVersion">,
  activePackageIds: readonly string[],
  gameVersion?: string,
): ModDependency[] {
  const active = new Set(activePackageIds.map(normalizePackageId));
  const missing = new Map<string, ModDependency>();
  for (const dependency of dependenciesForGameVersion(mod, gameVersion)) {
    const packageId = normalizePackageId(dependency.packageId);
    if (!active.has(packageId)) {
      missing.set(packageId, dependency);
    }
  }
  return [...missing.values()];
}

export function indexMissingDependencies(
  mods: readonly Mod[],
  activeModIds: ReadonlySet<string>,
  activePackageIds: readonly string[],
  gameVersion?: string,
): ReadonlyMap<string, readonly ModDependency[]> {
  const result = new Map<string, readonly ModDependency[]>();
  for (const mod of mods) {
    if (!activeModIds.has(mod.id)) {
      continue;
    }
    const missing = missingDependencies(mod, activePackageIds, gameVersion);
    if (missing.length) {
      result.set(mod.id, missing);
    }
  }
  return result;
}

/** Resolve a complete missing-dependency set against the unfiltered Library panel. */
export function resolveDependencyTargets(
  dependencies: readonly ModDependency[],
  libraryMods: readonly Mod[],
): Mod[] {
  const byPackageId = new Map<string, Map<string, Mod>>();
  for (const mod of libraryMods) {
    if (!mod.packageId) {
      continue;
    }
    const packageId = normalizePackageId(mod.packageId);
    const matches = byPackageId.get(packageId) ?? new Map<string, Mod>();
    matches.set(mod.id, mod);
    byPackageId.set(packageId, matches);
  }

  const resolved = new Map<string, Mod>();
  for (const dependency of dependencies) {
    const packageId = normalizePackageId(dependency.packageId);
    const candidates = [...(byPackageId.get(packageId)?.values() ?? [])];
    const trimmedLabel = dependency.displayName?.trim();
    const label = trimmedLabel?.length ? trimmedLabel : dependency.packageId;
    if (!candidates.length) {
      throw new Error(
        `${label} (${dependency.packageId}) is not available in Library. Sync or install it before fixing dependencies.`,
      );
    }
    if (candidates.length > 1) {
      throw new Error(
        `${label} (${dependency.packageId}) matches multiple Library mods. Activate the intended dependency manually.`,
      );
    }
    const candidate = candidates[0];
    if (candidate) {
      resolved.set(candidate.id, candidate);
    }
  }
  return [...resolved.values()];
}
