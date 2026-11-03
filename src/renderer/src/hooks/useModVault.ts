import { useCallback, useEffect, useRef, useState } from "react";

import { withReadTimeout } from "../../../shared/async";
import type { ModVault } from "../../../shared/types";
import { emptyVault } from "../data/defaults";
import { getStore } from "../services/modStore";
import { uiTimings } from "../utils/uiConstants";

type PrepareVaultForSave = (vault: ModVault) => ModVault;
type VaultChange = (previous: ModVault) => ModVault;

export function useModVault(
  onError: (message: string) => void,
  prepareVaultForSave?: PrepareVaultForSave,
) {
  const [vault, setVault] = useState<ModVault>(emptyVault);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const current = useRef(vault);
  const ready = useRef(false);
  const locked = useRef(false);
  const revision = useRef<string | undefined>(undefined);
  const changes = useRef(0);
  const savedChanges = useRef(0);
  const pendingChanges = useRef<VaultChange[]>([]);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const operation = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const deletedTags = useRef(new Set<string>());
  const errorCallback = useRef(onError);
  errorCallback.current = onError;
  const prepareCallback = useRef(prepareVaultForSave);
  prepareCallback.current = prepareVaultForSave;

  const adopt = useCallback((next: ModVault) => {
    changes.current = 0;
    savedChanges.current = 0;
    pendingChanges.current = [];
    current.current = next;
    revision.current = next.revision;
    setVault(next);
  }, []);

  const update = useCallback((change: VaultChange) => {
    if (!ready.current || locked.current) {
      return;
    }
    const next = change(current.current);
    if (next === current.current) {
      return;
    }
    changes.current++;
    pendingChanges.current.push(change);
    current.current = next;
    setVault(next);
  }, []);

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
    const result = saveQueue.current
      .catch(() => undefined)
      .then(async () => {
        // A failed initial load leaves editing disabled and there is nothing to flush. In
        // particular, do not retry the same corrupt/future database during the close handshake:
        // rejecting that handshake would keep an otherwise untouched window open forever.
        if (!ready.current) {
          return;
        }
        const rebasePendingChanges = async () => {
          const latest = await getStore().load();
          if (latest.revision === revision.current) {
            return false;
          }
          const rebased = pendingChanges.current.reduce((next, change) => change(next), latest);
          revision.current = latest.revision;
          current.current = rebased;
          setVault(rebased);
          return true;
        };

        await rebasePendingChanges();
        const prepared = prepareCallback.current?.(current.current) ?? current.current;
        if (prepared !== current.current) {
          changes.current++;
          current.current = prepared;
          setVault(prepared);
        }
        if (changes.current === savedChanges.current) {
          return;
        }
        let version = changes.current;
        let pendingChangeCount = pendingChanges.current.length;
        const tags = [...deletedTags.current];
        let saved: ModVault;
        try {
          saved = await getStore().save(
            { ...current.current, revision: revision.current },
            { deletedTagIds: tags },
          );
        } catch (error) {
          // Native actions also write through VaultStore. If one completed after our preflight
          // read, replay only the still-unsaved renderer transforms on its authoritative result
          // and retry once. A disk failure keeps the same revision and is never masked here.
          if (!(await rebasePendingChanges())) {
            throw error;
          }
          const retried = prepareCallback.current?.(current.current) ?? current.current;
          if (retried !== current.current) {
            changes.current++;
            current.current = retried;
            setVault(retried);
          }
          version = changes.current;
          pendingChangeCount = pendingChanges.current.length;
          saved = await getStore().save(
            { ...current.current, revision: revision.current },
            { deletedTagIds: tags },
          );
        }
        revision.current = saved.revision;
        savedChanges.current = version;
        pendingChanges.current.splice(0, pendingChangeCount);
        current.current = { ...current.current, revision: saved.revision };
        setVault(current.current);
        tags.forEach((id) => deletedTags.current.delete(id));
      });
    saveQueue.current = result;
    return result;
  }, []);

  useEffect(() => {
    let cancelled = false;
    getStore()
      .load()
      .then((next) => {
        if (cancelled) {
          return;
        }
        adopt(next);
        ready.current = true;
        setLoaded(true);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [adopt]);

  useEffect(() => {
    if (!loaded || busy) {
      return;
    }
    timer.current = setTimeout(() => {
      void flush().catch((error: unknown) => {
        errorCallback.current(
          `Saving failed: ${String(error)}. Your existing database was preserved.`,
        );
      });
    }, uiTimings.saveDebounceMs);
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, [vault, loaded, busy, flush]);

  useEffect(
    () =>
      getStore().onBeforeClose?.(async () => {
        await operation.current.catch(() => undefined);
        await flush();
      }),
    [flush],
  );

  const run = useCallback(
    <T>(action: () => Promise<T>): Promise<T> => {
      if (!ready.current || locked.current) {
        return Promise.reject(
          new Error("The database is unavailable or an operation is already running."),
        );
      }
      locked.current = true;
      setBusy(true);
      if (timer.current) {
        clearTimeout(timer.current);
      }
      let invoked = false;
      const result = (async () => {
        try {
          await flush();
          invoked = true;
          return await action();
        } catch (error) {
          // Recover partial native changes, but keep the UI intact when nothing was written.
          if (invoked) {
            try {
              const latest = await withReadTimeout(
                getStore().load(),
                "The saved result could not be reloaded.",
              );
              if (latest.revision !== current.current.revision) {
                adopt(latest);
              }
            } catch {
              errorCallback.current(
                "The action failed and its saved result could not be reloaded. Your displayed library was retained.",
              );
            }
          }
          throw error;
        } finally {
          locked.current = false;
          setBusy(false);
        }
      })();
      operation.current = result;
      return result;
    },
    [adopt, flush],
  );

  const deleteTag = useCallback(
    (id: string) => {
      if (!ready.current || locked.current) {
        return;
      }
      deletedTags.current.add(id);
      update((previous) => ({
        ...previous,
        userTags: previous.userTags.filter((tag) => tag.id !== id),
        mods: previous.mods.map((mod) => ({
          ...mod,
          userTagIds: mod.userTagIds?.filter((tagId) => tagId !== id),
        })),
      }));
    },
    [update],
  );

  return { vault, loaded, loadError, busy, adopt, update, run, deleteTag };
}
