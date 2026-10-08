import { useCallback, useEffect, useRef, useState } from "react";

import type { FirebaseSyncSettings, ModVault } from "../../../shared/types";
import { connectFirebase, disconnectFirebase, syncFirebaseVault } from "../services/firebaseSync";
import { getStore } from "../services/modStore";

export type FirebaseSyncPhase =
  "disabled" | "signed-out" | "connecting" | "syncing" | "synced" | "conflict" | "error";

export interface FirebaseSyncStatus {
  phase: FirebaseSyncPhase;
  message: string;
}

interface FirebaseSyncDependencies {
  vault: ModVault;
  loaded: boolean;
  busy: boolean;
  run: <T>(action: () => Promise<T>) => Promise<T>;
  adopt: (vault: ModVault) => void;
  notifyError: (error: unknown) => void;
  setNotice: (message: string) => void;
}

const disabledStatus: FirebaseSyncStatus = {
  phase: "disabled",
  message: "Firebase sync is off",
};

export function useFirebaseSync({
  vault,
  loaded,
  busy,
  run,
  adopt,
  notifyError,
  setNotice,
}: FirebaseSyncDependencies) {
  const [status, setStatus] = useState<FirebaseSyncStatus>(disabledStatus);
  const connected = useRef(false);
  const requested = useRef(false);
  const syncing = useRef(false);
  const lastRevision = useRef<string | undefined>(undefined);
  const settings = vault.settings?.firebaseSync;
  const configurationKey = settings?.enabled
    ? `${settings.projectId}\n${settings.apiKey}\n${settings.appId}\n${settings.email}`
    : "";

  const syncNow = useCallback(
    async (quiet = false) => {
      if (syncing.current) {
        return;
      }
      syncing.current = true;
      setStatus({ phase: "syncing", message: "Syncing with Firestore…" });
      try {
        await run(async () => {
          const current = await getStore().load();
          const result = await syncFirebaseVault(current);
          let base = current;
          if (result.deletedModIds.length) {
            base = await getStore().deleteLibraryMods(result.deletedModIds);
          }
          if (result.downloaded > 0) {
            const saved = await getStore().save(
              { ...result.vault, revision: base.revision },
              { deletedTagIds: result.deletedTagIds },
            );
            adopt(saved);
            lastRevision.current = saved.revision;
          } else {
            lastRevision.current = current.revision;
          }
          result.commitState();
          const details = [
            result.uploaded ? `${result.uploaded} uploaded` : "",
            result.downloaded ? `${result.downloaded} downloaded` : "",
          ].filter(Boolean);
          const message = details.length
            ? `Firebase synced: ${details.join(", ")}`
            : "Firebase is up to date";
          setStatus({ phase: "synced", message });
          if (!quiet) {
            setNotice(message);
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus({
          phase: /conflict|changed in Firebase/i.test(message) ? "conflict" : "error",
          message,
        });
        if (!quiet) {
          notifyError(error);
        }
        throw error;
      } finally {
        syncing.current = false;
      }
    },
    [adopt, notifyError, run, setNotice],
  );

  const connectAndSync = useCallback(
    async (next: FirebaseSyncSettings, password: string, quiet = false) => {
      requested.current = true;
      setStatus({ phase: "connecting", message: "Connecting to Firebase…" });
      try {
        await connectFirebase(next, password);
        connected.current = true;
      } catch (error) {
        connected.current = false;
        const message = error instanceof Error ? error.message : String(error);
        setStatus({
          phase: /password to connect/i.test(message) ? "signed-out" : "error",
          message,
        });
        if (!quiet) {
          notifyError(error);
        }
        throw error;
      }
      await syncNow(quiet);
    },
    [notifyError, syncNow],
  );

  const disconnect = useCallback(async (disabled = true) => {
    requested.current = !disabled;
    connected.current = false;
    await disconnectFirebase();
    setStatus(
      disabled ? disabledStatus : { phase: "signed-out", message: "Signed out on this device" },
    );
  }, []);

  useEffect(() => {
    if (!loaded || !settings?.enabled || requested.current) {
      return;
    }
    requested.current = true;
    void connectAndSync(settings, "", true).catch(() => undefined);
  }, [configurationKey, connectAndSync, loaded, settings]);

  useEffect(() => {
    if (!settings?.enabled) {
      requested.current = false;
      connected.current = false;
      setStatus(disabledStatus);
      return;
    }
    if (
      !loaded ||
      busy ||
      !connected.current ||
      !vault.revision ||
      vault.revision === lastRevision.current
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void syncNow().catch(() => undefined);
    }, 1_500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [busy, loaded, settings?.enabled, syncNow, vault.revision]);

  return { status, connectAndSync, disconnect, syncNow };
}
