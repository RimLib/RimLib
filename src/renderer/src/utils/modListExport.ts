import { getOfficialContent } from "../../../shared/officialContent";
import { isUsablePackageId, normalizePackageId } from "../../../shared/packages";
import { isWorkshopMod } from "../../../shared/subscriptions";
import type { InstalledModMetadata, Mod } from "../../../shared/types";

/**
 * Encode projected Active rows using RimSort's XML convention. Package IDs are canonical
 * lowercase. `_steam` is emitted only when the selected Workshop row is present in the current
 * filesystem inventory alongside another real physical copy; saved/stale library records are not
 * physical duplicates.
 */
export function buildModListExportPackageIds(
  activeMods: readonly Mod[],
  installedMods: readonly Pick<InstalledModMetadata, "packageId" | "localPath" | "workshopId">[],
): string[] {
  const physicalCopiesByPackage = new Map<
    string,
    { identities: Set<string>; workshopIds: Set<string> }
  >();
  for (const mod of installedMods) {
    if (!isUsablePackageId(mod.packageId)) {
      continue;
    }
    const packageId = normalizePackageId(mod.packageId);
    const copies = physicalCopiesByPackage.get(packageId) ?? {
      identities: new Set<string>(),
      workshopIds: new Set<string>(),
    };
    const workshopId = mod.workshopId?.trim();
    const localPath = mod.localPath.trim();
    if (!localPath) {
      continue;
    }
    // RimSort's duplicate index is path-based. Keep that distinction even when the same
    // Workshop item exists in more than one Steam library, while collapsing repeated reads of
    // one folder.
    copies.identities.add(`path:${localPath}`);
    if (workshopId) {
      copies.workshopIds.add(workshopId);
    }
    physicalCopiesByPackage.set(packageId, copies);
  }

  return activeMods.map((mod) => {
    if (!isUsablePackageId(mod.packageId)) {
      throw new Error(`${mod.name} has no usable package ID and cannot be exported.`);
    }
    const packageId = normalizePackageId(mod.packageId);
    const officialContent = getOfficialContent(packageId);
    if (officialContent) {
      return officialContent.packageId;
    }
    const physicalCopies = physicalCopiesByPackage.get(packageId);
    const selectedWorkshopIsInstalled =
      isWorkshopMod(mod) && physicalCopies?.workshopIds.has(mod.workshopId ?? "");
    if (selectedWorkshopIsInstalled && (physicalCopies?.identities.size ?? 0) > 1) {
      return `${packageId}_steam`;
    }
    return packageId;
  });
}
