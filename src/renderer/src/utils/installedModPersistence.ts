import { modSources, subscriptionCommands } from "../../../shared/domainConstants";
import { getOfficialContent } from "../../../shared/officialContent";
import {
  installedModId,
  isOfficialMod,
  isUsablePackageId,
  normalizePackageId,
} from "../../../shared/packages";
import { createSteamWorkshopUrl } from "../../../shared/steam";
import type { InstalledModMetadata, Mod, ModVault } from "../../../shared/types";
import { effectiveSubscribedIds } from "../../../shared/vault";

const workshopIdPattern = /^[1-9]\d*$/;

const scannerMetadataKeys = [
  "name",
  "author",
  "summary",
  "dependencies",
  "dependenciesByVersion",
  "loadAfter",
  "loadAfterByVersion",
  "forceLoadAfter",
  "loadBefore",
  "loadBeforeByVersion",
  "forceLoadBefore",
  "gameVersions",
] as const satisfies readonly (keyof InstalledModMetadata)[];

interface InstalledObservation {
  installed: InstalledModMetadata;
  packageKey: string;
  targetId: string;
}

function validTimestamp(value: string | undefined): value is string {
  return value !== undefined && Number.isFinite(Date.parse(value));
}

function sameMetadataValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameMetadataValue(value, right[index]))
    );
  }
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(rightRecord, key) &&
        sameMetadataValue(leftRecord[key], rightRecord[key]),
    )
  );
}

function scannerPatch(
  installed: InstalledModMetadata,
  id: string,
  subscribed: boolean,
): Partial<Mod> {
  const patch: Partial<Mod> = {
    id,
    packageId: installed.packageId,
    localPath: installed.localPath,
    source: installed.workshopId ? modSources.steam : modSources.local,
    workshopId: installed.workshopId,
    subscribed,
  };
  if (validTimestamp(installed.downloadedAt)) {
    patch.downloadedAt = installed.downloadedAt;
  }
  for (const key of scannerMetadataKeys) {
    const value = installed[key];
    if (value !== undefined) {
      Object.assign(patch, { [key]: value });
    }
  }
  return patch;
}

function mergeInstalledMetadata(
  saved: Mod,
  installed: InstalledModMetadata,
  id: string,
  subscribed: boolean,
): Mod {
  const patch = scannerPatch(installed, id, subscribed);
  const candidate = { ...saved, ...patch };
  const keys = Object.keys(patch) as (keyof Mod)[];
  return keys.every((key) => sameMetadataValue(saved[key], candidate[key])) ? saved : candidate;
}

function newInstalledMod(
  observation: InstalledObservation,
  observedAt: string,
  subscribed: boolean,
): Mod {
  const { installed, targetId } = observation;
  const workshopId = installed.workshopId;
  const mod: Mod = {
    id: targetId,
    packageId: installed.packageId,
    name: installed.name ?? installed.packageId,
    author: installed.author ?? "Unknown author",
    source: workshopId ? modSources.steam : modSources.local,
    summary: installed.summary ?? "Installed RimWorld package.",
    tags: [],
    userTagIds: [],
    gameVersions: installed.gameVersions ?? [],
    screenshots: [],
    subscribed,
    downloadedAt: validTimestamp(installed.downloadedAt) ? installed.downloadedAt : "",
    addedAt: observedAt,
    localPath: installed.localPath,
    ...(workshopId ? { workshopId, url: createSteamWorkshopUrl(workshopId) } : {}),
  };
  return { ...mod, ...scannerPatch(installed, targetId, subscribed) };
}

function addIndex(index: Map<string, number[]>, key: string | undefined, position: number) {
  if (key === undefined) {
    return;
  }
  index.set(key, [...(index.get(key) ?? []), position]);
}

function uniqueEligibleIndex(
  positions: readonly number[] | undefined,
  mods: readonly Mod[],
  used: ReadonlySet<number>,
): number | undefined {
  const eligible =
    positions?.filter((position) => {
      const mod = mods[position];
      return !used.has(position) && mod !== undefined && !isOfficialMod(mod);
    }) ?? [];
  return eligible.length === 1 ? eligible[0] : undefined;
}

function collectObservations(installedMods: readonly InstalledModMetadata[]) {
  const observations = installedMods.flatMap((installed): InstalledObservation[] => {
    if (
      !isUsablePackageId(installed.packageId) ||
      !installed.localPath ||
      (installed.workshopId !== undefined && !workshopIdPattern.test(installed.workshopId)) ||
      (installed.officialContent === true &&
        installed.workshopId === undefined &&
        getOfficialContent(installed.packageId) !== undefined)
    ) {
      return [];
    }
    return [
      {
        installed,
        packageKey: normalizePackageId(installed.packageId),
        targetId: installedModId(installed),
      },
    ];
  });
  const workshopCounts = new Map<string, number>();
  const localPathCounts = new Map<string, number>();
  const localPackagePaths = new Map<string, Set<string>>();
  for (const observation of observations) {
    const { installed, packageKey } = observation;
    if (installed.workshopId) {
      workshopCounts.set(installed.workshopId, (workshopCounts.get(installed.workshopId) ?? 0) + 1);
    } else {
      localPathCounts.set(installed.localPath, (localPathCounts.get(installed.localPath) ?? 0) + 1);
      const paths = localPackagePaths.get(packageKey) ?? new Set<string>();
      paths.add(installed.localPath);
      localPackagePaths.set(packageKey, paths);
    }
  }
  return {
    observations: observations.filter(({ installed }) =>
      installed.workshopId
        ? workshopCounts.get(installed.workshopId) === 1
        : localPathCounts.get(installed.localPath) === 1,
    ),
    ambiguousLocalPackages: new Set(
      [...localPackagePaths].flatMap(([packageId, paths]) => (paths.size > 1 ? [packageId] : [])),
    ),
  };
}

/**
 * Persists the last complete filesystem observation without treating absence as deletion.
 * Scanner-owned About.xml and device fields are refreshed; personal and Steam-enriched metadata
 * remains owned by the vault. Ambiguous local copies are updated only through an exact path match.
 */
export function reconcileInstalledModMetadata(
  vault: ModVault,
  installedMods: readonly InstalledModMetadata[],
  observedAt: string,
): ModVault {
  if (!validTimestamp(observedAt)) {
    throw new Error("Installed mod observation time is invalid.");
  }
  const { observations, ambiguousLocalPackages } = collectObservations(installedMods);
  if (!observations.length) {
    return vault;
  }

  const nextMods = [...vault.mods];
  const byWorkshopId = new Map<string, number[]>();
  const byLocalPath = new Map<string, number[]>();
  const idOwners = new Map<string, number>();
  vault.mods.forEach((mod, index) => {
    addIndex(byWorkshopId, mod.workshopId, index);
    addIndex(byLocalPath, mod.localPath, index);
    idOwners.set(mod.id, index);
  });
  const subscribedIds = effectiveSubscribedIds(vault.localSteamState);
  const usedSavedRows = new Set<number>();
  let changed = false;

  for (const observation of observations) {
    const { installed, packageKey, targetId } = observation;
    const workshopMatches = installed.workshopId
      ? byWorkshopId.get(installed.workshopId)
      : undefined;
    // A duplicated saved Workshop identity is ambiguous. Do not fall back to its path and risk
    // updating a different personal record.
    const savedIndex = installed.workshopId
      ? workshopMatches?.length
        ? uniqueEligibleIndex(workshopMatches, nextMods, usedSavedRows)
        : uniqueEligibleIndex(byLocalPath.get(installed.localPath), nextMods, usedSavedRows)
      : uniqueEligibleIndex(byLocalPath.get(installed.localPath), nextMods, usedSavedRows);
    const subscribed = installed.workshopId ? subscribedIds.has(installed.workshopId) : false;

    if (savedIndex !== undefined) {
      const saved = nextMods[savedIndex];
      if (saved === undefined) {
        continue;
      }
      const keepExistingId =
        (!installed.workshopId && ambiguousLocalPackages.has(packageKey)) ||
        (idOwners.has(targetId) && idOwners.get(targetId) !== savedIndex);
      const nextId = keepExistingId ? saved.id : targetId;
      const next = mergeInstalledMetadata(saved, installed, nextId, subscribed);
      usedSavedRows.add(savedIndex);
      if (next !== saved) {
        if (nextId !== saved.id) {
          idOwners.delete(saved.id);
          idOwners.set(nextId, savedIndex);
        }
        nextMods[savedIndex] = next;
        changed = true;
      }
      continue;
    }

    // The current model gives ordinary local packages one canonical row ID. When multiple
    // physical copies share that package ID, persisting an arbitrary one would merge paths on the
    // next scan. Exact-path matches above remain safe; unmatched ambiguous copies stay transient.
    // A confirmed unsubscribe can also leave its folder behind temporarily. Its pending override
    // keeps an explicitly deleted library row suppressed until folder discovery catches up.
    if (
      (!installed.workshopId && ambiguousLocalPackages.has(packageKey)) ||
      (installed.workshopId &&
        vault.localSteamState.pending[installed.workshopId] === subscriptionCommands.unsubscribe) ||
      idOwners.has(targetId)
    ) {
      continue;
    }
    const position = nextMods.length;
    nextMods.push(newInstalledMod(observation, observedAt, subscribed));
    idOwners.set(targetId, position);
    changed = true;
  }

  return changed ? { ...vault, mods: nextMods } : vault;
}
