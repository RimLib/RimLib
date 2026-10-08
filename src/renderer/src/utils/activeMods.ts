import { modSources } from "../../../shared/domainConstants";
import { normalizePackageId } from "../../../shared/packages";
import type { ActiveModsState, Mod } from "../../../shared/types";
import { requireValue } from "../../../shared/validation";

export function buildActiveMods(active: ActiveModsState, mods: Mod[]) {
  const byWorkshop = new Map(
    mods.filter((mod) => mod.workshopId).map((mod) => [requireValue(mod.workshopId), mod]),
  );
  const byPath = new Map(
    mods.filter((mod) => mod.localPath).map((mod) => [requireValue(mod.localPath), mod]),
  );
  const installedByPackage = new Map<
    string,
    NonNullable<ActiveModsState["installedMods"]>[number]
  >();
  for (const installed of active.installedMods ?? []) {
    const key = normalizePackageId(installed.packageId);
    const previous = installedByPackage.get(key);
    if (
      !previous ||
      (!byWorkshop.get(previous.workshopId ?? "")?.subscribed &&
        byWorkshop.get(installed.workshopId ?? "")?.subscribed)
    ) {
      installedByPackage.set(key, installed);
    }
  }
  const savedByPackage = new Map<string, Mod>();
  for (const mod of mods) {
    if (!mod.packageId) {
      continue;
    }
    const id = normalizePackageId(mod.packageId);
    const previous = savedByPackage.get(id);
    if (!previous || (!previous.subscribed && mod.subscribed)) {
      savedByPackage.set(id, mod);
    }
  }
  const entries: Mod[] = active.packageIds.map((packageId) => {
    const key = normalizePackageId(packageId);
    const installed = installedByPackage.get(key);
    if (installed) {
      const metadata = Object.fromEntries(
        Object.entries(installed).filter(([, value]) => value !== undefined),
      );
      const saved = installed.workshopId
        ? byWorkshop.get(installed.workshopId)
        : byPath.get(installed.localPath);
      if (saved) {
        return { ...saved, ...metadata };
      }
      return {
        id: installed.workshopId ? `steam-${installed.workshopId}` : `active-package:${key}`,
        name: installed.name ?? packageId,
        author: installed.author ?? "Unknown author",
        source: installed.workshopId ? modSources.steam : modSources.local,
        subscribed: false,
        summary: installed.summary ?? "Active RimWorld package.",
        tags: [],
        gameVersions: [],
        screenshots: [],
        addedAt: "",
        downloadedAt: "",
        ...metadata,
      };
    }
    const saved = savedByPackage.get(key);
    if (saved) {
      return saved;
    }
    return {
      id: `active-package:${key}`,
      packageId,
      name: packageId,
      author: "Unknown author",
      source: modSources.local,
      subscribed: false,
      summary: "Active RimWorld package. Metadata is not available in the saved library.",
      tags: [],
      gameVersions: [],
      screenshots: [],
      addedAt: "",
      downloadedAt: "",
    };
  });
  return { entries };
}
