import assert from "node:assert/strict";

import { isRecord } from "../../src/shared/validation";

interface LogData extends Record<string, unknown> {
  error?: { stack?: string; cause?: { message?: string } };
  platform?: { os?: string };
  durationMs?: number;
}

interface LogRecord {
  timestamp: string;
  level: string;
  sessionId: string;
  pid: number;
  source: string;
  event: string;
  requestId?: string;
  data: LogData;
}

export function parseLogRecord(line: string): LogRecord {
  const entry: unknown = JSON.parse(line);
  assert.ok(isRecord(entry));
  for (const field of ["timestamp", "level", "sessionId", "source", "event"]) {
    assert.equal(typeof entry[field], "string");
  }
  assert.equal(typeof entry.pid, "number");
  if (entry.requestId !== undefined) {
    assert.equal(typeof entry.requestId, "string");
  }
  const data = entry.data === undefined ? {} : entry.data;
  assert.ok(isRecord(data));
  if (data.durationMs !== undefined) {
    assert.equal(typeof data.durationMs, "number");
  }
  if (data.platform !== undefined) {
    assert.ok(isRecord(data.platform));
    if (data.platform.os !== undefined) {
      assert.equal(typeof data.platform.os, "string");
    }
  }
  if (data.error !== undefined) {
    assert.ok(isRecord(data.error));
    if (data.error.stack !== undefined) {
      assert.equal(typeof data.error.stack, "string");
    }
    if (data.error.cause !== undefined) {
      assert.ok(isRecord(data.error.cause));
      if (data.error.cause.message !== undefined) {
        assert.equal(typeof data.error.cause.message, "string");
      }
    }
  }
  return { ...entry, data } as unknown as LogRecord;
}
