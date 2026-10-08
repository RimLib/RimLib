import { createSteamWorkshopUrl } from "../../../shared/steam";
import { browserStorageKeys } from "../../../shared/storage";
import type { ModStoreApi } from "../../../shared/types";
import {
  deleteLibraryModsExplicitly,
  mergeVaultSave,
  normalizeVault,
  serializeVault,
} from "../../../shared/vault";
import { emptyVault } from "../data/defaults";

// Preserve the asynchronous IPC contract, including rejected (rather than thrown) errors.
function browserAction<T>(action: () => T): Promise<T> {
  return Promise.resolve().then(action);
}
const unavailable = (message: string) => Promise.reject(new Error(message));
const nativeOnly = () =>
  unavailable("This action requires the Electron desktop app and the running Steam client.");

function removeLibraryMods(ids: string[]) {
  return browserAction(() => {
    const raw = window.localStorage.getItem(browserStorageKeys.vault);
    if (!raw) {
      throw new Error("Database not loaded.");
    }
    const next = deleteLibraryModsExplicitly(normalizeVault(JSON.parse(raw)), ids);
    window.localStorage.setItem(browserStorageKeys.vaultBackup, raw);
    window.localStorage.setItem(browserStorageKeys.vault, JSON.stringify(serializeVault(next)));
    return next;
  });
}

function getBrowserStore(): ModStoreApi {
  return {
    openLogs: nativeOnly,
    openDatabaseFolder: () =>
      unavailable("Opening the database folder requires the Electron desktop app."),
    revealModFolder: () => unavailable("Revealing a mod folder requires the Electron desktop app."),
    openWorkshopInBrowser: (id) =>
      browserAction(() => {
        window.open(createSteamWorkshopUrl(id), "_blank", "noopener,noreferrer");
      }),
    load: () =>
      browserAction(() => {
        const raw = window.localStorage.getItem(browserStorageKeys.vault);
        return normalizeVault(raw ? JSON.parse(raw) : emptyVault);
      }),
    save: (vault, options) =>
      browserAction(() => {
        const raw = window.localStorage.getItem(browserStorageKeys.vault);
        const next = mergeVaultSave(
          raw ? normalizeVault(JSON.parse(raw)) : emptyVault,
          vault,
          options,
        );
        if (raw) {
          window.localStorage.setItem(browserStorageKeys.vaultBackup, raw);
        }
        window.localStorage.setItem(browserStorageKeys.vault, JSON.stringify(serializeVault(next)));
        return next;
      }),
    deleteLibraryMods: removeLibraryMods,
    refreshModMetadata: () =>
      unavailable(
        "Metadata refresh requires the Electron desktop app and an internet connection, but not the Steam client.",
      ),
    chooseRimWorldConfigPath: () => Promise.resolve(null),
    chooseWorkshopModsPath: () => Promise.resolve(null),
    detectWorkshopModsPath: () => Promise.resolve(null),
    validateWorkshopModsPath: () =>
      unavailable("Workshop folder selection requires the Electron desktop app."),
    getActiveMods: () =>
      Promise.resolve({ packageIds: [], error: "Active mods require the Electron desktop app." }),
    getSteamStatus: () =>
      Promise.resolve({
        running: false,
        error: "Steam subscriptions require the Electron desktop app.",
      }),
    syncSubscribedMods: nativeOnly,
    refreshSubscriptions: nativeOnly,
    previewLibrarySubscriptions: nativeOnly,
    inspectWorkshopStatus: () =>
      unavailable("Workshop folder inspection requires the Electron desktop app."),
    setSubscription: nativeOnly,
  };
}
const browserStore = getBrowserStore();
export function getStore(): ModStoreApi {
  return window.modStore ?? browserStore;
}
