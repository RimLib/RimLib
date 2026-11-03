import { CircleAlert, TriangleAlert, X } from "lucide-react";

import type { ActionNotificationKind } from "../../hooks/useActionNotifications";
import { tooltipPlacements } from "../../utils/tooltips";
import { TooltipIconButton } from "./TooltipIconButton";

export function ErrorNotification({
  message,
  kind = "error",
  onDismiss,
}: {
  message: string;
  kind?: ActionNotificationKind;
  onDismiss: () => void;
}) {
  const warning = kind === "warning";
  const Icon = warning ? TriangleAlert : CircleAlert;
  return (
    <div className="toast toast-end toast-bottom pointer-events-none z-[1100] max-w-full error-notification-toast">
      <div
        className={`alert ${warning ? "alert-warning" : "alert-error"} pointer-events-auto grid w-[420px] max-w-[calc(100vw-32px)] grid-cols-[20px_minmax(0,1fr)_34px] items-start gap-3 rounded-lg text-left shadow-lg error-notification`}
        role="alert"
      >
        <Icon size={20} aria-hidden />
        <div className="min-w-0">
          <strong className="error-notification-title">
            {warning ? "Sync completed with warnings" : "Action failed"}
          </strong>
          <p className="error-notification-description mt-1.5 mb-0 max-h-[min(240px,40vh)] overflow-auto [overflow-wrap:anywhere]">
            {message}
          </p>
        </div>
        <TooltipIconButton
          label="Dismiss notification"
          placement={tooltipPlacements.left}
          onClick={onDismiss}
        >
          <X size={16} aria-hidden />
        </TooltipIconButton>
      </div>
    </div>
  );
}
