import { createRequire } from "node:module";

import type { Client } from "steamworks.js";

import { steamStatusSources } from "../shared/domainConstants";
import { steamLimits } from "../shared/limits";
import { maxSteamAccountId, RIMWORLD_APP_ID } from "../shared/steam";
import type { SteamOperationProgress } from "../shared/types";
import { log } from "./logging";

export interface SteamClient {
  refreshSubscribedIds(
    progress?: (value: SteamOperationProgress) => void,
    force?: boolean,
  ): Promise<string[]>;
  subscribedIds(): string[];
  installPath(id: string): string | undefined;
  subscribe(id: string): Promise<void>;
  unsubscribe(id: string): Promise<void>;
}

export interface SteamworksClient {
  localplayer: Pick<Client["localplayer"], "getSteamId">;
  workshop: Pick<
    Client["workshop"],
    "getSubscribedItems" | "installInfo" | "subscribe" | "unsubscribe"
  >;
}

let client: SteamClient | undefined;

export function createSteamClient(native: SteamworksClient): SteamClient {
  const workshop = native.workshop;
  let snapshot: Set<string> | undefined;
  let snapshotAccount: number | undefined;
  let refreshedAt = 0;
  const account = () => {
    const id = native.localplayer.getSteamId().accountId;
    if (!Number.isInteger(id) || id <= 0 || id > maxSteamAccountId) {
      throw new Error("Cannot identify the signed-in Steam account.");
    }
    return id;
  };
  const subscriptions = () => {
    if (!snapshot || snapshotAccount !== account()) {
      throw new Error("Steam subscriptions have not been verified. Synchronize Steam first.");
    }
    return snapshot;
  };
  return {
    async refreshSubscribedIds(progress, force = true) {
      const accountId = account();
      if (
        !force &&
        snapshotAccount === accountId &&
        snapshot &&
        Date.now() - refreshedAt < steamLimits.subscriptionCacheMs
      ) {
        log.debug("steam.subscriptions.snapshot.reused", {
          count: snapshot.size,
          ageMs: Date.now() - refreshedAt,
        });
        return [...snapshot];
      }
      log.info("steam.subscriptions.refresh.started", { force });
      refreshedAt = 0;
      try {
        progress?.({ message: "Reading Steam client subscription IDs...", completed: 0, total: 1 });
        const items: unknown = await Promise.resolve(workshop.getSubscribedItems());
        log.debug("steam.subscriptions.client-snapshot", {
          count: Array.isArray(items) ? items.length : undefined,
        });
        if (
          !Array.isArray(items) ||
          items.some((id: unknown) => typeof id !== "bigint" || id <= 0n)
        ) {
          throw new Error(
            "Steam returned invalid Workshop ids. Saved subscriptions were preserved.",
          );
        }
        if (account() !== accountId) {
          throw new Error(
            "The Steam account changed during synchronization. Saved subscriptions were preserved.",
          );
        }
        const ids = new Set(items.map((id: unknown) => String(id)));
        if (ids.size !== items.length) {
          throw new Error(
            "Steam returned duplicate Workshop ids. Saved subscriptions were preserved.",
          );
        }
        snapshot = ids;
        snapshotAccount = accountId;
        refreshedAt = Date.now();
        log.info("steam.subscriptions.refresh.completed", {
          count: ids.size,
          source: steamStatusSources.steamClient,
        });
        return [...ids];
      } catch (error) {
        log.error("steam.subscriptions.refresh.failed", { error });
        throw error;
      }
    },
    subscribedIds: () => [...subscriptions()],
    installPath: (id) => workshop.installInfo(BigInt(id))?.folder,
    async subscribe(id) {
      const ids = subscriptions();
      log.info("steam.mod.subscribe.started", { workshopId: id });
      try {
        await workshop.subscribe(BigInt(id));
        ids.add(id);
        log.info("steam.mod.subscribe.completed", { workshopId: id });
      } catch (error) {
        log.error("steam.mod.subscribe.failed", { workshopId: id, error });
        throw error;
      }
    },
    async unsubscribe(id) {
      const ids = subscriptions();
      log.info("steam.mod.unsubscribe.started", { workshopId: id });
      try {
        await workshop.unsubscribe(BigInt(id));
        ids.delete(id);
        log.info("steam.mod.unsubscribe.completed", { workshopId: id });
      } catch (error) {
        log.error("steam.mod.unsubscribe.failed", { workshopId: id, error });
        throw error;
      }
    },
  };
}

export function getSteamClient(): SteamClient {
  if (client) {
    return client;
  }
  let native: SteamworksClient;
  log.info("steam.client.connecting", { appId: RIMWORLD_APP_ID });
  try {
    const require = createRequire(import.meta.url);
    const steamworks = require("steamworks.js") as { init(id: number): SteamworksClient };
    native = steamworks.init(RIMWORLD_APP_ID);
    log.info("steam.client.connected", { appId: RIMWORLD_APP_ID });
  } catch (error) {
    log.error("steam.client.connection.failed", { error });
    throw new Error(
      `Cannot connect to Steam. Start Steam, sign in to the account that owns RimWorld, and ensure steamworks.js is installed (npm install). ${(error as Error).message}`,
      { cause: error },
    );
  }
  client = createSteamClient(native);
  return client;
}

export class SteamRequestTimeoutError extends Error {
  constructor() {
    super(
      "Steam request timed out. Steam may still be finishing it; RimLib will verify the result automatically.",
    );
    this.name = "SteamRequestTimeoutError";
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number = steamLimits.subscriptionTimeoutMs,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          log.error("steam.request.timed-out", { milliseconds });
          reject(new SteamRequestTimeoutError());
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
