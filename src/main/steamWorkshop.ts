import { constants } from "node:fs";
import { access, opendir, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, normalize } from "node:path";

import { mapWithConcurrency, withReadTimeout } from "../shared/async";
import { modSources } from "../shared/domainConstants";
import { steamLimits } from "../shared/limits";
import { isUsablePackageId, normalizePackageId } from "../shared/packages";
import { createSteamWorkshopUrl, RIMWORLD_APP_ID } from "../shared/steam";
import { rimWorldFiles, steamLibraryIndexFileName } from "../shared/storage";
import type {
  AppSettings,
  Mod,
  ModDependency,
  SteamImportResult,
  SteamOperationProgress,
} from "../shared/types";
import { errorCode } from "../shared/validation";
import { log } from "./logging";
import { fileErrorCodes, platforms } from "./platformConstants";
import {
  fetchWorkshopDetails,
  normalizeWorkshopDetail,
  type WorkshopDetail,
} from "./workshopMetadata";
import { parseXml, xmlList, xmlRecord, xmlText } from "./xml";

const metadataProgressInterval = 20;

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

type VdfValue = string | { [key: string]: VdfValue };

export interface WorkshopFolderDiscovery {
  folders: { workshopId: string; path: string }[];
  steamLibraryPaths: string[];
  scannedLibraryPaths: string[];
  unavailableLibraryPaths: string[];
  manifestPaths: string[];
  warnings: string[];
}

type WorkshopDiscoveryReader = (
  libraries?: string[],
  settings?: AppSettings,
) => Promise<WorkshopFolderDiscovery>;

function effectiveDiscoveryRequest(libraries: string[] | undefined, settings: AppSettings) {
  if (settings.workshopModsPath) {
    const workshopModsPath = normalizeWorkshopModsPath(settings.workshopModsPath);
    return {
      key: JSON.stringify(["configured-folder", workshopModsPath]),
      libraries: undefined,
      settings: { workshopModsPath },
    };
  }
  const effectiveLibraries = libraries?.map((path) => normalize(join(path, ".")));
  return {
    key: JSON.stringify(["steam-libraries", effectiveLibraries ?? null]),
    libraries: effectiveLibraries,
    settings: {},
  };
}

export class WorkshopDiscoveryCoordinator {
  private readonly pending = new Map<string, Promise<WorkshopFolderDiscovery>>();

  constructor(private readonly reader: WorkshopDiscoveryReader = readWorkshopFolders) {}

  read(libraries?: string[], settings: AppSettings = {}): Promise<WorkshopFolderDiscovery> {
    let request: ReturnType<typeof effectiveDiscoveryRequest>;
    try {
      request = effectiveDiscoveryRequest(libraries, settings);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    const existing = this.pending.get(request.key);
    if (existing) {
      return existing;
    }
    let pending: Promise<WorkshopFolderDiscovery>;
    try {
      pending = this.reader(request.libraries, request.settings);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    this.pending.set(request.key, pending);
    const release = () => {
      if (this.pending.get(request.key) === pending) {
        this.pending.delete(request.key);
      }
    };
    // Attach both handlers so an abandoned caller cannot turn a late raw-read failure into an
    // unhandled rejection. Caller timeouts intentionally do not release this single-flight entry.
    void pending.then(release, release);
    return pending;
  }
}

export function normalizeWorkshopModsPath(value: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Choose the RimWorld Workshop mods folder (294100).");
  }
  const path = value.trim();
  const expanded =
    path.startsWith("~/") || path.startsWith("~\\") ? join(homedir(), path.slice(2)) : path;
  if (!isAbsolute(expanded)) {
    throw new Error("The Workshop mods folder must be an absolute path.");
  }
  return normalize(join(expanded, "."));
}

async function scanWorkshopFolder(root: string) {
  const entries = await readdir(root, { withFileTypes: true });
  const folders: WorkshopFolderDiscovery["folders"] = [];
  for (const entry of entries) {
    if (!/^[1-9]\d*$/.test(entry.name)) {
      continue;
    }
    const path = join(root, entry.name);
    const target = entry.isSymbolicLink()
      ? await stat(path).catch((error: unknown) => {
          if (errorCode(error) === fileErrorCodes.notFound) {
            return undefined;
          }
          throw error;
        })
      : undefined;
    if (entry.isDirectory() || target?.isDirectory()) {
      folders.push({ workshopId: entry.name, path });
    }
  }
  return { folders, entryCount: entries.length };
}

async function checkDirectoryAccess(path: string) {
  if (!(await stat(path)).isDirectory()) {
    throw Object.assign(new Error("The selected path is not a directory."), {
      code: fileErrorCodes.notDirectory,
    });
  }
  await access(path, constants.R_OK | constants.X_OK);
  const directory = await opendir(path, { bufferSize: 1 });
  try {
    await directory.read();
  } finally {
    await directory.close();
  }
}

async function validateWorkshopModsPathRead(value: string, timeout: boolean): Promise<string> {
  const path = normalizeWorkshopModsPath(value);
  const started = Date.now();
  try {
    const check = async () => {
      await checkDirectoryAccess(path);
      // Standard Steam roots need no child checks; custom roots get only a shallow name/type check.
      if (
        basename(path) !== String(RIMWORLD_APP_ID) &&
        !(await readdir(path, { withFileTypes: true })).some(
          (entry) =>
            /^[1-9]\d*$/.test(entry.name) && (entry.isDirectory() || entry.isSymbolicLink()),
        )
      ) {
        throw new Error(
          "Choose the 294100 folder containing numeric Workshop mod folders, not the Steam library or an individual mod.",
        );
      }
    };
    if (timeout) {
      await withReadTimeout(
        check(),
        "Checking folder access timed out. Check whether the drive is connected.",
      );
    } else {
      await check();
    }
    log.info("workshop.folder-access.checked", {
      path,
      readable: true,
      durationMs: Date.now() - started,
    });
    return path;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const reason =
      code === fileErrorCodes.notFound
        ? "Folder not found; check the path and whether the drive is mounted."
        : code === fileErrorCodes.accessDenied || code === fileErrorCodes.notPermitted
          ? "Permission denied when opening the folder."
          : (error as Error).message;
    log.warn("workshop.folder-access.failed", { path, code, error });
    throw Object.assign(
      new Error(
        `Cannot access the configured Workshop mods folder${code ? ` (${code})` : ""}: ${path}. ${reason} Saved mod status was preserved.`,
        { cause: error },
      ),
      { code },
    );
  }
}

export function validateWorkshopModsPath(value: string): Promise<string> {
  return validateWorkshopModsPathRead(value, true);
}

async function scanConfiguredWorkshopFolder(value: string) {
  // Discovery owns the caller timeout and retains this raw read for single-flight reuse.
  const path = await validateWorkshopModsPathRead(value, false);
  try {
    return { path, ...(await scanWorkshopFolder(path)) };
  } catch (error) {
    log.warn("workshop.configured-folder.scan-failed", { path, error });
    throw new Error(
      `Cannot scan the configured Workshop mods folder: ${path}. Saved mod status was preserved. ${(error as Error).message}`,
      { cause: error },
    );
  }
}

export function detectWorkshopModsPath(libraries?: string[]): Promise<string | null> {
  return withReadTimeout(
    detectReadableWorkshopPath(libraries),
    "Workshop folder detection timed out. Set its path manually in Settings.",
    steamLimits.workshopDiscoveryTimeoutMs,
  );
}

async function detectReadableWorkshopPath(libraries?: string[]): Promise<string | null> {
  try {
    const candidates: { path: string; folderCount: number }[] = [];
    for (const library of libraries ?? (await findSteamLibraries())) {
      const path = join(library, "steamapps", "workshop", "content", String(RIMWORLD_APP_ID));
      try {
        await checkDirectoryAccess(path);
        const entries = await readdir(path, { withFileTypes: true });
        candidates.push({
          path,
          folderCount: entries.filter(
            (entry) =>
              /^[1-9]\d*$/.test(entry.name) && (entry.isDirectory() || entry.isSymbolicLink()),
          ).length,
        });
      } catch (error) {
        log.debug("workshop.path.candidate.skipped", { path, source: "auto-detection", error });
      }
    }
    const selected = candidates.sort((first, second) => second.folderCount - first.folderCount)[0];
    if (selected) {
      log.info("workshop.path.detected", selected);
    }
    return selected?.path ?? null;
  } catch (error) {
    log.warn("workshop.path.detection-unavailable", { error });
    return null;
  }
}

export function discoverWorkshopFolders(
  libraries?: string[],
  settings: AppSettings = {},
): Promise<WorkshopFolderDiscovery> {
  return withReadTimeout(
    workshopDiscovery.read(libraries, settings),
    "Reading Workshop folders timed out. Check the drive connection. Saved mod status was preserved.",
  );
}

const workshopDiscovery = new WorkshopDiscoveryCoordinator();

async function readWorkshopFolders(
  libraries?: string[],
  settings: AppSettings = {},
): Promise<WorkshopFolderDiscovery> {
  if (settings.workshopModsPath) {
    log.info("workshop.discovery.started", {
      source: "configured-folder",
      root: settings.workshopModsPath,
    });
    const scanned = await scanConfiguredWorkshopFolder(settings.workshopModsPath);
    log.info("workshop.discovery.configured-folder", {
      root: scanned.path,
      folderCount: scanned.folders.length,
    });
    return {
      folders: scanned.folders,
      steamLibraryPaths: [],
      scannedLibraryPaths: [],
      unavailableLibraryPaths: [],
      manifestPaths: [],
      warnings: [],
    };
  }
  const steamLibraryPaths = libraries ?? (await findSteamLibraries({ includeUnavailable: true }));
  if (!steamLibraryPaths.length) {
    throw new Error("No Steam library could be found. Saved mod status was preserved.");
  }
  const folders = new Map<string, string>();
  const scannedLibraryPaths: string[] = [];
  const unavailableLibraryPaths: string[] = [];
  const warnings: string[] = [];
  log.info("workshop.discovery.started", { source: "steam-libraries", steamLibraryPaths });
  for (const library of steamLibraryPaths) {
    const root = join(library, "steamapps", "workshop", "content", String(RIMWORLD_APP_ID));
    try {
      if (!(await stat(join(library, "steamapps"))).isDirectory()) {
        throw new Error("Steam library is not a directory.");
      }
      const scanned = await scanWorkshopFolder(root).catch((error: unknown) => {
        if (errorCode(error) === fileErrorCodes.notFound) {
          return { folders: [], entryCount: 0 };
        }
        throw error;
      });
      for (const folder of scanned.folders) {
        if (!folders.has(folder.workshopId)) {
          folders.set(folder.workshopId, folder.path);
        }
      }
      scannedLibraryPaths.push(library);
      log.debug("workshop.discovery.library.scanned", {
        library,
        root,
        entryCount: scanned.entryCount,
      });
    } catch (error) {
      unavailableLibraryPaths.push(library);
      warnings.push(`Steam library unavailable: ${library}. Its saved mod status was preserved.`);
      log.warn("workshop.discovery.library.unavailable", { library, root, error });
    }
  }
  if (!scannedLibraryPaths.length) {
    throw new Error("No Steam library could be read. Saved mod status was preserved.");
  }
  const manifestPaths: string[] = [];
  for (const library of scannedLibraryPaths) {
    const path = join(library, "steamapps", "workshop", `appworkshop_${RIMWORLD_APP_ID}.acf`);
    if (await pathExists(path)) {
      manifestPaths.push(path);
    }
  }
  log.info("workshop.discovery.completed", {
    folderCount: folders.size,
    scannedLibraryCount: scannedLibraryPaths.length,
    unavailableLibraryCount: unavailableLibraryPaths.length,
  });
  return {
    folders: [...folders].map(([workshopId, path]) => ({ workshopId, path })),
    steamLibraryPaths,
    scannedLibraryPaths,
    unavailableLibraryPaths,
    manifestPaths,
    warnings,
  };
}

const aboutCache = new Map<string, { fingerprint: string; metadata: Partial<Mod> }>();

function readDependencies(metadata: Record<string, unknown>): ModDependency[] {
  const dependencies = new Map<string, ModDependency>();
  const add = (value: unknown, gameVersion?: string) => {
    const entry = xmlRecord(value);
    const packageId = xmlText(entry.packageId) ?? xmlText(value);
    if (!isUsablePackageId(packageId)) {
      return;
    }
    const displayName = xmlText(entry.displayName);
    const key = normalizePackageId(packageId);
    const previous = dependencies.get(key);
    const gameVersions =
      !gameVersion || (previous && !previous.gameVersions)
        ? undefined
        : [...new Set([...(previous?.gameVersions ?? []), gameVersion])];
    dependencies.set(key, {
      packageId,
      ...((displayName ?? previous?.displayName)
        ? { displayName: displayName ?? previous?.displayName }
        : {}),
      ...(gameVersions ? { gameVersions } : {}),
    });
  };
  const addList = (value: unknown, gameVersion?: string) => {
    const list = xmlRecord(value).li;
    for (const entry of Array.isArray(list) ? list : list === undefined ? [] : [list]) {
      add(entry, gameVersion);
    }
  };

  addList(metadata.modDependencies);
  for (const [key, list] of Object.entries(xmlRecord(metadata.modDependenciesByVersion))) {
    const gameVersion = key.replace(/^v(?=\d)/, "");
    if (/^\d+\.\d+$/.test(gameVersion)) {
      addList(list, gameVersion);
    }
  }
  return [...dependencies.values()];
}

export async function readAboutXml(path: string): Promise<Partial<Mod>> {
  let file = join(path, "About", rimWorldFiles.about);
  let info;
  try {
    info = await stat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== fileErrorCodes.notFound) {
      throw error;
    }
    const entries = await readdir(path, { withFileTypes: true });
    const about = entries.find(
      (entry) => entry.isDirectory() && entry.name.toLowerCase() === "about",
    );
    if (!about) {
      return {};
    }
    const directory = join(path, about.name);
    const name = (await readdir(directory)).find((entry) => entry.toLowerCase() === "about.xml");
    if (!name) {
      return {};
    }
    file = join(directory, name);
    info = await stat(file);
  }
  const fingerprint = `${info.mtimeMs}:${info.ctimeMs}:${info.size}`;
  const cached = aboutCache.get(file);
  if (cached?.fingerprint === fingerprint) {
    return { ...cached.metadata };
  }
  const xml = parseXml(await readFile(file, "utf8"));
  const metadata = xmlRecord(xml.ModMetaData ?? xml.ModMetadata);
  if (!Object.keys(metadata).length) {
    throw new Error("Invalid About.xml metadata.");
  }
  const result: Partial<Mod> = {
    name: xmlText(metadata.name),
    author:
      xmlText(metadata.author) ?? (xmlList(xmlRecord(metadata.authors).li).join(", ") || undefined),
    packageId: xmlText(metadata.packageId),
    summary: xmlText(metadata.description),
    dependencies: readDependencies(metadata),
    gameVersions: xmlList(xmlRecord(metadata.supportedVersions).li),
  };
  if (aboutCache.size >= steamLimits.aboutCacheEntries) {
    aboutCache.clear();
  }
  aboutCache.set(file, { fingerprint, metadata: result });
  log.debug("metadata.about.parsed", {
    file,
    packageId: result.packageId,
    hasAuthor: Boolean(result.author),
    dependencyCount: result.dependencies?.length,
    gameVersionCount: result.gameVersions?.length,
  });
  return { ...result };
}

export async function importInstalledSteamMods(
  discovery: WorkshopFolderDiscovery,
  progress?: (value: SteamOperationProgress) => void,
  fetchMetadata: typeof fetch = fetch,
): Promise<SteamImportResult> {
  const paths = new Map(discovery.folders.map((folder) => [folder.workshopId, folder.path]));
  const subscribedIds = [...paths.keys()];
  const libraries = discovery.steamLibraryPaths;
  log.info("steam.metadata.import.started", { subscribedCount: subscribedIds.length, libraries });
  const manifestPaths = discovery.manifestPaths;
  const warnings: string[] = [...discovery.warnings];
  const details = new Map<string, WorkshopDetail>();
  for (let index = 0; index < subscribedIds.length; index += steamLimits.metadataBatchSize) {
    const ids = subscribedIds.slice(index, index + steamLimits.metadataBatchSize);
    progress?.({
      message: "Refreshing Workshop metadata",
      completed: index,
      total: subscribedIds.length,
    });
    try {
      for (const detail of await fetchWorkshopDetails(ids, fetchMetadata)) {
        details.set(detail.publishedfileid, detail);
      }
    } catch (error) {
      log.warn("steam.metadata.batch.failed", {
        batchOffset: index,
        requestedCount: ids.length,
        error,
      });
      warnings.push((error as Error).message);
      break;
    }
  }
  const mods: Mod[] = [];
  const missingMetadataIds: string[] = [];
  if (subscribedIds.length) {
    progress?.({
      message: "Reading installed mod metadata",
      completed: 0,
      total: subscribedIds.length,
    });
  }
  let completedReads = 0;
  const localMetadata = await mapWithConcurrency(
    subscribedIds,
    steamLimits.localMetadataReadConcurrency,
    async (id) => {
      const path = paths.get(id);
      let about: Partial<Mod> = {};
      let warning: string | undefined;
      if (path) {
        try {
          about = await readAboutXml(path);
        } catch (error) {
          log.warn("steam.metadata.about.failed", { workshopId: id, path, error });
          warning = "Workshop " + id + ": " + (error as Error).message;
        }
      }
      const downloadedAt = path
        ? ((await stat(path).catch(() => undefined))?.mtime.toISOString() ?? "")
        : "";
      completedReads += 1;
      if (
        completedReads % metadataProgressInterval === 0 &&
        completedReads < subscribedIds.length
      ) {
        progress?.({
          message: "Reading installed mod metadata",
          completed: completedReads,
          total: subscribedIds.length,
        });
      }
      return { about, downloadedAt, warning };
    },
  );
  for (const [index, id] of subscribedIds.entries()) {
    const local = localMetadata[index];
    if (!local) {
      throw new Error("Installed Workshop metadata result was lost.");
    }
    if (local.warning) {
      warnings.push(local.warning);
    }
    const now = new Date().toISOString();
    const path = paths.get(id);
    const about = local.about;
    const detail = details.get(id);
    const normalized = detail ? normalizeWorkshopDetail(detail) : undefined;
    const remote = normalized?.status === "available" ? normalized.metadata : undefined;
    if (normalized && normalized.status !== "available") {
      warnings.push(`Workshop ${id}: ${normalized.message}`);
    }
    if (!remote || !about.packageId) {
      log.debug("steam.metadata.mod.incomplete", {
        workshopId: id,
        steamResult: detail?.result,
        metadataStatus: normalized?.status ?? "missing",
        installed: Boolean(path),
        hasPackageId: Boolean(about.packageId),
      });
    }
    if (!remote) {
      missingMetadataIds.push(id);
    }
    const thumbnail = remote?.thumbnail;
    mods.push({
      id: "steam-" + id,
      workshopId: id,
      packageId: about.packageId,
      name: about.name ?? remote?.name ?? "Workshop item " + id,
      author: about.author ?? "Unknown author",
      url: createSteamWorkshopUrl(id),
      source: modSources.steam,
      subscribed: true,
      summary: about.summary ?? remote?.summary ?? "Steam Workshop metadata imported.",
      dependencies: about.dependencies,
      gameVersions: about.gameVersions?.length ? about.gameVersions : (remote?.gameVersions ?? []),
      tags: remote ? (remote.tags ?? ["Steam"]) : ["Steam", "Metadata needed"],
      downloadedAt: local.downloadedAt,
      addedAt: now,
      thumbnail,
      screenshots: thumbnail ? [thumbnail] : [],
      localPath: path,
      metadataUpdatedAt: remote ? now : undefined,
      steamCreatorId: remote?.steamCreatorId,
      steamPublishedAt: remote?.steamPublishedAt,
      steamUpdatedAt: remote?.steamUpdatedAt,
      fileSize: remote?.fileSize,
    });
  }
  log.info("steam.metadata.import.completed", {
    importedCount: mods.length,
    missingMetadataCount: missingMetadataIds.length,
    warningCount: warnings.length,
    warnings,
  });
  return {
    mods,
    subscribedIds,
    discoveredIds: subscribedIds,
    manifestPaths,
    missingMetadataIds,
    steamLibraryPaths: libraries,
    warnings,
  };
}

export async function findSteamLibraries({
  includeUnavailable = false,
}: { includeUnavailable?: boolean } = {}): Promise<string[]> {
  const roots = [process.env.STEAM_DIR, process.env.STEAM_HOME];
  if (process.platform === platforms.macOS) {
    roots.push(join(homedir(), "Library", "Application Support", "Steam"));
  } else if (process.platform === platforms.windows) {
    roots.push(
      join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Steam"),
      join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Steam"),
    );
  } else {
    roots.push(join(homedir(), ".steam", "steam"), join(homedir(), ".local", "share", "Steam"));
  }
  const libraries = new Set<string>();
  for (const root of roots) {
    if (!root || !(await pathExists(root))) {
      continue;
    }
    libraries.add(basename(root) === "steamapps" ? join(root, "..") : root);
    for (const file of [
      join(root, "steamapps", steamLibraryIndexFileName),
      join(root, "config", steamLibraryIndexFileName),
    ]) {
      if (!(await pathExists(file))) {
        continue;
      }
      const parsed = parseVdf(await readFile(file, "utf8"));
      const folders = parsed.libraryfolders;
      if (!folders || typeof folders === "string") {
        continue;
      }
      for (const [key, value] of Object.entries(folders)) {
        if (!/^\d+$/.test(key)) {
          continue;
        }
        const path = typeof value === "string" ? value : value.path;
        if (typeof path === "string") {
          libraries.add(path);
        }
      }
    }
  }
  if (includeUnavailable) {
    return [...libraries];
  }
  const available: string[] = [];
  for (const library of libraries) {
    if (await pathExists(join(library, "steamapps"))) {
      available.push(library);
    }
  }
  return available;
}

export async function findRimWorldInstallations(libraries: string[]): Promise<string[]> {
  const paths: string[] = [];
  for (const library of libraries) {
    try {
      const manifest = parseVdf(
        await readFile(join(library, "steamapps", `appmanifest_${RIMWORLD_APP_ID}.acf`), "utf8"),
      );
      const state = manifest.AppState;
      const directory = typeof state === "object" ? state.installdir : undefined;
      if (
        typeof directory === "string" &&
        directory !== "." &&
        directory !== ".." &&
        basename(directory) === directory
      ) {
        paths.push(join(library, "steamapps", "common", directory));
      }
    } catch {
      /* A Steam library need not contain RimWorld. */
    }
  }
  return paths;
}

export function parseVdf(text: string): Record<string, VdfValue> {
  const tokens = Array.from(
    text.matchAll(/"((?:\\.|[^"\\])*)"|([{}])/g),
    (match) => match[1]?.replace(/\\\\/g, "\\").replace(/\\"/g, '"') ?? match[2],
  );
  let index = 0;
  function readObject(): Record<string, VdfValue> {
    const object: Record<string, VdfValue> = {};
    while (index < tokens.length && tokens[index] !== "}") {
      const key = tokens[index++];
      const value = tokens[index++];
      if (key === undefined || value === undefined) {
        break;
      }
      object[key] = value === "{" ? readObject() : value;
    }
    if (tokens[index] === "}") {
      index++;
    }
    return object;
  }
  return readObject();
}
