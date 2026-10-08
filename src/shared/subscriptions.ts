import { modActivities, modSources } from "./domainConstants";
import { isUsablePackageId, normalizePackageId } from "./packages";
import { createSteamWorkshopUrl } from "./steam";
import type { ActiveModsState, Mod, ModActivity } from "./types";

export function isWorkshopMod(mod: Pick<Mod, "workshopId">) {
  return Boolean(mod.workshopId && /^\d+$/.test(mod.workshopId));
}

export function createActivityLookup(active: ActiveModsState) {
  const packages = new Set(active.packageIds.map(normalizePackageId));
  const installed =
    active.installedMods?.filter((mod) => packages.has(normalizePackageId(mod.packageId))) ?? [];
  const workshop = new Set(installed.flatMap((mod) => (mod.workshopId ? [mod.workshopId] : [])));
  const installedPackages = new Set(installed.map((mod) => normalizePackageId(mod.packageId)));
  return (mod: Pick<Mod, "workshopId" | "packageId">): ModActivity => {
    if (active.error) {
      return modActivities.unknown;
    }
    if (mod.workshopId && workshop.has(mod.workshopId)) {
      return modActivities.active;
    }
    if (!isUsablePackageId(mod.packageId)) {
      return modActivities.unknown;
    }
    // Stale saved packages can belong to a dependency or another Workshop item.
    if (mod.workshopId && installedPackages.has(normalizePackageId(mod.packageId))) {
      return modActivities.inactive;
    }
    return packages.has(normalizePackageId(mod.packageId))
      ? modActivities.active
      : modActivities.inactive;
  };
}

export function getModActivity(
  mod: Pick<Mod, "workshopId" | "packageId">,
  active: ActiveModsState,
) {
  return createActivityLookup(active)(mod);
}

export function workshopPlaceholder(id: string): Mod {
  return {
    id: `steam-${id}`,
    workshopId: id,
    name: `Workshop item ${id}`,
    author: "Unknown author",
    source: modSources.steam,
    summary: "",
    tags: [],
    userTagIds: [],
    gameVersions: [],
    screenshots: [],
    downloadedAt: "",
    addedAt: "",
    subscribed: true,
    url: createSteamWorkshopUrl(id),
  };
}
