import { stat } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

import { withReadTimeout } from "../shared/async";
import { defaultReadTimeoutMs } from "../shared/limits";
import { normalizePackageId } from "../shared/packages";
import { createSteamWorkshopUrl, getModWorkshopId, RIMWORLD_APP_ID } from "../shared/steam";
import type { ActiveModsState, AppSettings, ModVault } from "../shared/types";
import { errorCode } from "../shared/validation";
import { getActiveModsView } from "./installedMods";
import { log } from "./logging";
import { fileErrorCodes } from "./platformConstants";
import { findSteamLibraries, normalizeWorkshopModsPath } from "./steamWorkshop";

interface ModActionShell {
  showItemInFolder: (path: string) => void;
  openExternal: (url: string) => Promise<void>;
  openPath: (path: string) => Promise<string>;
}

export async function openDatabaseFolder(
  databasePath: string,
  shell: Pick<ModActionShell, "openPath">,
): Promise<void> {
  if (!isAbsolute(databasePath)) {
    throw new Error("The database path must be an absolute path.");
  }
  const path = dirname(databasePath);
  const error = await shell.openPath(path);
  if (error) {
    throw new Error(`Could not open the database folder. ${error}`);
  }
  log.info("database.folder.opened", { path });
}

export function openWorkshopInBrowser(
  workshopId: string,
  shell: Pick<ModActionShell, "openExternal">,
): Promise<void> {
  return shell.openExternal(createSteamWorkshopUrl(workshopId));
}

async function isModDirectory(path: string): Promise<boolean> {
  if (!isAbsolute(path)) {
    throw new Error("The saved mod folder must be an absolute path.");
  }
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    const code = errorCode(error);
    if (code === fileErrorCodes.notFound || code === fileErrorCodes.notDirectory) {
      return false;
    }
    throw new Error(`Cannot access the mod folder: ${path}. ${(error as Error).message}`, {
      cause: error,
    });
  }
}

interface FolderLookupDependencies {
  activeMods?: (settings: AppSettings) => Promise<ActiveModsState>;
  steamLibraries?: () => Promise<string[]>;
  lookupTimeoutMs?: number;
}

async function resolveModFolder(
  modId: string,
  vault: ModVault,
  dependencies: FolderLookupDependencies,
): Promise<string> {
  if (typeof modId !== "string" || !modId) {
    throw new Error("Choose a mod to reveal its folder.");
  }
  const settings = vault.settings ?? {};
  const saved = vault.mods.find((mod) => mod.id === modId);
  let workshopId = saved ? getModWorkshopId(saved) : /^steam-([1-9]\d{0,19})$/.exec(modId)?.[1];
  let localPath = saved?.localPath;
  if (!workshopId && !localPath) {
    const active = await (dependencies.activeMods ?? getActiveModsView)(settings);
    const installed = active.installedMods?.find(
      (mod) =>
        modId ===
        (mod.workshopId
          ? `steam-${mod.workshopId}`
          : `active-package:${normalizePackageId(mod.packageId)}`),
    );
    workshopId = installed?.workshopId;
    localPath = installed?.localPath;
  }

  // A configured Workshop root is authoritative, even if a saved path points to an old drive.
  if (workshopId && settings.workshopModsPath) {
    const path = join(normalizeWorkshopModsPath(settings.workshopModsPath), workshopId);
    if (await isModDirectory(path)) {
      return path;
    }
    throw new Error(
      `The mod folder was not found: ${path}. The mod may not be downloaded or the drive may be disconnected.`,
    );
  }
  if (localPath && (await isModDirectory(localPath))) {
    return localPath;
  }
  if (workshopId) {
    for (const library of await (dependencies.steamLibraries ?? findSteamLibraries)()) {
      const path = join(
        library,
        "steamapps",
        "workshop",
        "content",
        String(RIMWORLD_APP_ID),
        workshopId,
      );
      if (await isModDirectory(path)) {
        return path;
      }
    }
  }
  throw new Error(
    "The mod folder is not available locally. Download the mod or check the Workshop folder in Settings.",
  );
}

export async function revealModFolder(
  modId: string,
  vault: ModVault,
  shell: Pick<ModActionShell, "showItemInFolder">,
  dependencies: FolderLookupDependencies = {},
): Promise<void> {
  // Only the lookup can time out. A late lookup must never open Finder after an error was reported.
  const path = await withReadTimeout(
    resolveModFolder(modId, vault, dependencies),
    "Finding the mod folder timed out. Check the drive connection and Workshop path in Settings.",
    dependencies.lookupTimeoutMs ?? defaultReadTimeoutMs,
  );
  shell.showItemInFolder(path);
  log.info("mod.folder.revealed", { modId, path });
}
