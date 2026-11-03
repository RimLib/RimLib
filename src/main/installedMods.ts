import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";

import { mapWithConcurrency, withReadTimeout } from "../shared/async";
import { steamLimits } from "../shared/limits";
import { getOfficialContent } from "../shared/officialContent";
import { isUsablePackageId } from "../shared/packages";
import { RIMWORLD_APP_ID } from "../shared/steam";
import type { AppSettings, InstalledModMetadata } from "../shared/types";
import { log } from "./logging";
import { type ApprovedOfficialContentImage, officialContentImages } from "./officialContentImages";
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

interface InstalledModCache {
  token: symbol;
  key: string;
  expires: number;
  pending: Promise<InstalledModMetadata[]>;
  settled: boolean;
  queuedRefresh?: Promise<InstalledModMetadata[]>;
}

export class InstalledModIndex {
  private cached?: InstalledModCache;

  constructor(private cacheDuration: number = steamLimits.installedMetadataCacheMs) {}

  read(
    libraries: string[],
    workshopModsPath?: string,
    forceRefresh = false,
  ): Promise<InstalledModMetadata[]> {
    const key = JSON.stringify([libraries, workshopModsPath]);
    if (this.cached?.key === key && this.cached.expires > Date.now()) {
      if (!forceRefresh) {
        return this.cached.pending;
      }
      if (!this.cached.settled) {
        const current = this.cached;
        current.queuedRefresh ??= current.pending.then(
          (installed) =>
            this.cached === current ? this.read(libraries, workshopModsPath, true) : installed,
          (error: unknown) => {
            if (this.cached === current || !this.cached) {
              return this.read(libraries, workshopModsPath, true);
            }
            throw error;
          },
        );
        return current.queuedRefresh;
      }
    }
    if (this.cached && this.cached.key !== key) {
      officialContentImages.replace([]);
    }
    const token = Symbol("installed-mod-scan");
    const pending = this.scan(libraries, workshopModsPath).then(({ installed, previews }) => {
      // A slow scan for an old path must not replace image approvals from the current path.
      if (this.cached?.token === token) {
        officialContentImages.replace(previews);
      }
      return installed;
    });
    const cache: InstalledModCache = { token, key, expires: Infinity, pending, settled: false };
    this.cached = cache;
    void pending.then(
      () => {
        cache.settled = true;
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
  ): Promise<{
    installed: InstalledModMetadata[];
    previews: ApprovedOfficialContentImage[];
  }> {
    const start = Date.now();
    const paths = new Map<string, { officialContentCandidate: boolean; workshopId?: string }>();
    for (const game of await findRimWorldInstallations(libraries)) {
      const roots = [game, ...(await directories(game)).filter((path) => path.endsWith(".app"))];
      for (const root of roots) {
        for (const folder of [join(root, "Data"), join(root, "Contents", "Resources", "Data")]) {
          for (const path of await directories(folder)) {
            paths.set(path, { officialContentCandidate: true });
          }
        }
        for (const folder of [join(root, "Mods"), join(root, "Contents", "Resources", "Mods")]) {
          for (const path of await directories(folder)) {
            paths.set(path, { officialContentCandidate: false });
          }
        }
      }
    }
    if (workshopModsPath) {
      for (const folder of (await discoverWorkshopFolders(libraries, { workshopModsPath }))
        .folders) {
        paths.set(folder.path, {
          officialContentCandidate: false,
          workshopId: folder.workshopId,
        });
      }
    } else {
      for (const library of libraries) {
        const folder = join(library, "steamapps", "workshop", "content", String(RIMWORLD_APP_ID));
        for (const path of await directories(folder)) {
          const id = basename(path);
          if (/^\d+$/.test(id)) {
            paths.set(path, { officialContentCandidate: false, workshopId: id });
          }
        }
      }
    }
    const entries = [...paths];
    // Bound filesystem concurrency; metadata identity comes from the root About.xml, never dependencies.
    const read = await mapWithConcurrency(
      entries,
      steamLimits.localMetadataReadConcurrency,
      async ([localPath, source]): Promise<{
        metadata?: InstalledModMetadata;
        preview?: ApprovedOfficialContentImage;
      }> => {
        try {
          const about = await readAboutXml(localPath);
          const downloadedAt = (await stat(localPath).catch(() => undefined))?.mtime.toISOString();
          if (!isUsablePackageId(about.packageId)) {
            log.warn("rimworld.installed-mod-metadata.missing-package-id", {
              path: localPath,
              workshopId: source.workshopId,
              officialContentCandidate: source.officialContentCandidate,
            });
            return {};
          }
          const official = getOfficialContent(about.packageId);
          const officialContent =
            source.officialContentCandidate &&
            basename(localPath).toLowerCase() === official?.folderName.toLowerCase();
          const preview = source.officialContentCandidate
            ? await officialContentImages.inspect(about.packageId, localPath)
            : undefined;
          return {
            metadata: {
              ...about,
              packageId: about.packageId,
              localPath,
              ...(downloadedAt ? { downloadedAt } : {}),
              workshopId: source.workshopId,
              ...(officialContent ? { officialContent: true } : {}),
              name: about.name ?? (source.workshopId ? undefined : basename(localPath)),
              thumbnail: preview?.url,
            },
            preview,
          };
        } catch (error) {
          log.warn("rimworld.installed-mod-metadata.failed", {
            path: localPath,
            workshopId: source.workshopId,
            officialContentCandidate: source.officialContentCandidate,
            error,
          });
          return {};
        }
      },
    );
    const previews = read.flatMap((result) => (result.preview ? [result.preview] : []));
    const installed = read.flatMap((result) => (result.metadata ? [result.metadata] : []));
    log.debug("rimworld.installed-mods.scanned", {
      libraryCount: libraries.length,
      folderCount: entries.length,
      identifiedCount: installed.length,
      durationMs: Date.now() - start,
    });
    return { installed, previews };
  }
}

const installedMods = new InstalledModIndex();

const metadataTimeoutMessage =
  "Reading installed mod metadata timed out. Check whether the Workshop drive is connected.";

export async function getInstalledMods(
  settings: AppSettings = {},
  forceRefresh = false,
  readMetadata = async () =>
    installedMods.read(await findSteamLibraries(), settings.workshopModsPath, forceRefresh),
): Promise<InstalledModMetadata[]> {
  return withReadTimeout(
    readMetadata(),
    metadataTimeoutMessage,
    steamLimits.activeMetadataTimeoutMs,
  );
}

export async function getActiveModsView(
  settings: AppSettings = {},
  readMetadata = async () =>
    installedMods.read(await findSteamLibraries(), settings.workshopModsPath),
) {
  const active = await getActiveMods(settings);
  if (active.error) {
    return active;
  }
  try {
    const metadata = await withReadTimeout(readMetadata(), metadataTimeoutMessage);
    return { ...active, installedMods: metadata };
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
