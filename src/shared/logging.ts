import type { ConstantValue } from "./domainConstants";
import { bytesPerMiB } from "./limits";

export const logLevels = Object.freeze({
  debug: "DEBUG",
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
  fatal: "FATAL",
} as const);
export type LogLevel = ConstantValue<typeof logLevels>;

export const rendererErrorEvents = Object.freeze({
  windowError: "window.error",
  unhandledRejection: "window.unhandled-rejection",
  reactError: "react.error",
} as const);
export type RendererErrorEvent = ConstantValue<typeof rendererErrorEvents>;

export const loggingLimits = Object.freeze({
  maxFileBytes: 5 * bytesPerMiB,
  maxSessions: 20,
  retentionDays: 14,
  maxStringLength: 8192,
  maxRecordBytes: 32768,
  maxSourceLength: 1024,
  maxEntries: 250,
  maxChildren: 100,
  maxDepth: 6,
  bufferBytes: 64 * 1024,
  flushIntervalMs: 100,
});

export interface AppDiagnosticsApi {
  reportError: (
    event: RendererErrorEvent,
    details: { message: string; stack?: string; source?: string; line?: number; column?: number },
  ) => void;
}
