import assert from "node:assert/strict";
import { test } from "node:test";

import { fileErrorCodes, platforms } from "../src/main/platformConstants";
import {
  isModSort,
  isSearchScope,
  modPanelModes,
  modSorts,
  searchScopes,
} from "../src/renderer/src/utils/uiConstants";
import {
  hasConstantValue,
  modActivities,
  modSources,
  steamStatusSources,
  subscriptionActions,
} from "../src/shared/domainConstants";
import { type IpcChannel, ipcChannels, ipcEvents, validateIpcArgs } from "../src/shared/ipc";
import { maxIpcTextLength, steamLimits } from "../src/shared/limits";
import { logLevels, rendererErrorEvents } from "../src/shared/logging";
import {
  browserStorageKeys,
  vaultBackupDirectory,
  vaultBackupSuffix,
  vaultFileName,
} from "../src/shared/storage";
import type { SubscriptionAction } from "../src/shared/types";
import { normalizeVault } from "../src/shared/vault";

void test("domain constants retain persisted wire values and expose only current actions", () => {
  assert.deepEqual(modSources, { steam: "steam", local: "local", manual: "manual" });
  assert.deepEqual(steamStatusSources, {
    workshopFolders: "workshop-folders",
    steamClient: "steam-client",
  });
  assert.deepEqual(modActivities, { active: "active", inactive: "inactive", unknown: "unknown" });
  assert.deepEqual(subscriptionActions, {
    subscribeMods: "subscribe-mods",
    unsubscribeMods: "unsubscribe-mods",
  });
  for (const action of Object.values(subscriptionActions)) {
    assert.equal(hasConstantValue(subscriptionActions, action), true);
  }
  assert.equal(Object.values(subscriptionActions).length, 2);
});

void test("constant guards accept only actual values, with no coercion, key names or prototype lookup", () => {
  for (const value of [
    undefined,
    null,
    false,
    1,
    {},
    [],
    ["subscribe-mods"],
    "subscribeMods",
    "toString",
    "constructor",
    "unsubscribe-everything",
  ]) {
    assert.equal(hasConstantValue(subscriptionActions, value), false);
  }
  const candidate: unknown = "unsubscribe-mods";
  if (hasConstantValue(subscriptionActions, candidate)) {
    const action: SubscriptionAction = candidate;
    assert.equal(action, subscriptionActions.unsubscribeMods);
  } else {
    assert.fail("A known action must be accepted and narrowed");
  }
  const numeric = Object.freeze({ timeout: 4 });
  assert.equal(hasConstantValue(numeric, 4), true);
  assert.equal(hasConstantValue(numeric, "4"), false);
  assert.equal(hasConstantValue(numeric, 5), false);
});

void test("IPC accepts explicit subscription targets and rejects retired actions and channels", () => {
  for (const action of Object.values(subscriptionActions)) {
    const checked: SubscriptionAction = action;
    assert.doesNotThrow(() => {
      validateIpcArgs(ipcChannels.previewLibrarySubscriptions, [checked, ["steam-1"]]);
    });
    assert.throws(() => {
      validateIpcArgs(ipcChannels.previewLibrarySubscriptions, [checked]);
    }, /Invalid/);
  }
  for (const action of [
    "subscribe-selected",
    "unsubscribe-outside",
    "apply-active",
    "unsubscribe-inactive",
  ]) {
    assert.throws(() => {
      validateIpcArgs(ipcChannels.previewLibrarySubscriptions, [action, ["steam-1"]]);
    }, /Invalid/);
  }
  for (const value of [
    "unsubscribe-everything",
    "subscribeMods",
    undefined,
    {},
    1,
    ["subscribe-mods"],
  ]) {
    assert.throws(() => {
      validateIpcArgs(ipcChannels.previewLibrarySubscriptions, [value, ["steam-1"]]);
    }, /Invalid/);
  }
  for (const channel of [
    "steam:preview-subscriptions",
    "steam:apply-subscriptions",
    "mod-store:delete-mod",
    "toString",
    "constructor",
  ]) {
    assert.throws(() => {
      validateIpcArgs(channel as IpcChannel, ["old-token"]);
    }, /Invalid application request/);
  }
  assert.throws(() => {
    validateIpcArgs(ipcChannels.save, [{ mods: [] }, { unsupportedOption: ["value"] }]);
  }, /Invalid application request/);
  const channels = [...Object.values(ipcChannels), ...Object.values(ipcEvents)];
  assert.equal(new Set(channels).size, channels.length);
  assert.deepEqual(ipcEvents, {
    steamProgress: "steam:progress",
    beforeClose: "app:before-close",
    closeReady: "app:close-ready",
    rendererError: "diagnostics:renderer-error",
  });
});

void test("IPC text limit accepts the boundary and rejects oversized requests before any action", () => {
  assert.equal(maxIpcTextLength, 32768);
  assert.doesNotThrow(() => {
    validateIpcArgs(ipcChannels.revealModFolder, ["a".repeat(maxIpcTextLength)]);
  });
  assert.throws(() => {
    validateIpcArgs(ipcChannels.revealModFolder, ["a".repeat(maxIpcTextLength + 1)]);
  }, /Invalid/);
});

void test("current sources and folder/client status snapshots load with unknown fields intact", () => {
  for (const source of ["steam", "local", "manual"]) {
    for (const steamStatusSource of ["workshop-folders", "steam-client"]) {
      const input = {
        mods: [{ id: "steam-1", name: "Preserved", source, extension: "keep" }],
        localSteamState: { source: steamStatusSource, observedIds: [], pending: {} },
        extension: "keep",
      };
      const before = JSON.stringify(input);
      const result = normalizeVault(input);
      assert.equal(result.mods[0]?.source, source);
      assert.equal(result.localSteamState.source, steamStatusSource);
      assert.ok(JSON.stringify(result).includes('"extension":"keep"'));
      assert.equal(JSON.stringify(input), before);
    }
  }
  for (const source of ["Steam", 0, "unexpected", {}]) {
    assert.throws(
      () => normalizeVault({ mods: [{ id: "1", name: "Invalid", source }] }),
      /Invalid mod source/,
    );
  }
  assert.throws(
    () =>
      normalizeVault({
        mods: [],
        localSteamState: { source: "unknown", observedIds: [], pending: {} },
      }),
    /Invalid Steam status source/,
  );
});

void test("storage and UI identifiers use current names while constant maps cannot be changed at runtime", () => {
  assert.equal(vaultFileName, "mod-vault.json");
  assert.equal(vaultBackupDirectory, "backups");
  assert.equal(vaultBackupSuffix, ".bak");
  assert.deepEqual(browserStorageKeys, {
    vault: "rimlib:vault",
    vaultBackup: "rimlib:vault:backup",
  });
  assert.deepEqual(modPanelModes, { subscribed: "subscribed", unsubscribed: "unsubscribed" });
  assert.deepEqual(searchScopes, {
    all: "all",
    title: "title",
    author: "author",
    description: "description",
    tags: "tags",
  });
  assert.deepEqual(platforms, { macOS: "darwin", windows: "win32", linux: "linux" });
  assert.deepEqual(fileErrorCodes, {
    notFound: "ENOENT",
    notDirectory: "ENOTDIR",
    accessDenied: "EACCES",
    notPermitted: "EPERM",
  });
  for (const values of [
    subscriptionActions,
    modSources,
    steamStatusSources,
    ipcChannels,
    ipcEvents,
    browserStorageKeys,
    modPanelModes,
    modSorts,
    searchScopes,
    logLevels,
    rendererErrorEvents,
    steamLimits,
  ]) {
    const key = Object.keys(values)[0];
    assert.ok(key);
    assert.equal(Object.isFrozen(values), true);
    assert.equal(Reflect.set(values, key, "changed"), false);
  }
  for (const value of Object.values(modSorts)) {
    assert.equal(isModSort(value), true);
  }
  for (const value of ["unknown", "Active", 0, undefined, "toString"]) {
    assert.equal(isModSort(value), false);
    assert.equal(isSearchScope(value), false);
  }
  for (const value of Object.values(searchScopes)) {
    assert.equal(isSearchScope(value), true);
  }
});
