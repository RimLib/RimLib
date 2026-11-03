export const officialContentImageScheme = "rimlib-official-image";

export const rimWorldOfficialContent = Object.freeze([
  Object.freeze({
    packageId: "ludeon.rimworld",
    name: "RimWorld",
    folderName: "Core",
    steamAppId: 294100,
    kind: "core",
  }),
  Object.freeze({
    packageId: "ludeon.rimworld.royalty",
    name: "RimWorld - Royalty",
    folderName: "Royalty",
    steamAppId: 1149640,
    kind: "dlc",
  }),
  Object.freeze({
    packageId: "ludeon.rimworld.ideology",
    name: "RimWorld - Ideology",
    folderName: "Ideology",
    steamAppId: 1392840,
    kind: "dlc",
  }),
  Object.freeze({
    packageId: "ludeon.rimworld.biotech",
    name: "RimWorld - Biotech",
    folderName: "Biotech",
    steamAppId: 1826140,
    kind: "dlc",
  }),
  Object.freeze({
    packageId: "ludeon.rimworld.anomaly",
    name: "RimWorld - Anomaly",
    folderName: "Anomaly",
    steamAppId: 2380740,
    kind: "dlc",
  }),
  Object.freeze({
    packageId: "ludeon.rimworld.odyssey",
    name: "RimWorld - Odyssey",
    folderName: "Odyssey",
    steamAppId: 3022790,
    kind: "dlc",
  }),
]);

export type RimWorldOfficialContent = (typeof rimWorldOfficialContent)[number];
export type RimWorldOfficialPackageId = RimWorldOfficialContent["packageId"];

const byPackageId = new Map<RimWorldOfficialPackageId, RimWorldOfficialContent>(
  rimWorldOfficialContent.map((content) => [content.packageId, content]),
);

const packageIdByImageUrl = new Map(
  rimWorldOfficialContent.map((content) => [
    `${officialContentImageScheme}://preview/${content.packageId}`,
    content.packageId,
  ]),
);

function normalizedPackageId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/_steam$/, "");
}

export function getOfficialContent(packageId?: string): RimWorldOfficialContent | undefined {
  if (!packageId) {
    return undefined;
  }
  return byPackageId.get(normalizedPackageId(packageId) as RimWorldOfficialPackageId);
}

export function officialContentImageUrl(packageId: RimWorldOfficialPackageId): string;
export function officialContentImageUrl(packageId: string): string | undefined;
export function officialContentImageUrl(packageId: string): string | undefined {
  const content = getOfficialContent(packageId);
  return content ? `${officialContentImageScheme}://preview/${content.packageId}` : undefined;
}

export function officialContentModId(packageId?: string): string | undefined {
  const content = getOfficialContent(packageId);
  return content ? `active-package:${content.packageId}` : undefined;
}

/** Accept only one of the six canonical URLs generated from the official-content registry. */
export function officialPackageIdFromImageUrl(
  value?: string,
): RimWorldOfficialPackageId | undefined {
  return value ? packageIdByImageUrl.get(value) : undefined;
}
