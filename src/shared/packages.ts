import { officialContentModId } from "./officialContent";
import type { InstalledModMetadata, Mod } from "./types";

export const rimWorldPackages = Object.freeze({
  core: "ludeon.rimworld",
  harmony: "brrainz.harmony",
});

export function normalizePackageId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/_steam$/, "");
}

/** Normalize case/whitespace while retaining RimWorld's physical-copy `_steam` marker. */
export function normalizePhysicalPackageId(value: string): string {
  return value.trim().toLowerCase();
}

export function isUsablePackageId(value?: string): value is string {
  const trimmed = value?.trim();
  if (!trimmed || !/^[a-z0-9_.-]+$/i.test(trimmed)) {
    return false;
  }
  const normalized = normalizePackageId(trimmed);
  return /[a-z0-9]/i.test(normalized) && !/^(unknown|steam\.\d+)$/i.test(normalized);
}

export function isOfficialMod(mod: Pick<Mod, "id" | "packageId" | "workshopId">) {
  const officialId = officialContentModId(mod.packageId);
  return !mod.workshopId && officialId !== undefined && mod.id === officialId;
}

export function installedModId(
  mod: Pick<InstalledModMetadata, "officialContent" | "packageId" | "localPath" | "workshopId">,
): string {
  if (mod.workshopId) {
    return `steam-${mod.workshopId}`;
  }
  const packageId = normalizePackageId(mod.packageId);
  const officialId = officialContentModId(packageId);
  if (officialId) {
    return mod.officialContent
      ? officialId
      : `installed-local:${packageId}:${encodeURIComponent(mod.localPath)}`;
  }
  return `active-package:${packageId}`;
}
