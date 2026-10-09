import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

import type { IpcChannel } from "../../src/shared/ipc";

export const harness = Object.freeze({
  rootEnv: "RIMLIB_E2E_ROOT",
  tokenEnv: "RIMLIB_E2E_TOKEN",
  prefix: "rimlib-e2e-",
  marker: ".e2e-owner",
  controls: "controls.json",
  calls: "native-calls.jsonl",
});

export interface Controls {
  steamRunning: boolean;
  gameRunning: boolean;
  subscribedIds: string[];
  failSubscriptionIds: string[];
  ipcErrors: Partial<Record<IpcChannel, string>>;
  ipcDelays: Partial<Record<IpcChannel, number>>;
  metadataStatus: number;
  cancelDialog: boolean;
  shellError: string;
}

export interface NativeCall {
  kind: string;
  value: string;
}

function isSameDirectory(first: string, second: string): boolean {
  const firstStats = statSync(first, { bigint: true });
  const secondStats = statSync(second, { bigint: true });
  return (
    firstStats.isDirectory() &&
    secondStats.isDirectory() &&
    firstStats.dev === secondStats.dev &&
    firstStats.ino === secondStats.ino
  );
}

export function verifyFixture(root: string, token: string): string {
  const canonical = realpathSync(root);
  if (
    !isAbsolute(root) ||
    !isSameDirectory(dirname(canonical), tmpdir()) ||
    !basename(canonical).startsWith(harness.prefix) ||
    !token ||
    readFileSync(join(canonical, harness.marker), "utf8") !== token
  ) {
    throw new Error("E2E launcher requires an owned, disposable temporary directory.");
  }
  return canonical;
}

export function fixturePath(root: string, path: string): string {
  const suffix = relative(root, path);
  if (!isAbsolute(path) || suffix === ".." || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) {
    throw new Error("E2E access outside the disposable fixture was blocked.");
  }
  let ancestor = path;
  while (!existsSync(ancestor)) {
    ancestor = dirname(ancestor);
  }
  const canonicalSuffix = relative(root, realpathSync(ancestor));
  if (
    canonicalSuffix === ".." ||
    canonicalSuffix.startsWith(`..${sep}`) ||
    isAbsolute(canonicalSuffix)
  ) {
    throw new Error("E2E access through a symlink outside the fixture was blocked.");
  }
  return path;
}
