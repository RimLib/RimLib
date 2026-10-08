import { modSources, steamStatusSources } from "../../src/shared/domainConstants";
import { createSteamWorkshopUrl } from "../../src/shared/steam";
import type { Mod, ModVault } from "../../src/shared/types";
import { vaultSchemaVersion } from "../../src/shared/vaultValidation";

export const sampleMods = Object.freeze({
  camera: { id: "101", name: "Camera+", author: "Aria", packageId: "example.camera" },
  weapons: { id: "102", name: "Guns Galore - Core", author: "Blake", packageId: "example.guns" },
  colonists: {
    id: "103",
    name: "Voice Acted Colonists",
    author: "Casey",
    packageId: "example.voice",
  },
  tribal: { id: "104", name: "Tribal Tools", author: "Drew", packageId: "example.tribal" },
  harmony: { id: "201", name: "Harmony", author: "Andreas", packageId: "brrainz.harmony" },
  active: { id: "202", name: "Zeta Active", author: "Erin", packageId: "example.active" },
  spare: { id: "203", name: "Spare Workshop Mod", author: "Finley", packageId: "example.spare" },
  other: { id: "204", name: "Other Workshop Mod", author: "Gray", packageId: "example.other" },
});
export const sampleTags = Object.freeze({
  qol: { id: "tag-qol", name: "Quality of Life", color: "#ffffff" },
  combat: { id: "tag-combat", name: "Combat", color: "#112233" },
});
export const initialSubscribedIds = ["202", "204", "201", "203"];
export const initialActivePackages = [
  "brrainz.harmony",
  "ludeon.rimworld",
  "example.active",
  "example.camera",
];

export function sampleMod(
  item: (typeof sampleMods)[keyof typeof sampleMods],
  index: number,
  subscribed: boolean,
): Mod {
  const dependencies =
    item.id === sampleMods.active.id
      ? [{ packageId: "example.framework", displayName: "Example Framework" }]
      : undefined;
  return {
    ...item,
    id: `steam-${item.id}`,
    workshopId: item.id,
    source: modSources.steam,
    url: createSteamWorkshopUrl(item.id),
    summary: `Saved description for ${item.name}${index === 0 ? ` https://example.invalid/${"long".repeat(150)}` : ""}`,
    dependencies,
    tags: ["Steam"],
    userTagIds:
      index === 0 || index === 4 ? [sampleTags.qol.id] : index % 2 ? [sampleTags.combat.id] : [],
    subscribed,
    downloadedAt: `2026-09-${String(28 - index).padStart(2, "0")}T12:00:00.000Z`,
    addedAt: "2026-08-01T12:00:00.000Z",
    gameVersions: ["1.5"],
    thumbnail: "https://e2e.invalid/broken.png",
    screenshots: ["https://e2e.invalid/broken.png"],
    notes: `Personal notes for ${item.name}`,
  };
}

export function sampleVault(config: string, workshop: string): ModVault {
  return {
    schemaVersion: vaultSchemaVersion,
    revision: "e2e-initial-revision",
    mods: Object.values(sampleMods).map((item, index) =>
      sampleMod(item, index, initialSubscribedIds.includes(item.id)),
    ),

    userTags: Object.values(sampleTags),
    localSteamState: {
      source: steamStatusSources.workshopFolders,
      observedIds: [...initialSubscribedIds],
      pending: {},
    },
    settings: { rimWorldConfigPath: config, workshopModsPath: workshop },
  };
}

export function configXml(packages = initialActivePackages): string {
  return `<?xml version="1.0"?><ModsConfigData><version>1.6</version><activeMods>${packages.map((id) => `<li>${id}</li>`).join("")}</activeMods><knownExpansions /></ModsConfigData>`;
}

export function aboutXml(mod: Mod): string {
  const dependencies = mod.dependencies?.length
    ? `<modDependencies>${mod.dependencies.map((dependency) => `<li><packageId>${dependency.packageId}</packageId><displayName>${dependency.displayName ?? dependency.packageId}</displayName></li>`).join("")}</modDependencies>`
    : "";
  return `<ModMetaData><name>${mod.name}</name><author>${mod.author}</author><packageId>${mod.packageId ?? ""}</packageId><description>${mod.summary}</description>${dependencies}<supportedVersions><li>1.6</li></supportedVersions></ModMetaData>`;
}
