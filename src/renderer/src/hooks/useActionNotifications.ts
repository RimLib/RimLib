import { useCallback, useEffect, useState } from "react";

import { performUiAction } from "../services/uiActions";
import { errorMessage } from "../utils/errors";
import { uiTimings } from "../utils/uiConstants";

export function useActionNotifications() {
  const [notification, setNotification] = useState<{ message: string }>();
  const notifyError = useCallback((error: unknown) => {
    setNotification({ message: errorMessage(error) });
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

  return { notification, notifyError, perform, dismiss };
}
