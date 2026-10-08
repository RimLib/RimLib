import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { build } from "esbuild";

import {
  captureConsole,
  log,
  loggedOperation,
  sanitizeLogData,
  SessionLogger,
  setSessionLogger,
} from "../src/main/logging";
import { createSteamClient, type SteamworksClient } from "../src/main/steamClient";
import { requireValue } from "../src/shared/validation";
import { parseLogRecord } from "./helpers/logRecords";

const startup = {
  platform: { os: "test", architecture: "test-arch" },
  runtime: { electron: "33", node: process.versions.node },
};
async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "mod-library-logs-"));
  try {
    await run(directory);
  } finally {
    setSessionLogger();
    await rm(directory, { recursive: true, force: true });
  }
}
async function records(path: string) {
  return (await readFile(path, "utf8")).trim().split("\n").map(parseLogRecord);
}

void test("each launch creates a unique private file starting with platform/runtime details and UTC structured records", async () =>
  temporary(async (directory) => {
    const first = new SessionLogger({ directory, startup });
    first.write("DEBUG", "test.event", { count: 42 });
    first.close();
    const second = new SessionLogger({ directory, startup });
    second.close();
    assert.notEqual(first.path, second.path);
    assert.notEqual(first.sessionId, second.sessionId);
    const lines = await records(first.path);
    assert.equal(requireValue(lines[0]).event, "app.session.started");
    assert.deepEqual(requireValue(lines[0]).data, startup);
    assert.equal(requireValue(lines[1]).level, "DEBUG");
    assert.equal(requireValue(lines[1]).data.count, 42);
    assert.equal(requireValue(lines[1]).source, "main");
    assert.equal(requireValue(lines[1]).sessionId, first.sessionId);
    assert.equal(requireValue(lines[1]).pid, process.pid);
    assert.match(requireValue(lines[1]).timestamp, /^\d{4}-\d{2}-\d{2}T.*Z$/);
    if (process.platform !== "win32") {
      assert.equal((await stat(first.path)).mode & 0o777, 0o600);
    }
  }));

void test("ordinary events are buffered while ERROR/FATAL and close flush pending records immediately", async () =>
  temporary(async (directory) => {
    const logger = new SessionLogger({ directory, startup });
    logger.write("DEBUG", "test.buffered");
    assert.equal((await records(logger.path)).length, 1);
    logger.write("ERROR", "test.error", { error: new Error("Failure") });
    assert.equal((await records(logger.path)).length, 3);
    logger.write("DEBUG", "test.last");
    logger.close();
    assert.equal(requireValue((await records(logger.path))[3]).event, "test.last");
  }));

void test("error stacks/causes survive JSON-line encoding but credentials, account ids, home paths and private content are redacted", async () =>
  temporary(async (directory) => {
    const home = "/Users/private-user";
    const logger = new SessionLogger({ directory, startup, home });
    const error = new Error(`Failure at ${home}/test.ts password="a private password"`, {
      cause: new Error("API failed"),
    });
    logger.write("ERROR", "test.error", {
      error,
      accountId: 1234,
      steamCreatorId: "76561198000000000",
      credentials: {
        clientSecret: "client-secret",
        user_token: "user-token",
        cookie: "session-cookie",
      },
      notes: "Private notes",
      description: "Private description",
      vault: { mods: "raw database" },
      source: "https://example.test/?key=secret-query&token=other-secret",
      message:
        'Authorization: Basic secret-basic\nCookie: secret-cookie\n{"notes":"private serialized note"}',
      workshopId: "3411375867",
      genericBigInt: 76561198000000000n,
    });
    logger.close();
    const text = await readFile(logger.path, "utf8");
    for (const secret of [
      home,
      "private-user",
      "a private password",
      "client-secret",
      "user-token",
      "session-cookie",
      "Private notes",
      "Private description",
      "raw database",
      "secret-query",
      "other-secret",
      "secret-basic",
      "secret-cookie",
      "private serialized note",
      "76561198000000000",
    ]) {
      assert.ok(!text.includes(secret), secret);
    }
    const entry = requireValue((await records(logger.path))[1]);
    assert.ok(requireValue(requireValue(entry.data.error).stack).includes("Failure at ~/test.ts"));
    assert.equal(requireValue(requireValue(entry.data.error).cause).message, "API failed");
    assert.equal(entry.data.workshopId, "3411375867");
  }));

void test("circular values, throwing accessors, bigints and oversized records cannot break logging", async () =>
  temporary(async (directory) => {
    const logger = new SessionLogger({ directory, startup });
    const circular: Record<string, unknown> = { id: 123n };
    circular.self = circular;
    Object.defineProperty(circular, "bad", {
      enumerable: true,
      get: () => {
        throw new Error("Accessor must not run");
      },
    });
    logger.write("INFO", "test.circular", circular);
    logger.write("INFO", "test.large", {
      values: Array.from({ length: 100 }, () => "x".repeat(16000)),
    });
    logger.close();
    const entries = await records(logger.path);
    assert.equal(requireValue(entries[1]).data.id, "123");
    assert.equal(requireValue(entries[1]).data.self, "[CIRCULAR]");
    assert.equal(requireValue(entries[1]).data.bad, "[ACCESSOR]");
    assert.equal(requireValue(entries[2]).data.truncated, true);
    assert.ok((await stat(logger.path)).size < 40000);
    assert.match(
      JSON.stringify(
        sanitizeLogData(
          Array.from({ length: 100 }, () => Array.from({ length: 100 }, () => ({ value: "x" }))),
        ),
      ),
      /ENTRY_LIMIT/,
    );
  }));

void test("rotation keeps at most three bounded files with session/platform context in each segment", async () =>
  temporary(async (directory) => {
    const logger = new SessionLogger({ directory, startup, maxBytes: 2048 });
    for (let index = 0; index < 50; index++) {
      logger.write("DEBUG", "test.rotation", { index, payload: "x".repeat(350) });
    }
    logger.close();
    const files = await readdir(directory);
    assert.equal(files.length, 3);
    for (const file of files) {
      assert.ok((await stat(join(directory, file))).size <= 2048);
      const entries = await records(join(directory, file));
      assert.equal(requireValue(entries[0]).sessionId, logger.sessionId);
      assert.equal(requireValue(requireValue(entries[0]).data.platform).os, "test");
    }
    assert.equal(requireValue((await records(logger.path)).at(-1)).data.index, 49);
  }));

void test("retention deletes only owned log sessions, never unrelated files or user database backups", async () =>
  temporary(async (directory) => {
    await writeFile(join(directory, "mod-vault.json"), "Do not touch");
    await writeFile(join(directory, "mod-vault.json.bak"), "Do not touch backup");
    await writeFile(join(directory, "my-debug.log"), "Do not touch custom log");
    const old = new SessionLogger({ directory, startup });
    old.close();
    await utimes(old.path, new Date(0), new Date(0));
    const recent = new SessionLogger({ directory, startup, retentionDays: 100000 });
    recent.close();
    const fresh = new SessionLogger({ directory, startup, maxSessions: 2 });
    fresh.close();
    const files = await readdir(directory);
    assert.ok(!files.includes(requireValue(old.path.split(/[\\/]/).at(-1))));
    assert.equal(files.filter((file) => file.startsWith("app-")).length, 2);
    assert.equal(await readFile(join(directory, "mod-vault.json"), "utf8"), "Do not touch");
    assert.equal(
      await readFile(join(directory, "mod-vault.json.bak"), "utf8"),
      "Do not touch backup",
    );
    assert.equal(
      await readFile(join(directory, "my-debug.log"), "utf8"),
      "Do not touch custom log",
    );
  }));

void test("main console capture preserves terminal output and records correct severities without recursion", async () =>
  temporary(async (directory) => {
    const logger = new SessionLogger({ directory, startup });
    const output: unknown[][] = [];
    const original = (...args: unknown[]) => output.push(args);
    const target = {
      debug: original,
      log: original,
      info: original,
      warn: original,
      error: original,
    };
    const restore = captureConsole(logger, target);
    target.warn("Warning");
    target.error("Error", new Error("Detail"));
    target.debug("Debug");
    restore();
    logger.close();
    assert.equal(output.length, 3);
    assert.equal(target.warn, original);
    assert.deepEqual(
      (await records(logger.path)).slice(1).map((entry) => entry.level),
      ["WARN", "ERROR", "DEBUG"],
    );
  }));

void test("secondary launches can create their own log without pruning a running instance's files", async () =>
  temporary(async (directory) => {
    const first = new SessionLogger({ directory, startup });
    first.close();
    await utimes(first.path, new Date(0), new Date(0));
    const secondary = new SessionLogger({ directory, startup, pruneOnStart: false });
    secondary.close();
    assert.ok((await records(first.path)).length);
    const primary = new SessionLogger({ directory, startup, pruneOnStart: false });
    primary.prune();
    primary.close();
    assert.equal((await readdir(directory)).filter((name) => name.startsWith("app-")).length, 2);
  }));

void test("overlapping asynchronous requests retain separate correlation ids, nested debug context and durations", async () =>
  temporary(async (directory) => {
    const logger = new SessionLogger({ directory, startup });
    setSessionLogger(logger);
    const results = await Promise.all(
      ["first", "second"].map((channel) =>
        loggedOperation(logger, channel, {}, async () => {
          await new Promise((resolve) => setTimeout(resolve, channel === "first" ? 5 : 1));
          log.debug("test.nested", { channel });
          return channel;
        }),
      ),
    );
    logger.close();
    assert.deepEqual(results, ["first", "second"]);
    const entries = (await records(logger.path)).slice(1);
    const ids = new Set<string>();
    for (const channel of results) {
      const related = entries.filter((entry) => entry.data.channel === channel);
      assert.equal(related.length, 3);
      assert.equal(new Set(related.map((entry) => entry.requestId)).size, 1);
      ids.add(requireValue(requireValue(related[0]).requestId));
      assert.ok(requireValue(requireValue(related.at(-1)).data.durationMs) >= 0);
    }
    assert.equal(ids.size, 2);
  }));

void test("operation failures keep their original error and stack instead of becoming logging errors", async () =>
  temporary(async (directory) => {
    const logger = new SessionLogger({ directory, startup });
    const error = new Error("Steam query failed");
    await assert.rejects(
      loggedOperation(logger, "steam:refresh-subscriptions", {}, () => {
        throw error;
      }),
      (caught) => caught === error,
    );
    logger.close();
    const failure = requireValue((await records(logger.path)).at(-1));
    assert.equal(failure.event, "ipc.request.failed");
    assert.match(requireValue(requireValue(failure.data.error).stack), /Steam query failed/);
    assert.ok(failure.requestId);
  }));

void test("Steam client snapshot failures record counts and stacks with the originating request id", async () =>
  temporary(async (directory) => {
    const logger = new SessionLogger({ directory, startup });
    setSessionLogger(logger);
    const native: SteamworksClient = {
      localplayer: {
        getSteamId: () => ({ steamId64: 76561198000000000n, steamId32: "test", accountId: 1234 }),
      },
      workshop: {
        getSubscribedItems: () => [0n],
        installInfo: () => null,
        subscribe: async () => assert.fail("No real subscription changes"),
        unsubscribe: async () => assert.fail("No real subscription changes"),
      },
    };
    await assert.rejects(
      loggedOperation(logger, "steam:refresh-subscriptions", {}, () =>
        createSteamClient(native).refreshSubscribedIds(),
      ),
      /invalid/,
    );
    logger.close();
    const entries = (await records(logger.path)).slice(1);
    const snapshot = requireValue(
      entries.find((entry) => entry.event === "steam.subscriptions.client-snapshot"),
    );
    assert.equal(snapshot.data.count, 1);
    assert.equal(new Set(entries.map((entry) => entry.requestId)).size, 1);
    assert.ok(requireValue(requireValue(entries.at(-1)).data.error).stack);
  }));

void test("disk-write failures disable only logging and cannot interrupt an operation or mask its original failure", async () =>
  temporary(async (directory) => {
    const errors: unknown[] = [];
    const logger = new SessionLogger({
      directory,
      startup,
      write: () => {
        throw new Error("Disk full");
      },
      onError: (error) => errors.push(error),
    });
    assert.ok(logger.failure);
    assert.equal(await loggedOperation(logger, "save", {}, async () => "saved"), "saved");
    const original = new Error("Original operation error");
    await assert.rejects(
      loggedOperation(logger, "save", {}, () => {
        throw original;
      }),
      (error) => error === original,
    );
    assert.equal(errors.length, 1);
    logger.close();
  }));

void test("fatal exceptions and unhandled rejections are flushed on disk without suppressing the process's failure exit", async () =>
  temporary(async (directory) => {
    const bundle = join(directory, "logging-process.mjs");
    await build({
      entryPoints: [join(process.cwd(), "tests/fixtures/logging-process.ts")],
      outfile: bundle,
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
      logLevel: "silent",
    });
    for (const mode of ["uncaught", "rejection"]) {
      const output = join(directory, mode);
      const child = spawnSync(process.execPath, [bundle, output, mode], {
        encoding: "utf8",
        timeout: 10000,
      });
      assert.equal(child.status, 1, child.stderr);
      const files = await readdir(output);
      const entries = await records(join(output, requireValue(files[0])));
      assert.ok(entries.some((entry) => entry.event === "test.buffered-before-crash"));
      const fatal = requireValue(entries.find((entry) => entry.level === "FATAL"));
      assert.ok(requireValue(fatal.data.error).stack);
      assert.equal(
        fatal.data.origin,
        mode === "rejection" ? "unhandledRejection" : "uncaughtException",
      );
      assert.equal(requireValue(entries.at(-1)).data.exitCode, 1);
    }
  }));
