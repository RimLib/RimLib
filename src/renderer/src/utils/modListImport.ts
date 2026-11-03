import { modSources } from "../../../shared/domainConstants";
import { modListLimits } from "../../../shared/limits";
import { getOfficialContent } from "../../../shared/officialContent";
import {
  isOfficialMod,
  isUsablePackageId,
  normalizePackageId,
  rimWorldPackages,
} from "../../../shared/packages";
import { isWorkshopMod } from "../../../shared/subscriptions";
import type { Mod } from "../../../shared/types";
import { normalizedGameVersion } from "./gameVersions";

const maximumFileNameLength = 255;

export interface ImportedModListFile {
  fileName: string;
  gameVersion?: string;
  packageIds: readonly string[];
  knownExpansions: readonly string[];
}

export const importChoiceReasons = Object.freeze({
  steamHint: "steam-hint",
  nonSteamHint: "non-steam-hint",
  currentActive: "current-active",
  sourcePriority: "source-priority",
} as const);

export type ImportChoiceReason = (typeof importChoiceReasons)[keyof typeof importChoiceReasons];

export interface ModListImportDuplicateChoice {
  /** Package ID exactly as it appeared in the imported file, with surrounding space removed. */
  packageId: string;
  normalizedPackageId: string;
  selected: Mod;
  candidates: readonly Mod[];
  reason: ImportChoiceReason;
}

export interface ModListVersionMismatch {
  importedVersion: string;
  currentVersion: string;
  importedComparableVersion: string;
  currentComparableVersion: string;
}

interface ModListImportModSnapshot {
  id: string;
  packageId?: string;
  workshopId?: string;
  source: Mod["source"];
  subscribed: boolean;
  localPath?: string;
}

export interface ModListImportPlan {
  file: ImportedModListFile;
  /** Exact ordered baseline reviewed in the modal; used to reject stale confirmation. */
  currentActiveSnapshot: readonly ModListImportModSnapshot[];
  /** Resolved rows in the exact order requested by the imported file. */
  targetMods: readonly Mod[];
  /** Imported package IDs that resolved, in file order and with their original casing. */
  availablePackageIds: readonly string[];
  /** Imported package IDs with no known row, in file order and with their original casing. */
  missingPackageIds: readonly string[];
  /** Exact physical rows that would enter or leave Active, including duplicate-package swaps. */
  activatedMods: readonly Mod[];
  deactivatedMods: readonly Mod[];
  duplicateChoices: readonly ModListImportDuplicateChoice[];
  versionMismatch?: ModListVersionMismatch;
}

function snapshotMod(mod: Mod): ModListImportModSnapshot {
  return {
    id: mod.id,
    packageId: mod.packageId,
    workshopId: mod.workshopId,
    source: mod.source,
    subscribed: mod.subscribed,
    localPath: mod.localPath,
  };
}

/** Stable snapshot of every reviewed choice that can affect the staged draft. */
export function modListImportPlanKey(plan: ModListImportPlan): string {
  return JSON.stringify({
    currentActive: plan.currentActiveSnapshot,
    target: plan.targetMods.map(snapshotMod),
    missing: plan.missingPackageIds,
    activated: plan.activatedMods.map(snapshotMod),
    deactivated: plan.deactivatedMods.map(snapshotMod),
    duplicateChoices: plan.duplicateChoices.map((choice) => [
      choice.normalizedPackageId,
      snapshotMod(choice.selected),
      choice.reason,
      choice.candidates.map(snapshotMod),
    ]),
    versionMismatch: plan.versionMismatch,
  });
}

export class InvalidModListImportError extends Error {
  override readonly name = "InvalidModListImportError";
}

export function modListImportBaselineError(packageIds: readonly string[]): string | undefined {
  if (packageIds.some((packageId) => !isUsablePackageId(packageId))) {
    return "RimWorld's active mod list contains an invalid package ID. Fix it before importing a mod list.";
  }
  const normalized = packageIds.map(normalizePackageId);
  if (new Set(normalized).size !== normalized.length) {
    return "RimWorld's active mod list contains duplicate package IDs. Fix them before importing a mod list.";
  }
  return undefined;
}

function invalidImport(message: string): never {
  throw new InvalidModListImportError("Cannot load mod list: " + message);
}

function checkedShortText(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== "string") {
    return invalidImport(label + " must be text.");
  }
  const trimmed = value.trim();
  if (!trimmed.length) {
    return invalidImport(label + " is empty.");
  }
  if (trimmed.length > maximumLength || containsControlCharacter(trimmed)) {
    return invalidImport(label + " is not valid.");
  }
  return trimmed;
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) {
      return true;
    }
  }
  return false;
}

function checkedPackageIds(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    return invalidImport(label + " must be a list.");
  }
  if (value.length > modListLimits.maxEntries) {
    return invalidImport(label + " contains too many entries.");
  }
  const packageIds: string[] = [];
  const normalized = new Set<string>();
  for (const valueEntry of value) {
    if (typeof valueEntry !== "string") {
      return invalidImport(label + " contains a non-text package ID.");
    }
    const packageId = valueEntry.trim();
    if (
      packageId.length > modListLimits.maxPackageIdLength ||
      !isUsablePackageId(packageId) ||
      containsControlCharacter(packageId)
    ) {
      return invalidImport(label + " contains an invalid package ID.");
    }
    const key = normalizePackageId(packageId);
    if (normalized.has(key)) {
      return invalidImport("duplicate package ID " + packageId + ".");
    }
    normalized.add(key);
    packageIds.push(packageId);
  }
  return packageIds;
}

/**
 * Keep the renderer safe if a malformed object somehow crosses the preload boundary. Main-process
 * parsing remains the primary validation boundary; this copy also prevents callers mutating a plan.
 */
export function validateImportedModListFile(file: unknown): ImportedModListFile {
  if (!file || typeof file !== "object") {
    return invalidImport("the selected file did not contain a mod list.");
  }
  const candidate = file as Partial<ImportedModListFile>;
  const fileName = checkedShortText(candidate.fileName, "the file name", maximumFileNameLength);
  const packageIds = checkedPackageIds(candidate.packageIds, "activeMods");
  if (
    packageIds.some(
      (packageId) => /_steam$/i.test(packageId) && getOfficialContent(packageId) !== undefined,
    )
  ) {
    return invalidImport("official RimWorld content cannot use the _steam marker.");
  }
  if (
    packageIds.filter((packageId) => normalizePackageId(packageId) === rimWorldPackages.core)
      .length !== 1
  ) {
    return invalidImport("activeMods must contain RimWorld Core exactly once.");
  }
  const knownExpansions = checkedPackageIds(candidate.knownExpansions, "knownExpansions");
  if (
    knownExpansions.some(
      (packageId) => /_steam$/i.test(packageId) && getOfficialContent(packageId) !== undefined,
    )
  ) {
    return invalidImport("official RimWorld content cannot use the _steam marker.");
  }
  const gameVersion =
    candidate.gameVersion === undefined
      ? undefined
      : checkedShortText(candidate.gameVersion, "the game version", modListLimits.maxVersionLength);
  return { fileName, gameVersion, packageIds, knownExpansions };
}

function isSteamCandidate(mod: Mod): boolean {
  return isWorkshopMod(mod);
}

function packageIdForImportedCopy(packageId: string, selected: Mod): string {
  const officialContent = getOfficialContent(packageId);
  if (officialContent) {
    return officialContent.packageId;
  }
  const selectedPackageId = (selected.packageId?.trim() ?? packageId).replace(/_steam$/i, "");
  return /_steam$/i.test(packageId) && isSteamCandidate(selected)
    ? `${selectedPackageId}_steam`
    : selectedPackageId;
}

function stableTextOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sourceRank(mod: Mod): number {
  if (isOfficialMod(mod)) {
    return 0;
  }
  switch (mod.source) {
    case modSources.local:
      return 1;
    case modSources.manual:
      return 2;
    case modSources.steam:
      return 3;
  }
}

function compareCandidates(
  left: Mod,
  right: Mod,
  steamHint: boolean,
  activePositionById: ReadonlyMap<string, number>,
): number {
  if (steamHint) {
    const steamDifference = Number(!isSteamCandidate(left)) - Number(!isSteamCandidate(right));
    if (steamDifference) {
      return steamDifference;
    }
  }
  const leftActive = activePositionById.get(left.id);
  const rightActive = activePositionById.get(right.id);
  const activeDifference = Number(leftActive === undefined) - Number(rightActive === undefined);
  if (activeDifference) {
    return activeDifference;
  }
  if (leftActive !== undefined && rightActive !== undefined && leftActive !== rightActive) {
    return leftActive - rightActive;
  }
  const priorityDifference = sourceRank(left) - sourceRank(right);
  if (priorityDifference) {
    return priorityDifference;
  }
  const installedDifference = Number(!left.localPath) - Number(!right.localPath);
  if (installedDifference) {
    return installedDifference;
  }
  const subscriptionDifference = Number(!left.subscribed) - Number(!right.subscribed);
  return subscriptionDifference || stableTextOrder(left.id, right.id);
}

function selectedReason(
  selected: Mod,
  steamHint: boolean,
  candidates: readonly Mod[],
  activeIds: ReadonlySet<string>,
): ImportChoiceReason {
  const hasSteamCandidate = candidates.some(isSteamCandidate);
  const hasNonSteamCandidate = candidates.some((candidate) => !isSteamCandidate(candidate));
  if (steamHint && isSteamCandidate(selected) && hasNonSteamCandidate) {
    return importChoiceReasons.steamHint;
  }
  if (!steamHint && !isSteamCandidate(selected) && hasSteamCandidate) {
    return importChoiceReasons.nonSteamHint;
  }
  return activeIds.has(selected.id)
    ? importChoiceReasons.currentActive
    : importChoiceReasons.sourcePriority;
}

function buildVersionMismatch(
  importedVersion?: string,
  currentVersion?: string,
): ModListVersionMismatch | undefined {
  const imported = importedVersion?.trim();
  const current = currentVersion?.trim();
  if (!imported || !current) {
    return undefined;
  }
  const importedComparableVersion = normalizedGameVersion(imported);
  const currentComparableVersion = normalizedGameVersion(current);
  return importedComparableVersion.toLowerCase() === currentComparableVersion.toLowerCase()
    ? undefined
    : {
        importedVersion: imported,
        currentVersion: current,
        importedComparableVersion,
        currentComparableVersion,
      };
}

/**
 * Resolve an imported ordered package list against the physical rows currently known to RimLib.
 * Missing packages are intentionally not fabricated: the preview can stage the available subset
 * while clearly telling the user what was omitted.
 */
export function buildModListImportPlan(
  importedFile: ImportedModListFile,
  knownMods: readonly Mod[],
  currentActiveMods: readonly Mod[],
  currentGameVersion?: string,
  savedModIds?: ReadonlySet<string>,
): ModListImportPlan {
  const file = validateImportedModListFile(importedFile);
  const activePositionById = new Map(currentActiveMods.map((mod, index) => [mod.id, index]));
  const activeIds = new Set(activePositionById.keys());
  const knownById = new Map(knownMods.map((mod) => [mod.id, mod]));
  // Prefer the concrete row supplied by Active if a stale Library snapshot has the same identity.
  for (const mod of currentActiveMods) {
    knownById.set(mod.id, mod);
  }
  const candidatesByPackage = new Map<string, Mod[]>();
  for (const mod of knownById.values()) {
    if (!isUsablePackageId(mod.packageId)) {
      continue;
    }
    // A stale saved Steam row without a numeric Workshop identity cannot be installed or
    // subscribed. Do not advertise it as an available import target unless it is already Active
    // or an installed path proves that a concrete copy exists.
    if (
      mod.source === modSources.steam &&
      !isWorkshopMod(mod) &&
      !activeIds.has(mod.id) &&
      !mod.localPath
    ) {
      continue;
    }
    // Activation auto-subscribes an inactive Workshop row. That transaction requires the row to
    // exist in the saved Library; otherwise previewing it as available would only fail at Stage.
    if (
      savedModIds &&
      isWorkshopMod(mod) &&
      !activeIds.has(mod.id) &&
      !mod.subscribed &&
      !savedModIds.has(mod.id)
    ) {
      continue;
    }
    const packageId = normalizePackageId(mod.packageId);
    candidatesByPackage.set(packageId, [...(candidatesByPackage.get(packageId) ?? []), mod]);
  }

  const targetMods: Mod[] = [];
  const availablePackageIds: string[] = [];
  const missingPackageIds: string[] = [];
  const duplicateChoices: ModListImportDuplicateChoice[] = [];
  for (const packageId of file.packageIds) {
    const normalizedPackageId = normalizePackageId(packageId);
    const candidates = (candidatesByPackage.get(normalizedPackageId) ?? []).filter(
      (candidate) => !getOfficialContent(normalizedPackageId) || isOfficialMod(candidate),
    );
    if (!candidates.length) {
      missingPackageIds.push(packageId);
      continue;
    }
    const steamHint = /_steam$/i.test(packageId);
    // RimSort's marker is authoritative when two physical sources share a package ID. A bare ID
    // selects local/manual; `_steam` selects Workshop. With only one source, either form can still
    // resolve so ordinary Workshop-only exports remain portable.
    const preferredCandidates = candidates.filter(
      (candidate) => isSteamCandidate(candidate) === steamHint,
    );
    const selectableCandidates = preferredCandidates.length ? preferredCandidates : candidates;
    const orderedSelectable = [...selectableCandidates].sort((left, right) =>
      compareCandidates(left, right, steamHint, activePositionById),
    );
    const selected = orderedSelectable[0];
    if (!selected) {
      missingPackageIds.push(packageId);
      continue;
    }
    // RimSort's suffix is not part of the package identity; it records which physical copy was
    // chosen. Carry it into an activation draft so applying a local -> Workshop replacement does
    // not lose that choice when ModsConfig.xml is written.
    const target =
      packageIdForImportedCopy(packageId, selected) === selected.packageId
        ? selected
        : { ...selected, packageId: packageIdForImportedCopy(packageId, selected) };
    targetMods.push(target);
    availablePackageIds.push(packageId);
    if (candidates.length > 1) {
      const orderedCandidates = [
        selected,
        ...candidates
          .filter((candidate) => candidate.id !== selected.id)
          .sort((left, right) => compareCandidates(left, right, steamHint, activePositionById)),
      ];
      duplicateChoices.push({
        packageId,
        normalizedPackageId,
        selected,
        candidates: orderedCandidates,
        reason: selectedReason(selected, steamHint, orderedCandidates, activeIds),
      });
    }
  }

  const targetIds = new Set(targetMods.map((mod) => mod.id));
  const activatedMods = targetMods.filter((mod) => !activeIds.has(mod.id));
  const deactivatedMods = [
    ...new Map(
      currentActiveMods
        .filter((mod) => !targetIds.has(mod.id))
        .map((mod) => [mod.id, mod] as const),
    ).values(),
  ];
  return {
    file,
    currentActiveSnapshot: currentActiveMods.map(snapshotMod),
    targetMods,
    availablePackageIds,
    missingPackageIds,
    activatedMods,
    deactivatedMods,
    duplicateChoices,
    versionMismatch: buildVersionMismatch(file.gameVersion, currentGameVersion),
  };
}
