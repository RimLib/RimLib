import type { FirebaseSyncSettings, ModStoreApi } from "../../../shared/types";
import { normalizeFirebaseSyncSettings } from "./firebaseSync";

export async function persistSettings(
  store: Pick<ModStoreApi, "validateWorkshopModsPath" | "load" | "save">,
  configPath: string,
  workshopPath: string,
  firebaseSync?: FirebaseSyncSettings,
) {
  const path = workshopPath.trim() ? await store.validateWorkshopModsPath(workshopPath) : undefined;
  const current = await store.load();
  const vault = await store.save({
    ...current,
    settings: {
      ...current.settings,
      rimWorldConfigPath: configPath.trim() || undefined,
      workshopModsPath: path,
      ...(firebaseSync === undefined
        ? {}
        : { firebaseSync: normalizeFirebaseSyncSettings(firebaseSync) }),
    },
  });
  return { vault, workshopPathChanged: current.settings?.workshopModsPath !== path };
}
