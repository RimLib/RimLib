import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { test } from "node:test";

import fc from "fast-check";

import type { SteamClient } from "../src/main/steamClient";
import { SteamOperations } from "../src/main/steamOperations";
import { VaultStore } from "../src/main/vaultStore";
import type { ActiveModsState } from "../src/shared/types";
import { normalizeVault, serializeVault } from "../src/shared/vault";
import {
  filesystemPropertyOptions,
  modArbitrary,
  temporaryVault,
  workshopIdArbitrary,
} from "./helpers/properties";

const guardCases = Object.freeze({
  active: "active",
  unreadable: "unreadable",
  metadataMissing: "metadata-missing",
  becameActive: "became-active",
} as const);

void test("property: native unsubscribe never reaches Steam for Active or unverifiable targets, including changes after the first check", async () => {
  await fc.assert(
    fc.asyncProperty(
      modArbitrary,
      workshopIdArbitrary,
      fc.constantFrom(...Object.values(guardCases)),
      async (metadata, id, scenario) =>
        temporaryVault(async (path) => {
          const mod = {
            ...metadata,
            id: `steam-${id}`,
            workshopId: id,
            packageId: `test.mod${id}`,
            subscribed: true,
          };
          await writeFile(
            path,
            JSON.stringify(
              serializeVault(
                normalizeVault({
                  mods: [mod],
                  localSteamState: { observedIds: [id], pending: {} },
                }),
              ),
            ),
          );
          const store = new VaultStore(path);
          const before = await store.load();
          const calls: string[] = [];
          const client: SteamClient = {
            refreshSubscribedIds: async () => [id],
            subscribedIds: () => [id],
            installPath: () => "/virtual/mod",
            subscribe: async () => {
              calls.push("subscribe");
            },
            unsubscribe: async () => {
              calls.push("unsubscribe");
            },
          };
          let checks = 0;
          const service = new SteamOperations(
            store,
            () => undefined,
            () => client,
            {
              assertClosed: async () => undefined,
              about: async () => ({
                packageId: scenario === guardCases.metadataMissing ? undefined : mod.packageId,
                author: undefined,
              }),
              activeMods: async (): Promise<ActiveModsState> => {
                checks++;
                return {
                  packageIds:
                    scenario === guardCases.active ||
                    (scenario === guardCases.becameActive && checks > 1)
                      ? [mod.packageId.toUpperCase() + "_steam"]
                      : [],
                  ...(scenario === guardCases.unreadable ? { error: "Config is unavailable" } : {}),
                };
              },
              discover: async () => {
                throw new Error("Unexpected real discovery");
              },
            },
          );
          if (scenario === guardCases.becameActive) {
            const result = await service.setSubscription(mod.id, false);
            assert.equal(result.unsubscribed, 0);
            assert.equal(result.failures.length, 1);
            assert.match(result.failures[0] ?? "", /Active mods cannot/);
          } else {
            await assert.rejects(service.setSubscription(mod.id, false), /Active|verified/);
          }
          assert.deepEqual(calls, []);
          assert.deepEqual((await store.load()).mods, before.mods);
          assert.deepEqual((await store.load()).localSteamState, before.localSteamState);
          assert.deepEqual((await new VaultStore(path).load()).mods, before.mods);
        }),
    ),
    filesystemPropertyOptions,
  );
});
