import { useEffect, useRef, useState } from "react";

import { withReadTimeout } from "../../../shared/async";
import { steamLimits } from "../../../shared/limits";
import type { ModVault } from "../../../shared/types";
import { getStore } from "../services/modStore";
import { applyWorkshopStatus } from "../utils/library";
import { uiTimings } from "../utils/uiConstants";

export function useWorkshopStatus(
  enabled: boolean,
  paused: boolean,
  workshopPath: string | undefined,
  update: (change: (vault: ModVault) => ModVault) => void,
) {
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  const lastAttempt = useRef(0);
  const lastPath = useRef(workshopPath);
  useEffect(() => {
    if (!enabled || paused || !window.modStore) {
      return;
    }
    if (lastPath.current !== workshopPath) {
      lastPath.current = workshopPath;
      lastAttempt.current = 0;
      setError(undefined);
    }
    let cancelled = false;
    const refresh = async () => {
      if (
        pending.current ||
        Date.now() - lastAttempt.current < uiTimings.workshopStatusCooldownMs
      ) {
        return;
      }
      pending.current = true;
      lastAttempt.current = Date.now();
      try {
        const snapshot = await withReadTimeout(
          getStore().inspectWorkshopStatus(),
          "Workshop folders are not responding. Showing saved mod status.",
          steamLimits.workshopDiscoveryTimeoutMs,
        );
        if (cancelled) {
          return;
        }
        update((vault) => applyWorkshopStatus(vault, snapshot));
        setError(snapshot.warnings.length ? snapshot.warnings.join("; ") : undefined);
      } catch (failure) {
        if (!cancelled) {
          setError(String(failure));
        }
      } finally {
        pending.current = false;
      }
    };
    void refresh();
    const onFocus = () => {
      void refresh();
    };
    const timer = window.setInterval(onFocus, uiTimings.workshopStatusPollMs);
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, paused, workshopPath, update]);
  return error;
}
