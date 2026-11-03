import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

import { withReadTimeout } from "../shared/async";
import { xmlLimits } from "../shared/limits";
import {
  isUsablePackageId,
  normalizePackageId,
  normalizePhysicalPackageId,
  rimWorldPackages,
} from "../shared/packages";
import { rimWorldFiles } from "../shared/storage";
import type { ActiveModsState, AppSettings } from "../shared/types";
import { readBoundedUtf8File } from "./fileReads";
import { log } from "./logging";
import { platforms, processLimits } from "./platformConstants";
import { atomicWrite } from "./vaultStore";
import { parseXml, xmlList, xmlRecord, xmlText } from "./xml";

const execute = promisify(execFile);
const activeModsElement =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|(<activeMods\b[^>]*>)([\s\S]*?)(<\/activeMods\s*>)/g;

interface SetActiveModsDependencies {
  assertClosed: () => Promise<void>;
  write: typeof atomicWrite;
}

function validatePackageOrder(packageIds: readonly string[], label: string): string[] {
  const cleaned = packageIds.map((packageId) => packageId.trim());
  if (cleaned.some((packageId) => !isUsablePackageId(packageId))) {
    throw new Error(`${label} contains an invalid package identifier. No changes were made.`);
  }
  const normalized = cleaned.map(normalizePackageId);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} contains duplicate package identifiers. No changes were made.`);
  }
  if (normalized.filter((packageId) => packageId === rimWorldPackages.core).length !== 1) {
    throw new Error(`${label} must contain the RimWorld Core package exactly once.`);
  }
  return cleaned;
}

function samePhysicalOrder(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (packageId, index) =>
        normalizePhysicalPackageId(packageId) === normalizePhysicalPackageId(right[index] ?? ""),
    )
  );
}

function renderActiveMods(previousContent: string, packageIds: readonly string[]): string {
  const lineEnding = previousContent.includes("\r\n")
    ? "\r\n"
    : previousContent.includes("\n")
      ? "\n"
      : undefined;
  if (!lineEnding) {
    return packageIds.map((packageId) => `<li>${packageId}</li>`).join("");
  }
  const itemIndent = /(?:\r\n|\n)([\t ]*)<li(?:\s|>)/.exec(previousContent)?.[1] ?? "    ";
  const closingIndent = /(?:\r\n|\n)([\t ]*)$/.exec(previousContent)?.[1] ?? "";
  return `${lineEnding}${packageIds
    .map((packageId) => `${itemIndent}<li>${packageId}</li>`)
    .join(lineEnding)}${lineEnding}${closingIndent}`;
}

function replaceActiveMods(raw: string, packageIds: readonly string[]): string {
  let match: RegExpExecArray | undefined;
  for (const candidate of raw.matchAll(activeModsElement)) {
    if (candidate[1] !== undefined) {
      match = candidate;
      break;
    }
  }
  if (!match) {
    throw new Error("Invalid ModsConfig.xml: activeMods could not be updated.");
  }
  const opening = match[1];
  const previousContent = match[2];
  const closing = match[3];
  if (opening === undefined || previousContent === undefined || closing === undefined) {
    throw new Error("Invalid ModsConfig.xml: activeMods could not be updated.");
  }
  const start = match.index;
  const end = start + match[0].length;
  return `${raw.slice(0, start)}${opening}${renderActiveMods(previousContent, packageIds)}${closing}${raw.slice(end)}`;
}

export function defaultConfigPath(): string {
  if (process.platform === platforms.macOS) {
    return join(
      homedir(),
      "Library",
      "Application Support",
      "RimWorld",
      "Config",
      rimWorldFiles.config,
    );
  }
  if (process.platform === platforms.windows) {
    return join(
      process.env.USERPROFILE ?? homedir(),
      "AppData",
      "LocalLow",
      "Ludeon Studios",
      "RimWorld by Ludeon Studios",
      "Config",
      rimWorldFiles.config,
    );
  }
  return join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    "unity3d",
    "Ludeon Studios",
    "RimWorld by Ludeon Studios",
    "Config",
    rimWorldFiles.config,
  );
}

export function resolveConfigPath(settings: Pick<AppSettings, "rimWorldConfigPath"> = {}): string {
  const configuredPath = settings.rimWorldConfigPath?.trim();
  const selectedPath =
    configuredPath === undefined || configuredPath === "" ? defaultConfigPath() : configuredPath;
  return resolve(selectedPath);
}

export async function readConfig(settings: AppSettings = {}) {
  const selectedPath = resolveConfigPath(settings);
  const path = await withReadTimeout(
    realpath(selectedPath),
    "Resolving ModsConfig.xml timed out. Check whether its drive is connected.",
  );
  const raw = await withReadTimeout(
    readBoundedUtf8File(path, xmlLimits.maxFileBytes, "ModsConfig.xml"),
    "Reading ModsConfig.xml timed out. Check whether its drive is connected.",
  );
  const document = parseXml(raw);
  const data = xmlRecord(document.ModsConfigData);
  if (!Object.hasOwn(data, "activeMods")) {
    throw new Error("Invalid ModsConfig.xml: activeMods is missing.");
  }
  const packageIds = xmlList(xmlRecord(data.activeMods).li);
  if (!packageIds.some((id) => normalizePackageId(id) === rimWorldPackages.core)) {
    throw new Error(
      "Invalid ModsConfig.xml: the active Core mod is missing. No changes were made.",
    );
  }
  return { path, raw, document, gameVersion: xmlText(data.version), packageIds };
}

async function assertSingleLinkConfig(path: string): Promise<void> {
  const metadata = await withReadTimeout(
    stat(path),
    "Checking ModsConfig.xml identity timed out. Check whether its drive is connected.",
  );
  if (!metadata.isFile()) {
    throw new Error("ModsConfig.xml is not a regular file. No changes were made.");
  }
  if (metadata.nlink > 1) {
    throw new Error(
      "ModsConfig.xml is hard-linked to another file. Select the real game configuration path before applying changes; no changes were made.",
    );
  }
}

export async function setActiveMods(
  settings: AppSettings | undefined,
  packageIds: readonly string[],
  expectedPackageIds: readonly string[],
  dependencies: Partial<SetActiveModsDependencies> = {},
): Promise<ActiveModsState> {
  const nextPackageIds = validatePackageOrder(packageIds, "The requested active mod order");
  const expectedOrder = validatePackageOrder(expectedPackageIds, "The expected active mod order");
  const current = await readConfig(settings);
  validatePackageOrder(current.packageIds, "The current active mod order");
  await assertSingleLinkConfig(current.path);
  if (!samePhysicalOrder(current.packageIds, expectedOrder)) {
    throw new Error(
      "RimWorld's active mod list changed outside RimLib. Reload it before applying this draft; no changes were made.",
    );
  }

  await (dependencies.assertClosed ?? assertGameClosed)();
  const nextRaw = replaceActiveMods(current.raw, nextPackageIds);
  const write = dependencies.write ?? atomicWrite;
  await write(`${current.path}.rimlib.bak`, current.raw);
  await write(current.path, nextRaw, {
    expected: current.raw,
    beforePublish: async (claimedPath) => {
      await assertSingleLinkConfig(claimedPath ?? current.path);
    },
  });
  const written = await readConfig(settings);
  if (written.raw !== nextRaw || !samePhysicalOrder(written.packageIds, nextPackageIds)) {
    throw new Error(
      `RimWorld's config could not be verified after writing. The previous config is preserved at ${current.path}.rimlib.bak; reload before retrying.`,
    );
  }
  log.info("rimworld.config.updated", {
    path: current.path,
    previousCount: current.packageIds.length,
    activeCount: written.packageIds.length,
  });
  return {
    configPath: written.path,
    gameVersion: written.gameVersion,
    packageIds: written.packageIds,
  };
}

export async function getActiveMods(settings: AppSettings = {}): Promise<ActiveModsState> {
  try {
    const config = await readConfig(settings);
    log.debug("rimworld.config.read", { path: config.path, activeCount: config.packageIds.length });
    return {
      configPath: config.path,
      gameVersion: config.gameVersion,
      packageIds: config.packageIds,
    };
  } catch (error) {
    const configPath = resolveConfigPath(settings);
    log.warn("rimworld.config.unavailable", {
      configuredPath: configPath,
      error,
    });
    return {
      configPath,
      packageIds: [],
      error: `Cannot read RimWorld's active mods. Select ModsConfig.xml in Settings. ${(error as Error).message}`,
    };
  }
}

export async function assertGameClosed(): Promise<void> {
  let output: string;
  try {
    const result =
      process.platform === platforms.windows
        ? await execute("tasklist", ["/FO", "CSV", "/NH"], {
            timeout: processLimits.gameCheckTimeoutMs,
          })
        : await execute("ps", ["-A", "-o", "comm="], { timeout: processLimits.gameCheckTimeoutMs });
    output = result.stdout;
  } catch {
    throw new Error(
      "Cannot check whether RimWorld is running. Active-mod and subscription changes were blocked.",
    );
  }
  if (
    output
      .split("\n")
      .some((line) =>
        /^rimworld(?:win|mac|linux)?(?:64)?(?:\.exe)?$/i.test(
          basename(line.trim().replace(/^"([^"\n]+)".*$/, "$1")),
        ),
      )
  ) {
    throw new Error("Close RimWorld before changing active mods or subscriptions.");
  }
}
