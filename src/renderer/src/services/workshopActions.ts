import type { SteamOperationResult } from "../../../shared/types";

const visibleWarningLimit = 3;

export function workshopWarningMessage(warnings: string[]): string {
  const unique = [...new Set(warnings.map((warning) => warning.trim()).filter(Boolean))];
  const visible =
    unique.slice(0, visibleWarningLimit).join("; ") ||
    "Workshop metadata could not be fully refreshed";
  const remaining = unique.length - visibleWarningLimit;
  const suffix = remaining > 0 ? ` (+${remaining} more)` : "";
  const separator = suffix || !/[.!?]$/.test(visible) ? ". " : " ";
  return `${visible}${suffix}${separator}Existing metadata was preserved where refreshes failed. See the application logs for full details.`;
}

export function workshopResultNotice(result: SteamOperationResult, success: string): string {
  if (result.failures.length) {
    return `${result.subscribed} subscribed, ${result.unsubscribed} unsubscribed; some changes failed`;
  }
  const counts =
    result.subscribed || result.unsubscribed
      ? ` (${result.subscribed} subscribed, ${result.unsubscribed} unsubscribed)`
      : "";
  const warningCount = result.warnings?.length ?? 0;
  const warnings = warningCount
    ? `; completed with ${warningCount} ${warningCount === 1 ? "warning" : "warnings"}`
    : "";
  return `${success}${counts}${warnings}`;
}
