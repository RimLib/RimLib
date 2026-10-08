import assert from "node:assert/strict";
import { test } from "node:test";

import { createSteamClient, type SteamworksClient, withTimeout } from "../src/main/steamClient";

const owner = { steamId64: 76561198000000000n, steamId32: "STEAM_0:0:1", accountId: 12345 };
function setup() {
  const ids = new Set(["1", "2"]);
  let reads = 0;
  const native: SteamworksClient = {
    localplayer: { getSteamId: () => owner },
    workshop: {
      getSubscribedItems: () => {
        reads++;
        return [...ids].map(BigInt);
      },
      installInfo: () => null,
      subscribe: async (id) => {
        ids.add(String(id));
      },
      unsubscribe: async (id) => {
        ids.delete(String(id));
      },
    },
  };
  return { native, client: createSteamClient(native), ids, reads: () => reads };
}

void test("Steam actions obtain subscription IDs without querying Workshop metadata or pages", async () => {
  const { client, reads } = setup();
  assert.throws(() => client.subscribedIds(), /not been verified/);
  assert.deepEqual(await client.refreshSubscribedIds(), ["1", "2"]);
  assert.equal(reads(), 1);
});

void test("large accounts are read without a pagination limit, including IDs with unavailable metadata", async () => {
  const { native, client } = setup();
  const ids = Array.from({ length: 2647 }, (_, index) => BigInt(index + 1));
  native.workshop.getSubscribedItems = () => ids;
  assert.deepEqual(await client.refreshSubscribedIds(), ids.map(String));
});

void test("empty client lists replace old snapshots and returned arrays do not mutate them", async () => {
  const { client, ids } = setup();
  (await client.refreshSubscribedIds()).push("9");
  assert.deepEqual(client.subscribedIds(), ["1", "2"]);
  ids.clear();
  assert.deepEqual(await client.refreshSubscribedIds(), []);
});

void test("forced refresh bypasses the short cache for individual actions", async () => {
  const { client, ids, reads } = setup();
  await client.refreshSubscribedIds();
  ids.delete("2");
  assert.deepEqual(await client.refreshSubscribedIds(undefined, false), ["1", "2"]);
  assert.equal(reads(), 1);
  assert.deepEqual(await client.refreshSubscribedIds(), ["1"]);
  assert.equal(reads(), 2);
});

void test("successful actions update the snapshot immediately while failed actions leave it intact", async () => {
  const { native, client } = setup();
  await client.refreshSubscribedIds();
  await client.unsubscribe("2");
  await client.subscribe("3");
  assert.deepEqual(client.subscribedIds(), ["1", "3"]);
  native.workshop.unsubscribe = async () => {
    throw new Error("Steam refused");
  };
  native.workshop.subscribe = async () => {
    throw new Error("Steam refused");
  };
  await assert.rejects(client.unsubscribe("1"), /refused/);
  await assert.rejects(client.subscribe("4"), /refused/);
  assert.deepEqual(client.subscribedIds(), ["1", "3"]);
});

void test("invalid or duplicate IDs cannot publish a partial snapshot", async () => {
  const { native, client } = setup();
  await client.refreshSubscribedIds();
  for (const ids of [[0n], [3n, 3n], [null], ["3"]]) {
    native.workshop.getSubscribedItems = () => ids as bigint[];
    await assert.rejects(client.refreshSubscribedIds(), /invalid|duplicate/);
    assert.deepEqual(client.subscribedIds(), ["1", "2"]);
  }
});

void test("client read failures retain the last snapshot without fallback", async () => {
  const { native, client } = setup();
  await client.refreshSubscribedIds();
  native.workshop.getSubscribedItems = () => {
    throw new Error("Steam unavailable");
  };
  await assert.rejects(client.refreshSubscribedIds(), /unavailable/);
  assert.deepEqual(client.subscribedIds(), ["1", "2"]);
});

void test("account switches and invalid accounts cannot reuse another account's snapshot", async () => {
  const { native, client } = setup();
  await client.refreshSubscribedIds();
  native.workshop.getSubscribedItems = () => {
    native.localplayer.getSteamId = () => ({ ...owner, accountId: owner.accountId + 1 });
    return [3n];
  };
  await assert.rejects(client.refreshSubscribedIds(), /account changed/);
  assert.throws(() => client.subscribedIds(), /not been verified/);
  native.localplayer.getSteamId = () => owner;
  assert.deepEqual(client.subscribedIds(), ["1", "2"]);
  native.localplayer.getSteamId = () => ({ ...owner, accountId: 0 });
  await assert.rejects(client.refreshSubscribedIds(), /identify/);
});

void test("Steam timeouts do not treat silence as success", async () => {
  await assert.rejects(withTimeout(new Promise(() => undefined), 5), /timed out/);
});
