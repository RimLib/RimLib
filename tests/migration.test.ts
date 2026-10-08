import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { normalizeVault } from "../src/shared/vault";
import { parseStoredVault } from "../src/shared/vaultValidation";

const run = promisify(execFile);

void test("v2 migration backs up the source and emits the non-repeating v3 vault", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rimlib-vault-migration-"));
  try {
    const path = join(directory, "mod-vault.json");
    const source = {
      schemaVersion: 2,
      revision: "v2-revision",
      mods: [
        {
          id: "steam-1",
          workshopId: "1",
          name: "One",
          subscribed: false,
          notes: "Keep",
        },
        { id: "steam-2", workshopId: "2", name: "Two", subscribed: true },
      ],
      userTags: [{ id: "qol", name: "QoL", color: "#ffffff" }],
      settings: { workshopModsPath: "/workshop" },
      steamSubscribedIds: ["1"],
      steamStatusSource: "workshop-folders",
      workshopSubscriptionOverrides: { "1": true, "2": false },
      selectedModId: "steam-1",
      subscriptionSelection: { modSnapshots: { duplicated: true } },
      futureExtension: { preserve: true },
    };
    const raw = `${JSON.stringify(source, null, 2)}\n`;
    await writeFile(path, raw);

    const { stdout } = await run(process.execPath, [
      join(process.cwd(), "scripts", "migrate-vault-v2-to-v3.mjs"),
      path,
    ]);
    assert.match(stdout, /Migrated 2 mods and 1 tags to schema v3/);

    const stored: unknown = JSON.parse(await readFile(path, "utf8"));
    assert.strictEqual(parseStoredVault(stored), stored);
    const record = stored as Record<string, unknown>;
    assert.equal(record.schemaVersion, 3);
    assert.equal(Object.hasOwn(record, "mods"), false);
    assert.equal(Object.hasOwn(record, "userTags"), false);
    assert.equal(Object.hasOwn(record, "subscriptionSelection"), false);
    assert.equal(Object.hasOwn(record, "selectedModId"), false);
    assert.equal(Object.hasOwn(record, "steamSubscribedIds"), false);
    assert.equal(Object.hasOwn(record, "steamStatusSource"), false);
    assert.equal(Object.hasOwn(record, "workshopSubscriptionOverrides"), false);
    assert.deepEqual(record.futureExtension, { preserve: true });

    const library = record.library as { mods: Record<string, unknown>[]; tags: unknown[] };
    assert.equal(Object.hasOwn(library.mods[0] ?? {}, "subscribed"), false);
    assert.equal(library.tags.length, 1);
    assert.deepEqual(record.deviceState, {
      steam: {
        source: "workshop-folders",
        observedIds: ["2"],
        pending: { "1": "subscribe", "2": "unsubscribe" },
      },
    });
    assert.deepEqual(
      normalizeVault(stored).mods.map((mod) => [mod.id, mod.subscribed]),
      [
        ["steam-1", true],
        ["steam-2", false],
      ],
    );

    const backup = (await readdir(directory)).find((name) => name.includes(".v2-backup-"));
    assert.ok(backup);
    assert.equal(await readFile(join(directory, backup), "utf8"), raw);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
