import { useCallback, useEffect, useRef, useState } from "react";

import { withReadTimeout } from "../../../shared/async";
import { steamLimits } from "../../../shared/limits";
import type { ModVault } from "../../../shared/types";
import { getStore } from "../services/modStore";
import { applyWorkshopStatus } from "../utils/library";

export function useWorkshopStatus(
  enabled: boolean,
  paused: boolean,
  workshopPath: string | undefined,
  update: (change: (vault: ModVault) => ModVault) => void,
) {
  const [error, setError] = useState<string>();
  const initializedPath = useRef<string | undefined>(undefined);
  const pathKey = workshopPath ?? "";
  const record = useCallback(
    (next?: string) => {
      initializedPath.current = pathKey;
      setError(next);
    },
    [pathKey],
  );
  useEffect(() => {
    if (!enabled || paused || !window.modStore || initializedPath.current === pathKey) {
      return;
    }
    let cancelled = false;
    const refresh = async () => {
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
        record(snapshot.warnings.length ? snapshot.warnings.join("; ") : undefined);
      } catch (failure) {
        if (!cancelled) {
          record(String(failure));
        }
      } finally {
        if (!cancelled) {
          initializedPath.current = pathKey;
        }
      }
    };
    void refresh();
    return () => {
      cancelled = true;
    };
  }, [enabled, pathKey, paused, record, update]);
  return { error, record };
}
