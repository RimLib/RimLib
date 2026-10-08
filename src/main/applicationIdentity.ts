import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { App } from "electron";

import { applicationName } from "../shared/application";
import { desktopStorageDirectoryName } from "../shared/storage";
import { privateDirectoryMode } from "./platformConstants";

export function configureApplicationIdentity(
  app: Pick<App, "getName" | "getPath" | "setName" | "setPath">,
): void {
  const appData = app.getPath("appData");
  const userData = app.getPath("userData");
  // Keep explicitly configured locations, including isolated test sessions.
  if (userData === join(appData, app.getName())) {
    const storage = join(appData, desktopStorageDirectoryName);
    const sessionData = app.getPath("sessionData");
    mkdirSync(storage, { recursive: true, mode: privateDirectoryMode });
    app.setPath("userData", storage);
    if (sessionData === userData) {
      app.setPath("sessionData", storage);
    }
  }
  app.setName(applicationName);
}
