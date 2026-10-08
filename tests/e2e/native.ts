import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  getActiveModsView as readActiveView,
  InstalledModIndex,
} from "../../src/main/installedMods";
import { getActiveMods as readActiveMods } from "../../src/main/rimWorldConfig";
import {
  type SteamClient,
  SteamRequestTimeoutError,
  withTimeout,
} from "../../src/main/steamClient";
import {
  discoverWorkshopFolders as discover,
  importInstalledSteamMods,
  normalizeWorkshopModsPath,
  readAboutXml as readAbout,
  validateWorkshopModsPath as validatePath,
} from "../../src/main/steamWorkshop";
import type { ActiveModsState, AppSettings } from "../../src/shared/types";
import { changeSubscription, checkedPath, controls, paths, record } from "./control";

export {
  importInstalledSteamMods,
  normalizeWorkshopModsPath,
  SteamRequestTimeoutError,
  withTimeout,
};

export async function getSteamStatus() {
  return controls().steamRunning
    ? { running: true }
    : { running: false, error: "Start Steam and sign in before changing mod subscriptions." };
}

export async function assertSteamRunning(): Promise<void> {
  if (!controls().steamRunning) {
    throw new Error("Start Steam and sign in before changing mod subscriptions.");
  }
}

const client: SteamClient = {
  async refreshSubscribedIds() {
    await assertSteamRunning();
    return controls().subscribedIds;
  },
  subscribedIds: () => controls().subscribedIds,
  installPath: (id) => {
    if (!/^\d+$/.test(id)) {
      throw new Error("Invalid fixture Workshop ID");
    }
    const path = join(paths.workshop, id);
    return existsSync(path) ? path : undefined;
  },
  async subscribe(id) {
    changeSubscription(id, true);
  },
  async unsubscribe(id) {
    changeSubscription(id, false);
  },
};

export function getSteamClient(): SteamClient {
  return client;
}

export async function assertGameClosed(): Promise<void> {
  if (controls().gameRunning) {
    throw new Error("Close RimWorld before changing subscriptions.");
  }
}

function configuredPath(value: string | undefined, fallback: string): string {
  const path = value?.trim();
  return checkedPath(path === undefined || path === "" ? fallback : path);
}

export async function getActiveMods(settings: AppSettings = {}): Promise<ActiveModsState> {
  return readActiveMods({
    ...settings,
    rimWorldConfigPath: configuredPath(settings.rimWorldConfigPath, paths.config),
  });
}

export async function readAboutXml(path: string) {
  return readAbout(checkedPath(path));
}

export async function discoverWorkshopFolders(_libraries?: string[], settings: AppSettings = {}) {
  const path = configuredPath(settings.workshopModsPath, paths.workshop);
  record("scan", path);
  return discover([], {
    ...settings,
    workshopModsPath: path,
  });
}

const installed = new InstalledModIndex(0);

export async function getActiveModsView(settings: AppSettings = {}): Promise<ActiveModsState> {
  return readActiveView(settings, () =>
    installed.read([], configuredPath(settings.workshopModsPath, paths.workshop)),
  );
}

export async function validateWorkshopModsPath(path: string): Promise<string> {
  return validatePath(checkedPath(path));
}

export async function detectWorkshopModsPath(): Promise<string | null> {
  return paths.workshop;
}

export async function findSteamLibraries(): Promise<string[]> {
  return [];
}

export async function findRimWorldInstallations(): Promise<string[]> {
  return [];
}
