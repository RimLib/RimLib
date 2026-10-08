import assert from "node:assert/strict";
import { test } from "node:test";

import { type IpcChannel, ipcChannels, validateIpcArgs } from "../src/shared/ipc";
import { errorCode, isRecord, requireValue } from "../src/shared/validation";
import { normalizeVault } from "../src/shared/vault";

const savedMod = { id: "1", name: "Preserved", customModField: { keep: true } };

void test("validation rejects malformed known metadata before it can reach the UI or overwrite a database", () => {
  for (const patch of [
    { summary: 123 },
    { source: "unexpected" },
    { subscribed: "false" },
    { notes: [] },
    { tags: [1] },
    { fileSize: -1 },
    { fileSize: Infinity },
  ]) {
    assert.throws(() => normalizeVault({ mods: [{ ...savedMod, ...patch }] }), /Invalid/);
  }
  for (const settings of [[], "path", { rimWorldConfigPath: false }, { workshopModsPath: 42 }]) {
    assert.throws(() => normalizeVault({ mods: [], settings }), /Invalid/);
  }
});

void test("normalization fills metadata defaults and preserves unknown fields in every current record", () => {
  const original = {
    mods: [savedMod],
    customVaultField: "keep",
    settings: { futureSetting: true },
  };
  const before = JSON.stringify(original);
  const next = normalizeVault(original);
  const serialized = JSON.stringify(next);
  for (const field of ["customModField", "customVaultField", "futureSetting"]) {
    assert.ok(serialized.includes(field));
  }
  assert.equal(requireValue(next.mods[0]).subscribed, false);
  assert.equal(requireValue(next.mods[0]).summary, "");
  assert.deepEqual(requireValue(next.mods[0]).screenshots, []);
  assert.equal(JSON.stringify(original), before);
});

void test("unsupported database versions are refused without conversion", () => {
  assert.throws(() => normalizeVault({ schemaVersion: 999 }), /newer app version/);
  assert.throws(
    () => normalizeVault({ schemaVersion: 1, mods: [] }),
    /Unsupported database schema/,
  );
});

void test("IPC channels are unique and no-argument requests reject injected arguments", () => {
  const channels = Object.values(ipcChannels);
  assert.equal(new Set(channels).size, channels.length);
  for (const channel of [
    "mod-store:load",
    "steam:sync",
    "steam:status",
    "diagnostics:open-logs",
  ] as const) {
    assert.doesNotThrow(() => {
      validateIpcArgs(channel, []);
    });
    assert.throws(() => {
      validateIpcArgs(channel, ["injected"]);
    }, /Invalid application request/);
  }
});

void test("destructive IPC requests require real booleans, identifiers and explicit actions", () => {
  const requests: [IpcChannel, unknown[]][] = [
    ["steam:set-subscription", ["1", "false"]],
    ["steam:set-subscription", ["1"]],
    ["mod-store:delete-library-mods", [[1]]],
    ["mod-store:delete-library-mods", [null]],
    ["steam:preview-library-subscriptions", ["unsubscribe-everything"]],
    ["steam:preview-library-subscriptions", [["unsubscribe-inactive"]]],
    ["steam:preview-library-subscriptions", ["subscribe-mods", null]],
    ["steam:preview-library-subscriptions", ["unsubscribe-mods"]],
    ["mod-store:save", [{ mods: [] }, { deletedTagIds: [1] }]],
  ];
  for (const [channel, args] of requests) {
    assert.throws(() => {
      validateIpcArgs(channel, args);
    }, /Invalid/);
  }
  assert.doesNotThrow(() => {
    validateIpcArgs("steam:set-subscription", ["1", false]);
  });
  assert.doesNotThrow(() => {
    validateIpcArgs("mod-store:delete-library-mods", [["1", "2"]]);
  });
  assert.doesNotThrow(() => {
    validateIpcArgs("mod-store:save", [{ mods: [savedMod] }]);
  });
});

void test("validation helpers do not confuse falsy values with missing ones", () => {
  assert.equal(requireValue(false), false);
  assert.equal(requireValue(0), 0);
  assert.equal(requireValue(""), "");
  assert.throws(() => {
    requireValue(undefined);
  }, /Required value/);
  assert.throws(() => requireValue(null), /Required value/);
  assert.equal(isRecord([]), false);
  assert.equal(isRecord(null), false);
  assert.equal(errorCode({ code: "ENOENT" }), "ENOENT");
  assert.equal(errorCode("ENOENT"), undefined);
});
