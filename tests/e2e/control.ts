import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { type Controls, fixturePath, harness, verifyFixture } from "./contracts";

export const root = verifyFixture(
  process.env[harness.rootEnv] ?? "",
  process.env[harness.tokenEnv] ?? "",
);
export const paths = Object.freeze({
  userData: join(root, "user-data"),
  session: join(root, "session"),
  logs: join(root, "logs"),
  workshop: join(root, "Steam library with spaces", "steamapps", "workshop", "content", "294100"),
  config: join(root, "game-config", "ModsConfig.xml"),
});

export function controls(): Controls {
  return JSON.parse(readFileSync(join(root, harness.controls), "utf8")) as Controls;
}

export function record(kind: string, value: string): void {
  appendFileSync(join(root, harness.calls), `${JSON.stringify({ kind, value })}\n`);
}

export function changeSubscription(id: string, subscribed: boolean): void {
  const current = controls();
  if (!current.steamRunning || current.failSubscriptionIds.includes(id)) {
    throw new Error("Simulated Steam subscription failure");
  }
  const ids = new Set(current.subscribedIds);
  if (subscribed) {
    ids.add(id);
  } else {
    ids.delete(id);
  }
  writeFileSync(
    join(root, harness.controls),
    JSON.stringify({ ...current, subscribedIds: [...ids] }),
  );
  record(subscribed ? "subscribe" : "unsubscribe", id);
}

export function checkedPath(path: string): string {
  return fixturePath(root, path);
}
