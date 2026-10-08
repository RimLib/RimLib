import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import fc from "fast-check";

import { modSources, steamStatusSources } from "../../src/shared/domainConstants";
import { createSteamWorkshopUrl } from "../../src/shared/steam";
import type { ModVault, SteamImportResult } from "../../src/shared/types";
import { vaultSchemaVersion } from "../../src/shared/vaultValidation";

const generatorLimits = Object.freeze({ mods: 12, tags: 6, text: 60, sequence: 40 });
export const sequenceLimit = generatorLimits.sequence;

function integerEnvironment(name: string, minimum: number, maximum: number) {
  const raw = process.env[name];
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  if (!raw.trim() || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

const seed = integerEnvironment("FC_SEED", -(2 ** 31), 2 ** 31 - 1);
const numRuns = integerEnvironment("FC_NUM_RUNS", 1, 100_000);
const path = process.env.FC_PATH;
if (path !== undefined && seed === undefined) {
  throw new Error("FC_PATH requires FC_SEED.");
}
const replay = { ...(seed === undefined ? {} : { seed }), ...(path === undefined ? {} : { path }) };
export const propertyOptions = { numRuns: numRuns ?? 200, ...replay };
export const filesystemPropertyOptions = { numRuns: numRuns ?? 25, ...replay };

export const textArbitrary = fc.oneof(
  fc.string({ maxLength: generatorLimits.text }),
  fc.constantFrom("", " ", "\t\n", "\u00e9\u00e8", "\u4e2d\u6587", "\ud83d\ude80", "__proto__"),
);
export const extensionArbitrary = fc.jsonValue({ maxDepth: 2 }).map((value) => {
  // Generate persisted JSON values, including JSON's canonical representation of -0.
  const persisted: unknown = JSON.parse(JSON.stringify(value));
  return persisted;
});
export const workshopIdArbitrary = fc.bigInt({ min: 1n, max: 10n ** 20n - 1n }).map(String);
export const colorArbitrary = fc
  .integer({ min: 0, max: 0xffffff })
  .map((value) => `#${value.toString(16).padStart(6, "0")}`);
const dateArbitrary = fc.oneof(
  fc
    .integer({ min: 0, max: 2_000_000_000 })
    .map((seconds) => new Date(seconds * 1000).toISOString()),
  fc.constantFrom("", "not-a-date"),
);

export const modArbitrary = fc
  .record({
    identity: fc.uuid(),
    workshopId: fc.option(workshopIdArbitrary, { nil: undefined }),
    name: textArbitrary,
    author: textArbitrary,
    summary: textArbitrary,
    notes: fc.option(textArbitrary, { nil: undefined }),
    subscribed: fc.boolean(),
    downloadedAt: dateArbitrary,
    addedAt: dateArbitrary,
    tags: fc.array(textArbitrary, { maxLength: generatorLimits.tags }),
    gameVersions: fc.array(fc.constantFrom("1.4", "1.5", "1.6"), { maxLength: 3 }),
    screenshots: fc.array(textArbitrary, { maxLength: 4 }),
    futureData: extensionArbitrary,
  })
  .map(({ identity, workshopId, ...metadata }) => {
    const userTagIds: string[] = [];
    return {
      ...metadata,
      subscribed: Boolean(workshopId && metadata.subscribed),
      id: workshopId ? `steam-${workshopId}` : `local-${identity}`,
      workshopId,
      packageId: `test.mod-${workshopId ?? identity}`,
      source: workshopId ? modSources.steam : modSources.local,
      url: workshopId ? createSteamWorkshopUrl(workshopId) : undefined,
      userTagIds,
    };
  });

export const modsArbitrary = fc.uniqueArray(modArbitrary, {
  selector: (mod) => mod.id,
  maxLength: generatorLimits.mods,
});
export const workshopModsArbitrary = fc.uniqueArray(
  fc.tuple(modArbitrary, workshopIdArbitrary).map(([mod, workshopId]) => ({
    ...mod,
    id: `steam-${workshopId}`,
    workshopId,
    packageId: `test.mod-${workshopId}`,
    source: modSources.steam,
    url: createSteamWorkshopUrl(workshopId),
  })),
  { selector: (mod) => mod.id, maxLength: generatorLimits.mods },
);
export const tagsArbitrary = fc.uniqueArray(
  fc.record({
    id: fc.uuid(),
    name: textArbitrary.map((name) => `Tag ${name}`),
    color: colorArbitrary,
    futureData: extensionArbitrary,
  }),
  { selector: (tag) => tag.id, maxLength: generatorLimits.tags },
);

export const vaultArbitrary = fc
  .record({
    mods: modsArbitrary,
    userTags: tagsArbitrary,
    assignments: fc.array(fc.nat({ max: 63 }), { maxLength: generatorLimits.mods }),
    futureData: extensionArbitrary,
  })
  .map(({ mods: rawMods, userTags, assignments, futureData }) => {
    const mods = rawMods.map((mod, modIndex) => ({
      ...mod,
      userTagIds: userTags
        .filter((_, tagIndex) => ((assignments[modIndex] ?? 0) & (1 << tagIndex)) !== 0)
        .map((tag) => tag.id),
    }));

    const vault = {
      schemaVersion: vaultSchemaVersion,
      revision: "property-revision",
      futureData,
      settings: { workshopModsPath: "/virtual/workshop", futureData },
      mods,
      userTags,
      localSteamState: {
        source: steamStatusSources.workshopFolders,
        observedIds: mods.flatMap((mod) =>
          mod.subscribed && mod.workshopId ? [mod.workshopId] : [],
        ),
        pending: {},
      },
    };
    return vault satisfies ModVault;
  });

export function steamImport(
  mods: SteamImportResult["mods"],
  subscribedIds: string[],
): SteamImportResult {
  return {
    mods,
    subscribedIds,
    discoveredIds: [],
    manifestPaths: [],
    missingMetadataIds: [],
    steamLibraryPaths: [],
    warnings: [],
  };
}

function preservePrototypes(original: unknown, copy: unknown): void {
  if (
    typeof original !== "object" ||
    original === null ||
    typeof copy !== "object" ||
    copy === null
  ) {
    return;
  }
  Object.setPrototypeOf(copy, Object.getPrototypeOf(original) as object | null);
  for (const key of Object.keys(original)) {
    preservePrototypes(Reflect.get(original, key), Reflect.get(copy, key));
  }
}

export function assertUnchanged(value: unknown, operation: () => void) {
  const before = structuredClone(value);
  // structuredClone normalizes null prototypes generated by fast-check's records.
  preservePrototypes(value, before);
  operation();
  assert.deepEqual(value, before);
}

export async function temporaryVault(run: (path: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "rimlib-property-"));
  try {
    await run(join(directory, "vault.json"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
