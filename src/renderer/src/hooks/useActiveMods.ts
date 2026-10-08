import { useCallback, useEffect, useRef, useState } from "react";

import { withReadTimeout } from "../../../shared/async";
import { steamLimits } from "../../../shared/limits";
import type { ActiveModsState, AppSettings } from "../../../shared/types";
import { getStore } from "../services/modStore";
import { uiTimings } from "../utils/uiConstants";

export function useActiveMods(settings: AppSettings, enabled: boolean) {
  const [active, setActive] = useState<ActiveModsState>({ packageIds: [] });
  const [loading, setLoading] = useState(true);
  const request = useRef(0);
  const pending = useRef<number | undefined>(undefined);
  const { rimWorldConfigPath, workshopModsPath } = settings;

  const adoptActive = useCallback((next: ActiveModsState) => {
    request.current++;
    setActive((previous) => ({
      ...next,
      installedMods: next.installedMods ?? previous.installedMods,
    }));
    setLoading(false);
  }, []);

  const refresh = useCallback(
    (showLoading = true) => {
      if (!enabled) {
        return;
      }
      if (pending.current !== undefined && !showLoading) {
        return;
      }
      const sequence = ++request.current;
      if (showLoading) {
        setLoading(true);
      }
      pending.current = sequence;
      void withReadTimeout(
        getStore().getActiveMods({ rimWorldConfigPath, workshopModsPath }),
        "Active mod lookup is not responding. Check the drive and paths in Settings.",
        steamLimits.activeMetadataTimeoutMs,
      )
        .catch((error: unknown): ActiveModsState => ({
          configPath: rimWorldConfigPath,
          packageIds: [],
          error: String(error),
        }))
        .then((next) => {
          if (sequence !== request.current) {
            return;
          }
          setActive((previous) =>
            previous.configPath === next.configPath &&
            previous.gameVersion === next.gameVersion &&
            previous.error === next.error &&
            previous.metadataError === next.metadataError &&
            previous.packageIds.join("\n") === next.packageIds.join("\n") &&
            JSON.stringify(previous.installedMods) === JSON.stringify(next.installedMods)
              ? previous
              : next,
          );
          setLoading(false);
        })
        .finally(() => {
          if (pending.current === sequence) {
            pending.current = undefined;
          }
        });
    },
    [enabled, rimWorldConfigPath, workshopModsPath],
  );

  const invalidate = useCallback(() => {
    request.current++;
  }, []);
  useEffect(() => {
    refresh();
    if (!enabled) {
      return;
    }
    const onFocus = () => {
      refresh(false);
    };
    const timer = window.setInterval(onFocus, uiTimings.activePollMs);
    window.addEventListener("focus", onFocus);
    return () => {
      invalidate();
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, refresh, invalidate]);

  return { active, loading, refresh, adoptActive };
}
