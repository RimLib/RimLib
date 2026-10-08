import type { SteamOperationResult } from "../../../shared/types";

export function workshopResultNotice(result: SteamOperationResult, success: string): string {
  if (result.failures.length) {
    return `${result.subscribed} subscribed, ${result.unsubscribed} unsubscribed; some changes failed`;
  }
  const counts =
    result.subscribed || result.unsubscribed
      ? ` (${result.subscribed} subscribed, ${result.unsubscribed} unsubscribed)`
      : "";
  const warnings = result.warnings?.length ? `. ${result.warnings.join("; ")}` : "";
  return `${success}${counts}${warnings}`;
}
