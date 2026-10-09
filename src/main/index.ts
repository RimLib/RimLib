import { cpus, release, totalmem, version } from "node:os";
import { join } from "node:path";

import { app, BrowserWindow, dialog, ipcMain, screen, shell } from "electron";

import rimLibAppIcon from "../../assets/rimlib-app-icon.png?asset";
import { applicationName } from "../shared/application";
import { hasConstantValue } from "../shared/domainConstants";
import {
  type IpcArgs,
  type IpcChannel,
  ipcChannels,
  ipcEvents,
  type IpcResult,
  validateIpcArgs,
} from "../shared/ipc";
import { bytesPerMiB } from "../shared/limits";
import { loggingLimits, logLevels, rendererErrorEvents } from "../shared/logging";
import { getModWorkshopId } from "../shared/steam";
import { vaultFileName } from "../shared/storage";
import type { AppSettings, ModVault, SubscriptionAction, VaultSaveOptions } from "../shared/types";
import { isRecord } from "../shared/validation";
import { configureApplicationIdentity } from "./applicationIdentity";
import { getActiveModsView } from "./installedMods";
import { deleteLibraryMods } from "./libraryActions";
import {
  captureConsole,
  captureProcessDiagnostics,
  log,
  loggedOperation,
  SessionLogger,
  setSessionLogger,
} from "./logging";
import { openDatabaseFolder, openWorkshopInBrowser, revealModFolder } from "./modActions";
import { platforms, windowDefaults } from "./platformConstants";
import { assertSteamRunning, getSteamStatus } from "./steamAvailability";
import { SteamOperations } from "./steamOperations";
import { detectWorkshopModsPath, validateWorkshopModsPath } from "./steamWorkshop";
import { VaultStore } from "./vaultStore";
import { WindowCloseLifecycle } from "./windowCloseLifecycle";
import { refreshModMetadata } from "./workshopMetadata";

try {
  configureApplicationIdentity(app);
} catch (error) {
  dialog.showErrorBox("Cannot open RimLib data", String(error));
  app.exit(1);
  throw new Error("Cannot initialize RimLib storage.", { cause: error });
}

let logger: SessionLogger | undefined;
const originalConsoleError = console.error.bind(console);
try {
  app.setAppLogsPath();
  logger = new SessionLogger({
    directory: app.getPath("logs"),
    pruneOnStart: false,
    startup: {
      application: { name: app.getName(), version: app.getVersion(), packaged: app.isPackaged },
      platform: {
        os: process.platform,
        architecture: process.arch,
        release: release(),
        version: version(),
        cpu: cpus()[0]?.model,
        cpuCount: cpus().length,
        memoryMiB: Math.round(totalmem() / bytesPerMiB),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      runtime: {
        electron: process.versions.electron,
        node: process.versions.node,
        chromium: process.versions.chrome,
        v8: process.versions.v8,
      },
      paths: {
        logs: app.getPath("logs"),
        userData: app.getPath("userData"),
        database: join(app.getPath("userData"), vaultFileName),
      },
      policy: {
        level: logLevels.debug,
        maxFileMiB: loggingLimits.maxFileBytes / bytesPerMiB,
        filesPerSession: 3,
        maxSessions: loggingLimits.maxSessions,
        retentionDays: loggingLimits.retentionDays,
      },
    },
    onError: (error) => {
      originalConsoleError("File logging failed; database operations were not interrupted.", error);
    },
  });
  setSessionLogger(logger);
  captureConsole(logger);
} catch (error) {
  originalConsoleError("Cannot initialize application logs.", error);
}

if (logger) {
  captureProcessDiagnostics(logger);
}
app.on("child-process-gone", (_event, details) =>
  log.error("electron.child-process-gone", details),
);
app.on("quit", (_event, exitCode) => {
  logger?.write(logLevels.info, "app.session.ended", { exitCode });
  logger?.close();
});

function requestSummary(channel: IpcChannel, args: unknown[]) {
  const value = isRecord(args[0]) ? args[0] : undefined;
  if (channel === ipcChannels.save) {
    const settings = isRecord(value?.settings) ? value.settings : undefined;
    const workshopModsPath =
      typeof settings?.workshopModsPath === "string" ? settings.workshopModsPath : null;
    return {
      modCount: Array.isArray(value?.mods) ? value.mods.length : undefined,
      tagCount: Array.isArray(value?.userTags) ? value.userTags.length : undefined,
      options: args[1],
      workshopModsPath,
      workshopSource: workshopModsPath ? "configured-folder" : "steam-libraries",
    };
  }
  if (channel === ipcChannels.getActiveMods) {
    return { settings: args[0] };
  }
  if (
    channel === ipcChannels.chooseWorkshopModsPath ||
    channel === ipcChannels.validateWorkshopModsPath
  ) {
    return { workshopModsPath: args[0] };
  }
  if (channel === ipcChannels.previewLibrarySubscriptions) {
    return { action: args[0], requestedCount: Array.isArray(args[1]) ? args[1].length : undefined };
  }
  if (channel === ipcChannels.setSubscription) {
    return { modId: args[0], subscribed: args[1] };
  }
  if (channel === ipcChannels.revealModFolder) {
    return { modId: args[0] };
  }
  if (channel === ipcChannels.refreshModMetadata) {
    return { modId: args[0] };
  }
  if (channel === ipcChannels.deleteLibraryMods) {
    return { requestedCount: Array.isArray(args[0]) ? args[0].length : undefined };
  }
  if (channel === ipcChannels.openWorkshopInBrowser) {
    return { workshopId: args[0] };
  }
  return {};
}

type IpcHandler<Channel extends IpcChannel> = (
  ...args: IpcArgs<Channel>
) => Promise<IpcResult<Channel>>;

function handle<Channel extends IpcChannel>(channel: Channel, handler: IpcHandler<Channel>) {
  ipcMain.handle(channel, (event, ...args: unknown[]) =>
    loggedOperation(logger, channel, requestSummary(channel, args), () => {
      if (
        event.sender !== mainWindow?.webContents ||
        event.senderFrame !== mainWindow.webContents.mainFrame
      ) {
        throw new Error("This request did not come from the application window.");
      }
      validateIpcArgs(channel, args);
      return handler(...args);
    }),
  );
}

function handleSteamAction<Channel extends IpcChannel>(
  channel: Channel,
  handler: IpcHandler<Channel>,
) {
  handle(channel, async (...args): Promise<IpcResult<Channel>> => {
    await assertSteamRunning();
    return await handler(...args);
  });
}

let mainWindow: BrowserWindow | null = null;
let quitRequested = false;
const rendererConsoleLevels = Object.freeze({
  debug: logLevels.debug,
  info: logLevels.info,
  warning: logLevels.warn,
  error: logLevels.error,
});
app.on("before-quit", () => {
  quitRequested = true;
  log.info("app.quit.requested");
  logger?.flush();
});
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  log.info("app.second-instance.exiting");
  app.quit();
} else {
  logger?.prune();
}
app.on("second-instance", () => {
  log.info("app.second-instance.focused");
  mainWindow?.restore();
  mainWindow?.focus();
});

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    ...windowDefaults,
    icon: rimLibAppIcon,
    title: applicationName,
    backgroundColor: "#101318",
    show: false,
    titleBarStyle: process.platform === platforms.macOS ? "hiddenInset" : "default",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow = window;
  const contents = window.webContents;
  const closeLifecycle = new WindowCloseLifecycle({
    rendererSender: contents,
    isRendererSenderFrame: (senderFrame) =>
      !contents.isDestroyed() && senderFrame === contents.mainFrame,
    isRendererDestroyed: () => contents.isDestroyed(),
    requestRendererSave: () => {
      contents.send(ipcEvents.beforeClose);
    },
    closeWindow: () => {
      if (!window.isDestroyed()) {
        window.close();
      }
    },
    listenForWindowClose: (listener) => {
      window.on("close", listener);
      return () => window.removeListener("close", listener);
    },
    listenForWindowClosed: (listener) => {
      window.once("closed", listener);
      return () => window.removeListener("closed", listener);
    },
    listenForCloseReady: (listener) => {
      const handler = (event: Electron.IpcMainEvent, error?: unknown) => {
        listener(event.sender, event.senderFrame, error);
      };
      ipcMain.on(ipcEvents.closeReady, handler);
      return () => ipcMain.removeListener(ipcEvents.closeReady, handler);
    },
    isQuitRequested: () => quitRequested,
    resumeQuit: () => {
      app.quit();
    },
    callbacks: {
      onAwaitingSave: () => log.info("window.close.awaiting-saves"),
      onSaveFailed: (error) => {
        log.error("window.close.save-failed", { error });
        quitRequested = false;
        dialog.showErrorBox(
          "Database preserved",
          `The window was kept open because saving failed. ${error}`,
        );
      },
      onSavesCompleted: () => {
        log.info("window.close.saves-completed");
        logger?.flush();
      },
      onRendererUnavailable: (reason) => log.error("renderer.unavailable", { reason }),
      onCloseWithoutSave: (reason) => {
        log.error("window.close.without-renderer-save", {
          reason,
          database: "preserved-on-disk",
        });
        logger?.flush();
        dialog.showErrorBox(
          "Database preserved",
          "The renderer became unavailable, so RimLib could not confirm that all in-memory changes were saved. The existing on-disk database was preserved.",
        );
      },
      onClosed: () => {
        log.info("window.closed");
        logger?.flush();
        if (mainWindow === window) {
          mainWindow = null;
        }
      },
    },
  });
  contents.setWindowOpenHandler(({ url }) => {
    const workshopId = getModWorkshopId({ url });
    if (workshopId) {
      void openWorkshopInBrowser(workshopId, shell).catch((error: unknown) =>
        log.error("mod.workshop.open-failed", { workshopId, error }),
      );
    }
    return { action: "deny" };
  });
  log.info("window.created", { webContentsId: contents.id, size: window.getSize() });
  contents.on("console-message", ({ level, message, lineNumber, sourceId }) =>
    logger?.write(
      rendererConsoleLevels[level],
      "console.message",
      { message, line: lineNumber, source: sourceId },
      "renderer",
    ),
  );
  contents.on("preload-error", (_event, path, error) => {
    log.error("renderer.preload.failed", { path, error });
    closeLifecycle.rendererUnavailable("preload-error");
  });
  contents.on("render-process-gone", (_event, details) => {
    log.error("renderer.process.gone", details);
    closeLifecycle.rendererUnavailable("render-process-gone");
  });
  contents.on("did-fail-load", (_event, errorCode, errorDescription, url, isMainFrame) => {
    log.error("renderer.load.failed", { errorCode, errorDescription, url, isMainFrame });
    if (isMainFrame) {
      closeLifecycle.rendererUnavailable("load-failed");
    }
  });
  contents.once("destroyed", () => {
    closeLifecycle.rendererUnavailable("web-contents-destroyed");
  });
  contents.on("did-finish-load", () => log.info("renderer.loaded"));
  window.on("unresponsive", () => log.warn("window.unresponsive"));
  window.on("responsive", () => log.info("window.responsive"));
  window.once("ready-to-show", () => {
    window.show();
  });
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app
  .whenReady()
  .then(async () => {
    if (!singleInstance) {
      return;
    }
    app.dock?.setIcon(rimLibAppIcon);
    log.info("app.ready", {
      locale: app.getLocale(),
      displays: screen
        .getAllDisplays()
        .map((display) => ({ size: display.size, scaleFactor: display.scaleFactor })),
      gpu: app.getGPUFeatureStatus(),
    });
    ipcMain.on(ipcEvents.rendererError, (event, name: unknown, details: unknown) => {
      if (
        event.sender !== mainWindow?.webContents ||
        typeof name !== "string" ||
        !hasConstantValue(rendererErrorEvents, name) ||
        !isRecord(details) ||
        typeof details.message !== "string"
      ) {
        return;
      }
      logger?.write(
        logLevels.error,
        name,
        {
          message: details.message.slice(0, loggingLimits.maxStringLength),
          stack:
            typeof details.stack === "string"
              ? details.stack.slice(0, loggingLimits.maxStringLength)
              : undefined,
          source:
            typeof details.source === "string"
              ? details.source.slice(0, loggingLimits.maxSourceLength)
              : undefined,
          line: typeof details.line === "number" ? details.line : undefined,
          column: typeof details.column === "number" ? details.column : undefined,
        },
        "renderer",
      );
    });
    const store = new VaultStore(join(app.getPath("userData"), vaultFileName));
    const steam = new SteamOperations(store, (progress) => {
      log.debug("steam.progress", {
        message: progress.message,
        completed: progress.completed,
        total: progress.total,
      });
      mainWindow?.webContents.send(ipcEvents.steamProgress, progress);
    });
    handle(ipcChannels.load, () => store.load());
    handle(ipcChannels.openDatabaseFolder, () => openDatabaseFolder(store.path, shell));
    handle(ipcChannels.revealModFolder, async (id: string) =>
      revealModFolder(id, await store.load(), shell),
    );
    handle(ipcChannels.openWorkshopInBrowser, (id: string) => openWorkshopInBrowser(id, shell));
    handle(ipcChannels.save, (vault: ModVault, options?: VaultSaveOptions) =>
      store.save(vault, options),
    );
    handle(ipcChannels.deleteLibraryMods, (ids: string[]) => deleteLibraryMods(store, ids));
    handle(ipcChannels.refreshModMetadata, (id: string) => refreshModMetadata(store, id));
    handle(ipcChannels.chooseRimWorldConfigPath, async () => {
      if (!mainWindow) {
        return null;
      }
      const result = await dialog.showOpenDialog(mainWindow, {
        title: "Select RimWorld ModsConfig.xml",
        properties: ["openFile", "showHiddenFiles"],
        filters: [{ name: "RimWorld configuration", extensions: ["xml"] }],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    });
    handle(ipcChannels.detectWorkshopModsPath, () => detectWorkshopModsPath());
    handle(ipcChannels.validateWorkshopModsPath, (path: string) => validateWorkshopModsPath(path));
    handle(ipcChannels.chooseWorkshopModsPath, async (defaultPath?: string) => {
      if (!mainWindow) {
        return null;
      }
      const result = await dialog.showOpenDialog(mainWindow, {
        title: "Select RimWorld Workshop mods folder (294100)",
        properties: ["openDirectory", "showHiddenFiles"],
        defaultPath: typeof defaultPath === "string" ? defaultPath : undefined,
      });
      return result.canceled || !result.filePaths[0]
        ? null
        : validateWorkshopModsPath(result.filePaths[0]);
    });
    handle(ipcChannels.openLogs, async () => {
      if (!logger) {
        throw new Error(
          "File logging is unavailable. Check the app terminal for the logging error.",
        );
      }
      logger.flush();
      if (logger.failure) {
        throw new Error(
          "File logging is unavailable. Check the app terminal for the logging error.",
        );
      }
      const error = await shell.openPath(logger.directory);
      if (error) {
        throw new Error(error);
      }
    });
    handle(ipcChannels.getActiveMods, (settings?: AppSettings) => getActiveModsView(settings));
    handle(ipcChannels.syncSubscribedMods, () => steam.syncSubscribedMods());
    handle(ipcChannels.refreshSubscriptions, () => steam.refreshSubscriptions());
    handle(ipcChannels.inspectWorkshopStatus, () => steam.inspectWorkshopStatus());
    handle(ipcChannels.getSteamStatus, () => getSteamStatus());
    handleSteamAction(
      ipcChannels.previewLibrarySubscriptions,
      (action: SubscriptionAction, ids: string[]) => steam.previewLibrarySubscriptions(action, ids),
    );
    handleSteamAction(
      ipcChannels.setSubscription,
      (id: string, subscribed: boolean, expectedWorkshopId?: string) =>
        steam.setSubscription(id, subscribed, expectedWorkshopId),
    );
    await createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow().catch((error: unknown) => log.error("window.create.failed", { error }));
      }
    });
  })
  .catch((error: unknown) => {
    log.error("app.startup.failed", { error });
    logger?.flush();
    dialog.showErrorBox("Application startup failed", String(error));
    app.quit();
  });
app.on("window-all-closed", () => {
  if (process.platform !== platforms.macOS) {
    app.quit();
  }
});
