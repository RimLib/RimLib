import { modSources } from "../../../shared/domainConstants";
import { getOfficialContent, officialContentModId } from "../../../shared/officialContent";
import { installedModId, normalizePackageId } from "../../../shared/packages";
import { isWorkshopMod } from "../../../shared/subscriptions";
import type { ActiveModsState, InstalledModMetadata, Mod } from "../../../shared/types";
import { requireValue } from "../../../shared/validation";

function definedMetadata(installed: InstalledModMetadata) {
  return Object.fromEntries(
    Object.entries(installed).filter(
      ([key, value]) => key !== "officialContent" && value !== undefined,
    ),
  ) as Partial<Mod>;
}

function installedEntry(installed: InstalledModMetadata, saved?: Mod): Mod {
  return {
    name: installed.name ?? installed.packageId,
    author: installed.author ?? "Unknown author",
    summary: installed.summary ?? "Installed RimWorld package.",
    tags: [],
    gameVersions: [],
    screenshots: [],
    addedAt: "",
    downloadedAt: "",
    ...saved,
    ...definedMetadata(installed),
    // Filesystem discovery owns physical identity. Persisted metadata may be stale or malformed,
    // but must never turn a Workshop row into the canonical ID reserved for official content.
    id: installedModId(installed),
    source: installed.workshopId ? modSources.steam : modSources.local,
    workshopId: installed.workshopId,
    subscribed: installed.workshopId ? (saved?.subscribed ?? false) : false,
  };
}

function isTrustedOfficialMetadata(installed: InstalledModMetadata): boolean {
  return (
    installed.officialContent === true &&
    !installed.workshopId &&
    Boolean(getOfficialContent(installed.packageId))
  );
}

function activePlaceholder(packageId: string): Mod {
  const key = normalizePackageId(packageId);
  const official = getOfficialContent(key);
  return {
    id: officialContentModId(key) ?? `active-package:${key}`,
    packageId,
    name: official?.name ?? packageId,
    author: official ? "Ludeon Studios" : "Unknown author",
    source: modSources.local,
    subscribed: false,
    summary: official
      ? "Official RimWorld content. Installed metadata is not available locally."
      : "Active RimWorld package. Metadata is not available locally.",
    tags: [],
    gameVersions: [],
    screenshots: [],
    addedAt: "",
    downloadedAt: "",
  };
}

function comparePhysicalCopies(left: Mod, right: Mod, steamHint: boolean): number {
  const workshopDifference = steamHint
    ? Number(!isWorkshopMod(left)) - Number(!isWorkshopMod(right))
    : Number(isWorkshopMod(left)) - Number(isWorkshopMod(right));
  if (workshopDifference) {
    return workshopDifference;
  }
  const installedDifference = Number(!left.localPath) - Number(!right.localPath);
  if (installedDifference) {
    return installedDifference;
  }
  const subscriptionDifference = Number(!left.subscribed) - Number(!right.subscribed);
  return subscriptionDifference || left.id.localeCompare(right.id);
}

/**
 * Builds the complete local mod universe and resolves the exact ModsConfig order to display rows.
 * Installed metadata is deliberately not limited to active packages: disabled local mods and DLCs
 * belong in the inactive panel too.
 */
export function buildModViews(active: ActiveModsState, mods: Mod[]) {
  const savedByWorkshop = new Map(
    mods.filter((mod) => mod.workshopId).map((mod) => [requireValue(mod.workshopId), mod]),
  );
  const savedByPath = new Map(
    mods.filter((mod) => mod.localPath).map((mod) => [requireValue(mod.localPath), mod]),
  );
  const savedByPackage = new Map<string, Mod[]>();
  const savedLocalByPackage = new Map<string, Mod[]>();
  for (const mod of mods) {
    if (!mod.packageId) {
      continue;
    }
    const key = normalizePackageId(mod.packageId);
    savedByPackage.set(key, [...(savedByPackage.get(key) ?? []), mod]);
    if (!mod.workshopId && mod.source !== modSources.steam) {
      savedLocalByPackage.set(key, [...(savedLocalByPackage.get(key) ?? []), mod]);
    }
  }

  const usedSavedIds = new Set<string>();
  const installedByPackage = new Map<string, { entry: Mod; trustedOfficialContent: boolean }[]>();
  const allById = new Map<string, Mod>();
  for (const installed of active.installedMods ?? []) {
    const saved = getOfficialContent(installed.packageId)
      ? undefined
      : installed.workshopId
        ? savedByWorkshop.get(installed.workshopId)
        : (savedByPath.get(installed.localPath) ??
          [...(savedLocalByPackage.get(normalizePackageId(installed.packageId)) ?? [])].sort(
            (left, right) => comparePhysicalCopies(left, right, false),
          )[0]);
    if (saved) {
      usedSavedIds.add(saved.id);
    }
    const entry = installedEntry(installed, saved);
    allById.set(entry.id, entry);
    const key = normalizePackageId(installed.packageId);
    installedByPackage.set(key, [
      ...(installedByPackage.get(key) ?? []),
      { entry, trustedOfficialContent: isTrustedOfficialMetadata(installed) },
    ]);
  }
  for (const mod of mods) {
    if (!usedSavedIds.has(mod.id) && !allById.has(mod.id)) {
      allById.set(mod.id, mod);
    }
  }

  const activeEntries = active.packageIds.map((packageId) => {
    const key = normalizePackageId(packageId);
    const official = getOfficialContent(key);
    const steamHint = /_steam$/i.test(packageId.trim());
    const installed = [...(installedByPackage.get(key) ?? [])]
      .filter((candidate) => !official || candidate.trustedOfficialContent)
      .sort((first, second) =>
        comparePhysicalCopies(first.entry, second.entry, steamHint),
      )[0]?.entry;
    const saved = official
      ? undefined
      : [...(savedByPackage.get(key) ?? [])].sort((left, right) =>
          comparePhysicalCopies(left, right, steamHint),
        )[0];
    const entry = installed ?? saved ?? activePlaceholder(packageId);
    if (official) {
      // A persisted row is untrusted input and may collide with the canonical official ID.
      // The scanner-approved/placeholder official row always owns that identity.
      allById.set(entry.id, entry);
    } else if (!allById.has(entry.id)) {
      allById.set(entry.id, entry);
    }
    return entry;
  });

  return { allEntries: [...allById.values()], activeEntries };
}

export function buildActiveMods(active: ActiveModsState, mods: Mod[]) {
  return { entries: buildModViews(active, mods).activeEntries };
}
