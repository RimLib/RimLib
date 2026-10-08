import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { millisecondsPerDay } from "../shared/limits";
import { loggingLimits, type LogLevel, logLevels } from "../shared/logging";
import { requireValue } from "../shared/validation";
import { privateDirectoryMode, privateFileMode } from "./platformConstants";

const requestContext = new AsyncLocalStorage<{ requestId: string }>();
const sensitiveKey =
  /password|passphrase|secret|token|apiKey|authorization|cookie|ticket|steamLogin|^(?:steamId|steamId64|steamId32|accountId|steamCreatorId|notes|description|summary|vault|environment|env)$/i;

export function sanitizeLogData(
  value: unknown,
  home = homedir(),
  seen = new WeakSet(),
  depth = 0,
  budget: { remaining: number } = { remaining: loggingLimits.maxEntries },
): unknown {
  if (budget.remaining-- <= 0) {
    return "[ENTRY_LIMIT]";
  }
  if (typeof value === "string") {
    let text = home ? value.split(home).join("~") : value;
    text = text
      .replace(/\b7656119\d{10}\b/g, "[REDACTED_STEAM_ID]")
      .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
      .replace(
        /([?&](?:key|api_?key|token|access_token|refresh_token|password|auth|signature)=)[^&#\s]+/gi,
        "$1[REDACTED]",
      )
      .replace(
        /((?:password|api_?key|access_?token|refresh_?token|authorization|cookie|secret|token|ticket|notes|description|summary)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\r\n,;}]+)/gi,
        "$1[REDACTED]",
      );
    return text.length > loggingLimits.maxStringLength
      ? `${text.slice(0, loggingLimits.maxStringLength)}[TRUNCATED]`
      : text;
  }
  if (typeof value === "bigint") {
    return sanitizeLogData(String(value), home, seen, depth, budget);
  }
  if (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (typeof value !== "object") {
    return `[${typeof value}]`;
  }
  if (depth >= loggingLimits.maxDepth) {
    return "[DEPTH_LIMIT]";
  }
  if (seen.has(value)) {
    return "[CIRCULAR]";
  }
  seen.add(value);
  try {
    if (value instanceof Error) {
      return sanitizeLogData(
        {
          name: value.name,
          message: value.message,
          stack: value.stack,
          cause: value.cause,
          code: (value as NodeJS.ErrnoException).code,
        },
        home,
        seen,
        depth + 1,
        budget,
      );
    }
    if (Array.isArray(value)) {
      return value
        .slice(0, loggingLimits.maxChildren)
        .map((entry) => sanitizeLogData(entry, home, seen, depth + 1, budget));
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).slice(0, loggingLimits.maxChildren)) {
      const normalized = key.replace(/[_-]/g, "");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      result[key] = sensitiveKey.test(normalized)
        ? "[REDACTED]"
        : descriptor && "value" in descriptor
          ? sanitizeLogData(descriptor.value, home, seen, depth + 1, budget)
          : "[ACCESSOR]";
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

interface SessionLogOptions {
  directory: string;
  startup: Record<string, unknown>;
  home?: string;
  maxBytes?: number;
  maxSessions?: number;
  retentionDays?: number;
  pruneOnStart?: boolean;
  now?: () => Date;
  onError?: (error: unknown) => void;
  write?: (fd: number, text: string) => void;
}

export class SessionLogger {
  readonly sessionId = randomUUID();
  readonly path: string;
  readonly directory: string;
  private fd?: number;
  private buffer: string[] = [];
  private bufferedBytes = 0;
  private bytes = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private startupRecord: string;
  private options;
  failure?: unknown;

  constructor(options: SessionLogOptions) {
    this.options = {
      home: homedir(),
      maxBytes: loggingLimits.maxFileBytes,
      maxSessions: loggingLimits.maxSessions,
      retentionDays: loggingLimits.retentionDays,
      now: () => new Date(),
      write: (fd: number, text: string) => {
        writeFileSync(fd, text);
      },
      ...options,
    };
    this.directory = options.directory;
    mkdirSync(this.directory, { recursive: true, mode: privateDirectoryMode });
    this.path = join(
      this.directory,
      `app-${this.options.now().toISOString().replace(/[:.]/g, "-")}-${this.sessionId}.log`,
    );
    this.fd = openSync(this.path, "wx", privateFileMode);
    this.startupRecord = this.record(
      logLevels.info,
      "app.session.started",
      options.startup,
      "main",
    );
    this.buffer.push(this.startupRecord);
    this.flush();
    if (options.pruneOnStart !== false) {
      this.prune();
    }
  }

  private record(level: LogLevel, event: string, data: unknown, source: string) {
    const sanitized = sanitizeLogData(data, this.options.home);
    const serialized = JSON.stringify(sanitized);
    return `${JSON.stringify({
      timestamp: this.options.now().toISOString(),
      level,
      sessionId: this.sessionId,
      pid: process.pid,
      source,
      requestId: requestContext.getStore()?.requestId,
      event,
      message: event,
      data:
        serialized && Buffer.byteLength(serialized) > loggingLimits.maxRecordBytes
          ? { truncated: true, preview: serialized.slice(0, loggingLimits.maxStringLength) }
          : sanitized,
    })}\n`;
  }

  write(level: LogLevel, event: string, data?: unknown, source = "main") {
    if (this.fd === undefined) {
      return;
    }
    try {
      const line = this.record(level, event, data, source);
      this.buffer.push(line);
      this.bufferedBytes += Buffer.byteLength(line);
      if (
        level === logLevels.error ||
        level === logLevels.fatal ||
        this.bufferedBytes >= loggingLimits.bufferBytes
      ) {
        this.flush();
      } else if (!this.timer) {
        this.timer = setTimeout(() => {
          this.flush();
        }, loggingLimits.flushIntervalMs);
        this.timer.unref();
      }
    } catch (error) {
      this.disable(error);
    }
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = undefined;
    if (this.fd === undefined || !this.buffer.length) {
      return;
    }
    const pending = this.buffer;
    this.buffer = [];
    this.bufferedBytes = 0;
    try {
      for (const line of pending) {
        if (
          this.bytes > Buffer.byteLength(this.startupRecord) &&
          this.bytes + Buffer.byteLength(line) > this.options.maxBytes
        ) {
          this.rotate();
        }
        this.options.write(this.fd, line);
        this.bytes += Buffer.byteLength(line);
      }
    } catch (error) {
      this.disable(error);
    }
  }

  private rotate() {
    closeSync(requireValue(this.fd));
    this.fd = undefined;
    if (existsSync(`${this.path}.2`)) {
      unlinkSync(`${this.path}.2`);
    }
    if (existsSync(`${this.path}.1`)) {
      renameSync(`${this.path}.1`, `${this.path}.2`);
    }
    renameSync(this.path, `${this.path}.1`);
    this.fd = openSync(this.path, "wx", privateFileMode);
    this.options.write(this.fd, this.startupRecord);
    this.bytes = Buffer.byteLength(this.startupRecord);
  }

  prune() {
    try {
      const sessions = new Map<string, { modified: number; files: string[] }>();
      for (const entry of readdirSync(this.directory, { withFileTypes: true })) {
        if (!entry.isFile()) {
          continue;
        }
        const match = /^(app-\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f\d-]{36}\.log)(?:\.[12])?$/.exec(
          entry.name,
        );
        if (!match?.[1]) {
          continue;
        }
        const path = join(this.directory, entry.name);
        const session = sessions.get(match[1]) ?? { modified: 0, files: [] };
        session.modified = Math.max(session.modified, statSync(path).mtimeMs);
        session.files.push(path);
        sessions.set(match[1], session);
      }
      const cutoff = this.options.now().getTime() - this.options.retentionDays * millisecondsPerDay;
      const ordered = [...sessions.values()]
        .filter((session) => !session.files.includes(this.path))
        .sort((a, b) => b.modified - a.modified);
      for (const [index, session] of ordered.entries()) {
        if (index >= this.options.maxSessions - 1 || session.modified < cutoff) {
          for (const path of session.files) {
            unlinkSync(path);
          }
        }
      }
    } catch (error) {
      this.write(logLevels.warn, "logs.retention.failed", { error });
    }
  }

  private disable(error: unknown) {
    this.failure = error;
    this.buffer = [];
    this.bufferedBytes = 0;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = undefined;
    if (this.fd !== undefined) {
      try {
        closeSync(this.fd);
      } catch {
        /* Logging must not block database operations. */
      }
    }
    this.fd = undefined;
    try {
      this.options.onError?.(sanitizeLogData(error, this.options.home));
    } catch {
      /* Preserve the original operation's outcome. */
    }
  }

  close() {
    this.flush();
    if (this.fd !== undefined) {
      try {
        closeSync(this.fd);
      } catch (error) {
        this.disable(error);
      }
      this.fd = undefined;
    }
  }
}

let sessionLogger: SessionLogger | undefined;
export function setSessionLogger(logger?: SessionLogger) {
  sessionLogger = logger;
}
export const log = {
  debug: (event: string, data?: unknown) => sessionLogger?.write(logLevels.debug, event, data),
  info: (event: string, data?: unknown) => sessionLogger?.write(logLevels.info, event, data),
  warn: (event: string, data?: unknown) => sessionLogger?.write(logLevels.warn, event, data),
  error: (event: string, data?: unknown) => sessionLogger?.write(logLevels.error, event, data),
};

export function captureConsole(
  logger: SessionLogger,
  target: Pick<Console, "debug" | "log" | "info" | "warn" | "error"> = console,
) {
  const originals = {
    debug: target.debug,
    log: target.log,
    info: target.info,
    warn: target.warn,
    error: target.error,
  };
  for (const method of Object.keys(originals) as (keyof typeof originals)[]) {
    target[method] = (...args: unknown[]) => {
      logger.write(
        method === "error"
          ? logLevels.error
          : method === "warn"
            ? logLevels.warn
            : method === "debug"
              ? logLevels.debug
              : logLevels.info,
        "console.message",
        { arguments: args },
      );
      originals[method].apply(target, args);
    };
  }
  return () => Object.assign(target, originals);
}

export function captureProcessDiagnostics(logger: SessionLogger) {
  const exception = (error: Error, origin: string) => {
    logger.write(logLevels.fatal, "process.uncaught-exception", { error, origin });
  };
  const warning = (error: Error) => {
    logger.write(logLevels.warn, "process.warning", { error });
  };
  const exit = (code: number) => {
    logger.write(logLevels.info, "app.session.ended", { exitCode: code });
    logger.close();
  };
  process.on("uncaughtExceptionMonitor", exception);
  process.on("warning", warning);
  process.on("exit", exit);
  return () => {
    process.off("uncaughtExceptionMonitor", exception);
    process.off("warning", warning);
    process.off("exit", exit);
  };
}

export async function loggedOperation<T>(
  logger: SessionLogger | undefined,
  channel: string,
  request: unknown,
  operation: () => Promise<T> | T,
): Promise<T> {
  return requestContext.run({ requestId: randomUUID() }, async () => {
    const start = performance.now();
    logger?.write(logLevels.debug, "ipc.request.started", { channel, request });
    try {
      const result = await operation();
      logger?.write(logLevels.debug, "ipc.request.completed", {
        channel,
        durationMs: Math.round((performance.now() - start) * 100) / 100,
      });
      return result;
    } catch (error) {
      logger?.write(logLevels.error, "ipc.request.failed", {
        channel,
        durationMs: Math.round((performance.now() - start) * 100) / 100,
        error,
      });
      throw error;
    }
  });
}
