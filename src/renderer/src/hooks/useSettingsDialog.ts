import { type SyntheticEvent, useRef, useState } from "react";

import type {
  ActiveModsState,
  AppSettings,
  FirebaseSyncSettings,
  ModVault,
} from "../../../shared/types";
import { getStore } from "../services/modStore";
import { persistSettings } from "../services/settings";
import { errorMessage } from "../utils/errors";
import type { useActionNotifications } from "./useActionNotifications";
import type { useFirebaseSync } from "./useFirebaseSync";

interface SettingsDialogDependencies {
  settings: AppSettings;
  loaded: boolean;
  busy: boolean;
  run: <T>(action: () => Promise<T>) => Promise<T>;
  adopt: (vault: ModVault) => void;
  adoptActive: (active: ActiveModsState) => void;
  notifyError: (error: unknown) => void;
  perform: ReturnType<typeof useActionNotifications>["perform"];
  setNotice: (message: string) => void;
  firebaseSync: ReturnType<typeof useFirebaseSync>;
}

const emptyFirebaseSettings: FirebaseSyncSettings = {
  enabled: false,
  apiKey: "",
  authDomain: "",
  projectId: "",
  appId: "",
  email: "",
};

export function useSettingsDialog({
  settings,
  loaded,
  busy,
  run,
  adopt,
  adoptActive,
  notifyError,
  perform,
  setNotice,
  firebaseSync,
}: SettingsDialogDependencies) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [configPath, setConfigPath] = useState("");
  const [choosingPath, setChoosingPath] = useState(false);
  const [workshopPath, setWorkshopPath] = useState("");
  const [detectingWorkshopPath, setDetectingWorkshopPath] = useState(false);
  const [testingWorkshopPath, setTestingWorkshopPath] = useState(false);
  const [workshopAccessPath, setWorkshopAccessPath] = useState<string>();
  const [settingsError, setSettingsError] = useState("");
  const [firebaseSettings, setFirebaseSettings] =
    useState<FirebaseSyncSettings>(emptyFirebaseSettings);
  const [firebasePassword, setFirebasePassword] = useState("");
  const settingsRequest = useRef(0);
  const folderTestRequest = useRef(0);

  async function browseConfig() {
    const request = settingsRequest.current;
    setChoosingPath(true);
    try {
      const path = await getStore().chooseRimWorldConfigPath();
      if (path && request === settingsRequest.current) {
        setConfigPath(path);
      }
    } catch (error) {
      if (request === settingsRequest.current) {
        showSettingsError(error);
      }
    } finally {
      if (request === settingsRequest.current) {
        setChoosingPath(false);
      }
    }
  }

  function showSettingsError(error: unknown) {
    setSettingsError(errorMessage(error));
    notifyError(error);
  }

  async function openSettings() {
    if (!loaded || busy) {
      return;
    }
    const request = ++settingsRequest.current;
    folderTestRequest.current++;
    setConfigPath(settings.rimWorldConfigPath ?? "");
    setWorkshopPath(settings.workshopModsPath ?? "");
    setWorkshopAccessPath(undefined);
    setTestingWorkshopPath(false);
    setSettingsError("");
    setFirebaseSettings({ ...emptyFirebaseSettings, ...settings.firebaseSync });
    setFirebasePassword("");
    setChoosingPath(false);
    setSettingsOpen(true);
    setDetectingWorkshopPath(false);
    if (settings.workshopModsPath) {
      return;
    }
    setDetectingWorkshopPath(true);
    try {
      const detected = await getStore().detectWorkshopModsPath();
      if (request === settingsRequest.current) {
        setWorkshopPath(detected ?? "");
      }
    } catch (error) {
      if (request === settingsRequest.current) {
        showSettingsError(error);
      }
    } finally {
      if (request === settingsRequest.current) {
        setDetectingWorkshopPath(false);
      }
    }
  }

  function closeSettings() {
    settingsRequest.current++;
    folderTestRequest.current++;
    setSettingsOpen(false);
  }

  function changeWorkshopPath(path: string) {
    folderTestRequest.current++;
    setWorkshopPath(path);
    setWorkshopAccessPath(undefined);
    setTestingWorkshopPath(false);
    setSettingsError("");
  }

  async function detectWorkshop() {
    const request = ++settingsRequest.current;
    setDetectingWorkshopPath(true);
    setSettingsError("");
    try {
      const path = await getStore().detectWorkshopModsPath();
      if (request === settingsRequest.current) {
        if (path) {
          changeWorkshopPath(path);
        } else {
          showSettingsError("No readable Workshop folder was found.");
        }
      }
    } catch (error) {
      if (request === settingsRequest.current) {
        showSettingsError(error);
      }
    } finally {
      if (request === settingsRequest.current) {
        setDetectingWorkshopPath(false);
      }
    }
  }

  async function testWorkshopAccess() {
    const request = ++folderTestRequest.current;
    setTestingWorkshopPath(true);
    setWorkshopAccessPath(undefined);
    setSettingsError("");
    try {
      const path = await getStore().validateWorkshopModsPath(workshopPath);
      if (request === folderTestRequest.current) {
        setWorkshopAccessPath(path);
      }
    } catch (error) {
      if (request === folderTestRequest.current) {
        showSettingsError(error);
      }
    } finally {
      if (request === folderTestRequest.current) {
        setTestingWorkshopPath(false);
      }
    }
  }

  async function browseWorkshop() {
    const request = settingsRequest.current;
    setChoosingPath(true);
    setSettingsError("");
    try {
      const path = await getStore().chooseWorkshopModsPath(workshopPath || undefined);
      if (path && request === settingsRequest.current) {
        changeWorkshopPath(path);
        setWorkshopAccessPath(path);
      }
    } catch (error) {
      if (request === settingsRequest.current) {
        showSettingsError(error);
      }
    } finally {
      if (request === settingsRequest.current) {
        setChoosingPath(false);
      }
    }
  }

  async function saveSettings(event: SyntheticEvent) {
    event.preventDefault();
    setSettingsError("");
    let firebaseAttempted = false;
    try {
      let workshopPathChanged = false;
      await run(async () => {
        const result = await persistSettings(
          getStore(),
          configPath,
          workshopPath,
          firebaseSettings,
        );
        workshopPathChanged = result.workshopPathChanged;
        adopt(result.vault);
        if (workshopPathChanged && window.modStore) {
          try {
            const result = await getStore().refreshSubscriptions();
            adopt(result.vault);
            adoptActive(result.activeMods);
            if (result.failures.length) {
              setNotice("Settings saved; some Workshop updates failed");
              notifyError(result.failures.join("; "));
            } else if (result.warnings?.length) {
              setNotice(`Settings saved. ${result.warnings.join("; ")}`);
            }
          } catch (error) {
            setNotice("Settings saved; Workshop status was preserved");
            notifyError(error);
          }
        }
      });
      if (firebaseSettings.enabled) {
        firebaseAttempted = true;
        await firebaseSync.connectAndSync(firebaseSettings, firebasePassword);
      } else {
        await firebaseSync.disconnect();
      }
      closeSettings();
      if (!firebaseSettings.enabled) {
        setNotice("Settings saved");
      }
    } catch (error) {
      if (firebaseAttempted) {
        setSettingsError(errorMessage(error));
      } else {
        showSettingsError(error);
      }
    }
  }

  async function disconnectFirebaseAccount() {
    setSettingsError("");
    try {
      await firebaseSync.disconnect(false);
      setFirebasePassword("");
      setNotice("Signed out of Firebase on this device");
    } catch (error) {
      showSettingsError(error);
    }
  }

  async function openLogs() {
    await perform(() => getStore().openLogs());
  }

  async function openDatabaseFolder() {
    await perform(() => getStore().openDatabaseFolder());
  }

  return {
    isOpen: settingsOpen,
    open: openSettings,
    modalProps: {
      configPath,
      isChoosingPath: choosingPath,
      workshopPath,
      isDetectingPath: detectingWorkshopPath,
      isTestingPath: testingWorkshopPath,
      workshopAccessPath,
      isSaving: busy,
      settingsError,
      firebaseSettings,
      firebasePassword,
      firebaseStatus: firebaseSync.status,
      onFirebaseSettingsChange: setFirebaseSettings,
      onFirebasePasswordChange: setFirebasePassword,
      onFirebaseDisconnect: () => void disconnectFirebaseAccount(),
      onWorkshopPathChange: changeWorkshopPath,
      onBrowseWorkshopPath: () => void browseWorkshop(),
      onDetectWorkshopPath: () => void detectWorkshop(),
      onTestWorkshopPath: () => void testWorkshopAccess(),
      onBrowseConfigPath: () => void browseConfig(),
      onOpenDatabaseFolder: window.modStore ? () => void openDatabaseFolder() : undefined,
      onOpenLogs: window.modStore ? () => void openLogs() : undefined,
      onClose: closeSettings,
      onConfigPathChange: setConfigPath,
      onSubmit: (event: SyntheticEvent) => void saveSettings(event),
    },
  };
}
