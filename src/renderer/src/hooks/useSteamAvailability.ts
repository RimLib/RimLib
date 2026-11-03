import { useCallback, useRef } from "react";

import { withReadTimeout } from "../../../shared/async";
import type { SteamStatus } from "../../../shared/types";
import { getStore } from "../services/modStore";
import { errorMessage } from "../utils/errors";
import { uiTimings } from "../utils/uiConstants";

export function useSteamAvailability() {
  const pending = useRef<Promise<SteamStatus> | undefined>(undefined);

  const refresh = useCallback((): Promise<SteamStatus> => {
    if (pending.current) {
      return pending.current;
    }
    const request = (async () => {
      let next: SteamStatus;
      try {
        next = await withReadTimeout(
          getStore().getSteamStatus(),
          "Steam status is not responding. Start Steam and try again.",
          uiTimings.steamStatusTimeoutMs,
        );
      } catch (error) {
        next = { running: false, error: errorMessage(error) };
      }
      return next;
    })();
    pending.current = request;
    void request.finally(() => {
      if (pending.current === request) {
        pending.current = undefined;
      }
    });
    return request;
  }, []);

  return { refresh };
}
