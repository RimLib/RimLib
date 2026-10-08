import { useCallback, useEffect, useRef, useState } from "react";

import { withReadTimeout } from "../../../shared/async";
import type { SteamStatus } from "../../../shared/types";
import { getStore } from "../services/modStore";
import { errorMessage } from "../utils/errors";
import { uiTimings } from "../utils/uiConstants";

export function useSteamAvailability() {
  const [status, setStatus] = useState<SteamStatus>({ running: false, error: "Checking Steam..." });
  const mounted = useRef(false);
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
      if (mounted.current) {
        setStatus((previous) =>
          previous.running === next.running && previous.error === next.error ? previous : next,
        );
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

  useEffect(() => {
    mounted.current = true;
    const check = () => {
      void refresh();
    };
    check();
    const timer = window.setInterval(check, uiTimings.steamStatusPollMs);
    window.addEventListener("focus", check);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [refresh]);

  return { status, refresh };
}
