import { useCallback, useEffect, useState } from "react";

import { performUiAction } from "../services/uiActions";
import { errorMessage } from "../utils/errors";
import { uiTimings } from "../utils/uiConstants";

export type ActionNotificationKind = "error" | "warning";

export function useActionNotifications() {
  const [notification, setNotification] = useState<{
    message: string;
    kind: ActionNotificationKind;
  }>();
  const notifyError = useCallback((error: unknown) => {
    setNotification({ message: errorMessage(error), kind: "error" });
  }, []);
  const notifyWarning = useCallback((message: string) => {
    setNotification({ message, kind: "warning" });
  }, []);
  const dismiss = useCallback(() => {
    setNotification(undefined);
  }, []);
  const perform = useCallback(
    <T>(action: () => T | Promise<T>) => performUiAction(action, notifyError),
    [notifyError],
  );

  useEffect(() => {
    if (!notification) {
      return;
    }
    const timer = window.setTimeout(dismiss, uiTimings.errorNotificationMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [notification, dismiss]);

  return { notification, notifyError, notifyWarning, perform, dismiss };
}
