import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

import { withReadTimeout } from "../shared/async";
import { normalizePackageId, rimWorldPackages } from "../shared/packages";
import { rimWorldFiles } from "../shared/storage";
import type { ActiveModsState, AppSettings } from "../shared/types";
import { log } from "./logging";
import { platforms, processLimits } from "./platformConstants";
import { parseXml, xmlList, xmlRecord, xmlText } from "./xml";

const execute = promisify(execFile);

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

export async function readConfig(settings: AppSettings = {}) {
  const configuredPath = settings.rimWorldConfigPath?.trim();
  const path =
    configuredPath === undefined || configuredPath === "" ? defaultConfigPath() : configuredPath;
  const raw = await withReadTimeout(
    readFile(path, "utf8"),
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
    log.warn("rimworld.config.unavailable", {
      configuredPath: settings.rimWorldConfigPath ?? defaultConfigPath(),
      error,
    });
    return {
      configPath: settings.rimWorldConfigPath?.trim()
        ? settings.rimWorldConfigPath.trim()
        : defaultConfigPath(),
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
      "Cannot check whether RimWorld is running. Unsubscribing was blocked to protect active mods.",
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
    throw new Error("Close RimWorld before unsubscribing mods.");
  }
}
