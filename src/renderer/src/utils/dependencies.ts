import { normalizePackageId } from "../../../shared/packages";
import type { Mod, ModDependency } from "../../../shared/types";

export function dependencyAppliesToGameVersion(
  dependency: ModDependency,
  gameVersion?: string,
): boolean {
  return (
    !dependency.gameVersions?.length ||
    Boolean(gameVersion && dependency.gameVersions.includes(gameVersion))
  );
}

export function missingDependencies(
  mod: Pick<Mod, "dependencies">,
  activePackageIds: readonly string[],
  gameVersion?: string,
): ModDependency[] {
  const active = new Set(activePackageIds.map(normalizePackageId));
  const missing = new Map<string, ModDependency>();
  for (const dependency of mod.dependencies ?? []) {
    if (!dependencyAppliesToGameVersion(dependency, gameVersion)) {
      continue;
    }
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
