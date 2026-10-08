import { useCallback, useEffect, useRef, useState } from "react";

import { withReadTimeout } from "../../../shared/async";
import type { ModVault } from "../../../shared/types";
import { emptyVault } from "../data/defaults";
import { getStore } from "../services/modStore";
import { uiTimings } from "../utils/uiConstants";

export function useModVault(onError: (message: string) => void) {
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
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const operation = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const deletedTags = useRef(new Set<string>());
  const errorCallback = useRef(onError);
  errorCallback.current = onError;

  const adopt = useCallback((next: ModVault) => {
    changes.current = 0;
    savedChanges.current = 0;
    current.current = next;
    revision.current = next.revision;
    setVault(next);
  }, []);

  const update = useCallback((change: (previous: ModVault) => ModVault) => {
    if (!ready.current || locked.current) {
      return;
    }
    const next = change(current.current);
    if (next === current.current) {
      return;
    }
    changes.current++;
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
        if (!ready.current || changes.current === savedChanges.current) {
          return;
        }
        const version = changes.current;
        const tags = [...deletedTags.current];
        const saved = await getStore().save(
          { ...current.current, revision: revision.current },
          { deletedTagIds: tags },
        );
        revision.current = saved.revision;
        savedChanges.current = version;
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
