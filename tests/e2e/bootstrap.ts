import { app, BaseWindow, dialog, ipcMain, type OpenDialogOptions, session, shell } from "electron";

import { type IpcChannel, ipcEvents } from "../../src/shared/ipc";
import { publishedFileDetailsUrl, RIMWORLD_APP_ID, steamResultCodes } from "../../src/shared/steam";
import { checkedPath, controls, paths, record } from "./control";

app.setPath("userData", paths.userData);
app.setPath("sessionData", paths.session);
const setLogsPath = app.setAppLogsPath.bind(app);
app.setAppLogsPath = () => {
  setLogsPath(paths.logs);
};

shell.openPath = async (path) => {
  record("openPath", checkedPath(path));
  return controls().shellError;
};
shell.showItemInFolder = (path) => {
  record("reveal", checkedPath(path));
  if (controls().shellError) {
    throw new Error(controls().shellError);
  }
};
shell.openExternal = async (url) => {
  record("openExternal", url);
  if (controls().shellError) {
    throw new Error(controls().shellError);
  }
};
dialog.showErrorBox = (title, content) => {
  record("errorBox", `${title}: ${content}`);
};
const showOpenDialog = async (
  windowOrOptions: BaseWindow | OpenDialogOptions,
  suppliedOptions?: OpenDialogOptions,
) => {
  const options = windowOrOptions instanceof BaseWindow ? suppliedOptions : windowOrOptions;
  const path = options?.properties?.includes("openDirectory") ? paths.workshop : paths.config;
  record("dialog", path);
  return { canceled: controls().cancelDialog, filePaths: [path] };
};
dialog.showOpenDialog = showOpenDialog;

ipcMain.on(ipcEvents.rendererError, (_event, name: unknown, details: unknown) => {
  record("rendererError", JSON.stringify({ name, details }));
});

const register = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => {
  register(channel, async (event, ...args: unknown[]) => {
    record("ipc", channel);
    const current = controls();
    const delay = current.ipcDelays[channel as IpcChannel];
    if (delay) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    const error = current.ipcErrors[channel as IpcChannel];
    if (error) {
      throw new Error(error);
    }
    const result: unknown = await listener(event, ...args);
    return result;
  });
};

globalThis.fetch = async (input, init) => {
  if (input !== publishedFileDetailsUrl || !(init?.body instanceof URLSearchParams)) {
    throw new Error("Unexpected network request blocked by the Electron E2E harness.");
  }
  record("metadata", init.body.toString());
  const current = controls();
  const details = [...init.body.entries()]
    .filter(([key]) => key.startsWith("publishedfileids["))
    .map(([, id]) => ({
      publishedfileid: id,
      result: steamResultCodes.ok,
      consumer_app_id: RIMWORLD_APP_ID,
      title: `Workshop refreshed ${id}`,
      description: `Public metadata for ${id}`,
      preview_url: `https://e2e.invalid/previews/${id}.png`,
      tags: [{ tag: "1.6" }, { tag: "Mod" }],
    }));
  return new Response(JSON.stringify({ response: { publishedfiledetails: details } }), {
    status: current.metadataStatus,
    headers: { "Content-Type": "application/json" },
  });
};

// Playwright holds app.whenReady() until it connects to Electron's Node and Chromium debuggers.
// Awaiting it at module scope would therefore deadlock electron.launch(). Register synchronously
// before importing the real main process so network isolation is installed before its ready work.
app.once("ready", () => {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*"] },
    (_details, callback) => {
      callback({ cancel: true });
    },
  );
});

// Load the real lifecycle, IPC handlers and persistence only after isolation is in place.
await import("../../src/main/index");
