import { type RendererErrorEvent, rendererErrorEvents } from "../../../shared/logging";
export function reportRendererError(event: RendererErrorEvent, error: unknown, source?: string) {
  try {
    const value =
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { message: String(error) };
    window.appDiagnostics?.reportError(event, { ...value, source });
  } catch {
    /* Diagnostics must not interrupt error recovery. */
  }
}

export function installRendererDiagnostics() {
  window.addEventListener("error", (event) => {
    try {
      window.appDiagnostics?.reportError(rendererErrorEvents.windowError, {
        message: event.message,
        stack: event.error instanceof Error ? event.error.stack : undefined,
        source: event.filename,
        line: event.lineno,
        column: event.colno,
      });
    } catch {
      /* Reporting a failure must not generate another uncaught error. */
    }
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportRendererError(rendererErrorEvents.unhandledRejection, event.reason);
  });
}
