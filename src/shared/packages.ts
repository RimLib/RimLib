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

export function isUsablePackageId(value?: string): value is string {
  return Boolean(
    value && /^[a-z0-9_.-]+$/i.test(value.trim()) && !/^(unknown|steam\.\d+)$/i.test(value.trim()),
  );
}

export function isOfficialMod(mod: Pick<Mod, "packageId" | "workshopId">) {
  return Boolean(
    !mod.workshopId &&
    mod.packageId &&
    /^ludeon\.rimworld(?:\.|$)/.test(normalizePackageId(mod.packageId)),
  );
}
import type { Mod } from "./types";
