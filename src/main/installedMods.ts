import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";

import { mapWithConcurrency, withReadTimeout } from "../shared/async";
import { steamLimits } from "../shared/limits";
import { normalizePackageId } from "../shared/packages";
import { RIMWORLD_APP_ID } from "../shared/steam";
import type { AppSettings, InstalledModMetadata } from "../shared/types";
import { log } from "./logging";
import { getActiveMods } from "./rimWorldConfig";
import {
  discoverWorkshopFolders,
  findRimWorldInstallations,
  findSteamLibraries,
  readAboutXml,
} from "./steamWorkshop";

async function directories(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(path, entry.name));
  } catch {
    return [];
  }
}

export class InstalledModIndex {
  private cached?: { key: string; expires: number; pending: Promise<InstalledModMetadata[]> };

  constructor(private cacheDuration: number = steamLimits.installedMetadataCacheMs) {}

  read(libraries: string[], workshopModsPath?: string): Promise<InstalledModMetadata[]> {
    const key = JSON.stringify([libraries, workshopModsPath]);
    if (this.cached?.key === key && this.cached.expires > Date.now()) {
      return this.cached.pending;
    }
    const pending = this.scan(libraries, workshopModsPath);
    const cache = { key, expires: Infinity, pending };
    this.cached = cache;
    void pending.then(
      () => {
        cache.expires = Date.now() + this.cacheDuration;
      },
      () => {
        if (this.cached === cache) {
          this.cached = undefined;
        }
      },
    );
    return pending;
  }

  private async scan(
    libraries: string[],
    workshopModsPath?: string,
  ): Promise<InstalledModMetadata[]> {
    const start = Date.now();
    const paths = new Map<string, string | undefined>();
    for (const game of await findRimWorldInstallations(libraries)) {
      const roots = [game, ...(await directories(game)).filter((path) => path.endsWith(".app"))];
      for (const root of roots) {
        for (const folder of [
          join(root, "Data"),
          join(root, "Mods"),
          join(root, "Contents", "Resources", "Data"),
          join(root, "Contents", "Resources", "Mods"),
        ]) {
          for (const path of await directories(folder)) {
            paths.set(path, undefined);
          }
        }
      }
    }
    if (workshopModsPath) {
      for (const folder of (await discoverWorkshopFolders(libraries, { workshopModsPath }))
        .folders) {
        paths.set(folder.path, folder.workshopId);
      }
    } else {
      for (const library of libraries) {
        const folder = join(library, "steamapps", "workshop", "content", String(RIMWORLD_APP_ID));
        for (const path of await directories(folder)) {
          const id = basename(path);
          if (/^\d+$/.test(id)) {
            paths.set(path, id);
          }
        }
      }
    }
    const entries = [...paths];
    // Bound filesystem concurrency; metadata identity comes from the root About.xml, never dependencies.
    const read = await mapWithConcurrency(
      entries,
      steamLimits.localMetadataReadConcurrency,
      async ([localPath, workshopId]): Promise<InstalledModMetadata | undefined> => {
        try {
          const about = await readAboutXml(localPath);
          if (!about.packageId) {
            return undefined;
          }
          return {
            ...about,
            packageId: about.packageId,
            localPath,
            workshopId,
            name: about.name ?? (workshopId ? undefined : basename(localPath)),
          };
        } catch {
          return undefined;
        }
      },
    );
    const installed = read.filter((entry): entry is InstalledModMetadata => Boolean(entry));
    log.debug("rimworld.installed-mods.scanned", {
      libraryCount: libraries.length,
      folderCount: entries.length,
      identifiedCount: installed.length,
      durationMs: Date.now() - start,
    });
    return installed;
  }
}

const installedMods = new InstalledModIndex();

export async function getActiveModsView(
  settings: AppSettings = {},
  readMetadata = async () =>
    installedMods.read(await findSteamLibraries(), settings.workshopModsPath),
) {
  const active = await getActiveMods(settings);
  if (active.error) {
    return active;
  }
  const packages = new Set(active.packageIds.map(normalizePackageId));
  try {
    const metadata = await withReadTimeout(
      readMetadata(),
      "Reading installed mod metadata timed out. Check whether the Workshop drive is connected.",
    );
    return {
      ...active,
      installedMods: metadata.filter((mod) => packages.has(normalizePackageId(mod.packageId))),
    };
  } catch (error) {
    log.warn("rimworld.installed-mods.unavailable", {
      workshopModsPath: settings.workshopModsPath,
      error,
    });
    return {
      ...active,
      metadataError: `Installed mod metadata is unavailable. Active order was read from ModsConfig.xml. ${(error as Error).message}`,
    };
  }
}
