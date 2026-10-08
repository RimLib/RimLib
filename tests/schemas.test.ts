import assert from "node:assert/strict";
import { test } from "node:test";

import { subscriptionActions } from "../src/shared/domainConstants";
import { type IpcChannel, ipcChannels, validateIpcArgs } from "../src/shared/ipc";
import { maxIpcTextLength } from "../src/shared/limits";
import type { Mod } from "../src/shared/types";
import { isRecord, requireValue } from "../src/shared/validation";
import { mergeSteamSync, normalizeVault, serializeVault } from "../src/shared/vault";
import { parseStoredVault } from "../src/shared/vaultValidation";
import { assertUnchanged, steamImport } from "./helpers/properties";

const mod = { id: "saved-mod", name: "Saved mod" };
const storedVault = ({
  mods = [],
  userTags = [],
  libraryExtensions = {},
  deviceState = { steam: { observedIds: [], pending: {} } },
  ...rest
}: {
  mods?: unknown[];
  userTags?: unknown[];
  libraryExtensions?: Record<string, unknown>;
  deviceState?: unknown;
  [key: string]: unknown;
}) => ({
  schemaVersion: 3,
  ...rest,
  library: { ...libraryExtensions, mods, tags: userTags },
  deviceState,
});

void test("property comparisons preserve null prototypes while still detecting nested mutations", () => {
  const nested: Record<string, unknown> = { retained: true };
  Object.setPrototypeOf(nested, null);
  const input = { nested: [nested], optional: undefined };
  assert.doesNotThrow(() => {
    assertUnchanged(input, () => undefined);
  });
  assert.throws(() => {
    assertUnchanged(input, () => {
      nested.retained = false;
    });
  }, assert.AssertionError);
});

void test("database schemas validate every optional mod string and array without coercing stored values", () => {
  const textFields = [
    "author",
    "summary",
    "workshopId",
    "packageId",
    "url",
    "downloadedAt",
    "addedAt",
    "thumbnail",
    "notes",
    "metadataUpdatedAt",
    "steamCreatorId",
    "steamPublishedAt",
    "steamUpdatedAt",
    "localPath",
  ] as const satisfies readonly (keyof Mod)[];
  const arrayFields = [
    "tags",
    "gameVersions",
    "screenshots",
    "userTagIds",
  ] as const satisfies readonly (keyof Mod)[];
  for (const field of textFields) {
    for (const value of [null, false, 42, [], {}]) {
      assert.throws(
        () => parseStoredVault(storedVault({ mods: [{ ...mod, [field]: value }] })),
        /Invalid/,
      );
    }
    for (const value of [undefined, "", "stored value"]) {
      const input = storedVault({ mods: [{ ...mod, [field]: value }] });
      assert.strictEqual(parseStoredVault(input), input);
    }
  }
  for (const field of arrayFields) {
    for (const value of [null, false, "tag", {}, ["valid", 42], [undefined]]) {
      assert.throws(
        () => parseStoredVault(storedVault({ mods: [{ ...mod, [field]: value }] })),
        /Invalid/,
      );
    }
    const input = storedVault({ mods: [{ ...mod, [field]: ["", "stored value"] }] });
    assert.strictEqual(parseStoredVault(input), input);
  }
});

void test("database schemas validate and preserve declared mod dependencies", () => {
  const dependencies = [
    { packageId: "brrainz.harmony", displayName: "Harmony", futureField: "preserved" },
  ];
  const input = storedVault({ mods: [{ ...mod, dependencies }] });
  assert.strictEqual(parseStoredVault(input), input);
  assert.deepEqual(normalizeVault(input).mods[0]?.dependencies, dependencies);
  for (const dependencies of [null, false, "Harmony", {}, [{}], [{ packageId: "" }]]) {
    assert.throws(
      () => parseStoredVault(storedVault({ mods: [{ ...mod, dependencies }] })),
      /Invalid/,
    );
  }
});

void test("database schemas retain every unknown JSON field, including prototype-like keys at all levels", () => {
  const extensions = Object.fromEntries<unknown>([
    ["__proto__", { future: true }],
    ["constructor", "saved extension"],
    ["toString", ["saved extension"]],
  ]);
  const saved = { ...mod, ...extensions };
  const input = storedVault({
    ...extensions,
    mods: [saved],
    libraryExtensions: extensions,
    settings: { ...extensions },
    userTags: [{ ...extensions, id: "tag", name: "My tag", color: "named color" }],
    deviceState: {
      ...extensions,
      steam: { ...extensions, observedIds: [], pending: {} },
    },
  });
  const before = JSON.stringify(input);
  assert.strictEqual(parseStoredVault(input), input);
  const normalized = normalizeVault(input);
  const serialized = serializeVault(normalized);
  const records: unknown[] = [
    normalized,
    normalized.mods[0],
    normalized.settings,
    normalized.userTags[0],
    normalized.libraryExtensions,
    normalized.deviceStateExtensions,
    normalized.localSteamState,
    serialized,
    serialized.library,
    serialized.library.mods[0],
    serialized.library.tags[0],
    serialized.settings,
    serialized.deviceState,
    serialized.deviceState.steam,
  ];
  for (const record of records) {
    assert.ok(isRecord(record));
    for (const [key, value] of Object.entries(extensions)) {
      assert.ok(Object.hasOwn(record, key));
      assert.deepEqual(record[key], value);
    }
    assert.strictEqual(Object.getPrototypeOf(record), Object.prototype);
  }
  assert.equal(JSON.stringify(input), before);
});

void test("subscription overrides reject prototype-like IDs", () => {
  assert.throws(
    () =>
      parseStoredVault({
        ...storedVault({}),
        deviceState: {
          steam: {
            observedIds: [],
            pending: Object.fromEntries([["__proto__", "subscribe"]]),
          },
        },
      }),
    /Invalid pending Workshop subscription changes/,
  );
});

void test("database schema failures identify the field without exposing private input data", () => {
  assert.throws(
    () => parseStoredVault(storedVault({ mods: [{ ...mod, notes: { secret: "private-note" } }] })),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /library\.mods\.0\.notes/);
      assert.match(error.message, /Database writes have been blocked/);
      assert.doesNotMatch(error.message, /private-note/);
      return true;
    },
  );
  assert.throws(
    () => parseStoredVault({ ...storedVault({}), schemaVersion: 999 }),
    /newer app version/,
  );
  for (const schemaVersion of [null, "3", false, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => parseStoredVault({ ...storedVault({}), schemaVersion }), /Invalid/);
  }
});

void test("Firebase settings validate known fields and preserve future web configuration extensions", () => {
  const firebaseSync = {
    enabled: true,
    apiKey: "web-key",
    authDomain: "project.firebaseapp.com",
    projectId: "project",
    appId: "app-id",
    email: "owner@example.com",
    futureWebOption: "preserved",
  };
  const input = storedVault({ settings: { firebaseSync } });
  assert.strictEqual(parseStoredVault(input), input);
  assert.equal(normalizeVault(input).settings?.firebaseSync?.projectId, "project");
  for (const [field, value] of [
    ["enabled", "yes"],
    ["apiKey", 42],
    ["authDomain", false],
    ["projectId", null],
    ["appId", []],
    ["email", {}],
  ] as const) {
    assert.throws(
      () =>
        parseStoredVault(
          storedVault({
            settings: { firebaseSync: { ...firebaseSync, [field]: value } },
          }),
        ),
      /Invalid .*Database writes have been blocked/,
    );
  }
});

void test("every IPC channel has a schema accepting supported arities and rejecting injected arguments", () => {
  const vault = { mods: [mod] };
  const requests = {
    [ipcChannels.openLogs]: [[]],
    [ipcChannels.openDatabaseFolder]: [[]],
    [ipcChannels.revealModFolder]: [[mod.id]],
    [ipcChannels.openWorkshopInBrowser]: [["1"]],
    [ipcChannels.load]: [[]],
    [ipcChannels.save]: [[vault], [vault, undefined], [vault, { deletedTagIds: [] }]],
    [ipcChannels.deleteLibraryMods]: [[[]], [[mod.id]]],
    [ipcChannels.refreshModMetadata]: [[mod.id]],
    [ipcChannels.chooseRimWorldConfigPath]: [[]],
    [ipcChannels.chooseWorkshopModsPath]: [[], [undefined], ["/workshop"]],
    [ipcChannels.detectWorkshopModsPath]: [[]],
    [ipcChannels.validateWorkshopModsPath]: [["/workshop"]],
    [ipcChannels.getActiveMods]: [[], [undefined], [{ workshopModsPath: "", futureSetting: true }]],
    [ipcChannels.syncSubscribedMods]: [[]],
    [ipcChannels.refreshSubscriptions]: [[]],
    [ipcChannels.inspectWorkshopStatus]: [[]],
    [ipcChannels.getSteamStatus]: [[]],
    [ipcChannels.previewLibrarySubscriptions]: [
      [subscriptionActions.subscribeMods, [mod.id]],
      [subscriptionActions.unsubscribeMods, [mod.id]],
    ],
    [ipcChannels.setSubscription]: [
      [mod.id, true],
      [mod.id, false],
      [mod.id, true, undefined],
      [mod.id, false, "1"],
    ],
  } satisfies Record<IpcChannel, unknown[][]>;
  for (const channel of Object.values(ipcChannels)) {
    if (!requests[channel].some((args) => args.length === 0)) {
      assert.throws(() => {
        validateIpcArgs(channel, []);
      }, /Invalid application request/);
    }
    for (const args of requests[channel]) {
      const before = structuredClone(args);
      assert.doesNotThrow(() => {
        validateIpcArgs(channel, args);
      });
      assert.deepEqual(args, before);
      assert.throws(() => {
        validateIpcArgs(channel, [...args, undefined, "injected", "injected"]);
      }, /Invalid application request/);
    }
  }
});

void test("a first import deduplicates previews so repeated synchronization does not change saved data", () => {
  const incoming = normalizeVault({
    mods: [{ ...mod, screenshots: ["preview", "preview"] }],
  }).mods;
  const result = steamImport(incoming, []);
  const synced = mergeSteamSync(normalizeVault({ mods: [] }), result);
  assert.deepEqual(requireValue(synced.mods[0]).screenshots, ["preview"]);
  assert.equal(JSON.stringify(mergeSteamSync(synced, result)), JSON.stringify(synced));
  assert.deepEqual(requireValue(incoming[0]).screenshots, ["preview", "preview"]);
});

void test("IPC text checks retain the UTF-16 length limit and never trim or coerce arguments", () => {
  const maximum = "\ud83d\ude80".repeat(maxIpcTextLength / 2);
  assert.equal(maximum.length, maxIpcTextLength);
  validateIpcArgs(ipcChannels.revealModFolder, [maximum]);
  assert.throws(() => {
    validateIpcArgs(ipcChannels.revealModFolder, [maximum + "x"]);
  }, /Invalid/);
  for (const value of [null, false, 42, {}, [], "", " \t\n"]) {
    assert.throws(() => {
      validateIpcArgs(ipcChannels.revealModFolder, [value]);
    }, /Invalid/);
  }
  const args: unknown[] = [" /custom path "];
  validateIpcArgs(ipcChannels.revealModFolder, args);
  assert.deepEqual(args, [" /custom path "]);
});
