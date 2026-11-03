import type { FirebaseSyncSettings } from "../../../shared/types";

export function normalizeFirebaseSyncSettings(
  settings: FirebaseSyncSettings,
): FirebaseSyncSettings {
  const next: FirebaseSyncSettings = {
    enabled: settings.enabled,
    apiKey: settings.apiKey.trim(),
    authDomain: settings.authDomain.trim(),
    projectId: settings.projectId.trim(),
    appId: settings.appId.trim(),
    email: settings.email.trim(),
  };
  if (
    next.enabled &&
    (!next.apiKey || !next.authDomain || !next.projectId || !next.appId || !next.email)
  ) {
    throw new Error("Complete every Firebase field before enabling sync.");
  }
  if (next.enabled && !/^\S+@\S+\.\S+$/.test(next.email)) {
    throw new Error("Enter a valid Firebase account email address.");
  }
  return next;
}
