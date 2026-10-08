import { contextBridge, ipcRenderer } from "electron";

import {
  type IpcArgs,
  type IpcChannel,
  ipcChannels,
  ipcEvents,
  type IpcResult,
  preloadApiNames,
} from "../shared/ipc";
import type { AppDiagnosticsApi } from "../shared/logging";
import type { ModStoreApi, SteamOperationProgress } from "../shared/types";

function invoke<Channel extends IpcChannel>(
  channel: Channel,
  ...args: IpcArgs<Channel>
): Promise<IpcResult<Channel>> {
  // Electron erases response types; the main registry enforces this shared contract.
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<Channel>>;
}

const modStore: ModStoreApi = {
  openLogs: () => invoke(ipcChannels.openLogs),
  openDatabaseFolder: () => invoke(ipcChannels.openDatabaseFolder),
  revealModFolder: (id) => invoke(ipcChannels.revealModFolder, id),
  openWorkshopInBrowser: (id) => invoke(ipcChannels.openWorkshopInBrowser, id),
  load: () => invoke(ipcChannels.load),
  save: (vault, options) => invoke(ipcChannels.save, vault, options),
  deleteLibraryMods: (ids) => invoke(ipcChannels.deleteLibraryMods, ids),
  refreshModMetadata: (id) => invoke(ipcChannels.refreshModMetadata, id),
  chooseRimWorldConfigPath: () => invoke(ipcChannels.chooseRimWorldConfigPath),
  chooseWorkshopModsPath: (defaultPath) => invoke(ipcChannels.chooseWorkshopModsPath, defaultPath),
  detectWorkshopModsPath: () => invoke(ipcChannels.detectWorkshopModsPath),
  validateWorkshopModsPath: (path) => invoke(ipcChannels.validateWorkshopModsPath, path),
  getActiveMods: (settings) => invoke(ipcChannels.getActiveMods, settings),
  syncSubscribedMods: () => invoke(ipcChannels.syncSubscribedMods),
  refreshSubscriptions: () => invoke(ipcChannels.refreshSubscriptions),
  inspectWorkshopStatus: () => invoke(ipcChannels.inspectWorkshopStatus),
  getSteamStatus: () => invoke(ipcChannels.getSteamStatus),
  previewLibrarySubscriptions: (action, ids) =>
    invoke(ipcChannels.previewLibrarySubscriptions, action, ids),
  setSubscription: (id, subscribed, expectedWorkshopId) =>
    invoke(ipcChannels.setSubscription, id, subscribed, expectedWorkshopId),
  onSteamProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: SteamOperationProgress) => {
      listener(progress);
    };
    ipcRenderer.on(ipcEvents.steamProgress, handler);
    return () => {
      ipcRenderer.removeListener(ipcEvents.steamProgress, handler);
    };
  },
  onBeforeClose: (listener) => {
    const handler = () => {
      listener()
        .then(() => {
          ipcRenderer.send(ipcEvents.closeReady);
        })
        .catch((error: unknown) => {
          ipcRenderer.send(ipcEvents.closeReady, String(error));
        });
    };
    ipcRenderer.on(ipcEvents.beforeClose, handler);
    return () => {
      ipcRenderer.removeListener(ipcEvents.beforeClose, handler);
    };
  },
};
contextBridge.exposeInMainWorld(preloadApiNames.modStore, modStore);
const diagnostics: AppDiagnosticsApi = {
  reportError: (event, details) => {
    ipcRenderer.send(ipcEvents.rendererError, event, details);
  },
};
contextBridge.exposeInMainWorld(preloadApiNames.diagnostics, diagnostics);
