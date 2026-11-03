import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const importer = join(process.cwd(), "scripts", "import-mod-vault-tags-to-rimsort.mjs");

const canonicalSchema = `
  CREATE TABLE auxiliary_metadata (
    path VARCHAR NOT NULL,
    type VARCHAR NOT NULL,
    published_file_id VARCHAR,
    acf_time_touched INTEGER NOT NULL,
    acf_time_updated INTEGER NOT NULL,
    external_time_created INTEGER NOT NULL,
    external_time_updated INTEGER NOT NULL,
    user_notes VARCHAR NOT NULL,
    color_hex VARCHAR,
    ignore_warnings BOOLEAN NOT NULL,
    outdated BOOLEAN NOT NULL,
    db_time_touched DATETIME,
    PRIMARY KEY (path)
  );
  CREATE TABLE mod_tags (
    id INTEGER NOT NULL,
    tag VARCHAR NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (tag)
  );
  CREATE TABLE tags_table (
    left_id INTEGER,
    right_id INTEGER,
    FOREIGN KEY(left_id) REFERENCES auxiliary_metadata (path),
    FOREIGN KEY(right_id) REFERENCES mod_tags (id)
  );
`;

const staleGitHubModsSchema = `
  CREATE TABLE github_mods (
    id INTEGER NOT NULL,
    owner_repo VARCHAR NOT NULL,
    mod_path VARCHAR NOT NULL,
    installed_version VARCHAR NOT NULL,
    installed_asset_name VARCHAR,
    installed_commit_sha VARCHAR,
    auto_update BOOLEAN NOT NULL,
    created_at DATETIME,
    updated_at DATETIME,
    PRIMARY KEY (id),
    CONSTRAINT uq_github_mod UNIQUE (owner_repo, mod_path),
    FOREIGN KEY(mod_path) REFERENCES "_auxiliary_metadata_old" (path)
  );
  CREATE INDEX ix_github_mods_owner_repo ON github_mods (owner_repo);
`;

function openDatabase(path: string): DatabaseSync {
  return new DatabaseSync(path, { timeout: 5_000 });
}

function createCanonicalDatabase(path: string): DatabaseSync {
  const database = openDatabase(path);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(canonicalSchema);
  return database;
}

function addAuxiliaryRow(
  database: DatabaseSync,
  path: string,
  values: { color?: string | null; ignoreWarnings?: number; notes?: string } = {},
): void {
  database
    .prepare(
      `INSERT INTO auxiliary_metadata (
         path, type, published_file_id, acf_time_touched, acf_time_updated,
         external_time_created, external_time_updated, user_notes, color_hex,
         ignore_warnings, outdated, db_time_touched
       ) VALUES (?, 'Steam Workshop', '123', 10, 11, 12, 13, ?, ?, ?, 0, CURRENT_TIMESTAMP)`,
    )
    .run(
      path,
      values.notes ?? "",
      values.color === undefined ? null : values.color,
      values.ignoreWarnings ?? 0,
    );
}

async function writeVault(path: string, mods: unknown[], tags: unknown[]): Promise<void> {
  await writeFile(
    path,
    `${JSON.stringify(
      {
        schemaVersion: 3,
        library: { mods, tags },
        deviceState: { steam: { observedIds: [], pending: {} } },
      },
      null,
      2,
    )}\n`,
  );
}

async function writeRimSortSettings(
  path: string,
  databasePath: string,
  workshopFolder: string,
): Promise<void> {
  await writeFile(
    path,
    `${JSON.stringify(
      {
        current_instance: "Default",
        current_instance_path: dirname(databasePath),
        instances: {
          Default: {
            name: "Default",
            workshop_folder: workshopFolder,
          },
        },
      },
      null,
      2,
    )}\n`,
  );
}

async function backups(directory: string): Promise<string[]> {
  return (await readdir(directory)).filter((name) => name.includes(".before-mod-vault-import-"));
}

void test("RimSort tag import is normalized, backed up, preserving, and idempotent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rimlib-rimsort-import-"));
  let database: DatabaseSync | undefined;
  try {
    const databasePath = join(directory, "aux_metadata.db");
    const vaultPath = join(directory, "mod-vault.json");
    const firstPath = join(directory, "mods", "one");
    const secondPath = join(directory, "mods", "two");
    database = createCanonicalDatabase(databasePath);
    database.exec("PRAGMA journal_mode = WAL");
    addAuxiliaryRow(database, firstPath, {
      color: "#123456",
      ignoreWarnings: 1,
      notes: "keep these notes",
    });
    const qualityId = Number(
      database.prepare("INSERT INTO mod_tags (tag) VALUES (?)").run("quality").lastInsertRowid,
    );
    database
      .prepare("INSERT INTO tags_table (left_id, right_id) VALUES (?, ?)")
      .run(firstPath, qualityId);

    await writeVault(
      vaultPath,
      [
        {
          id: "one",
          localPath: `  ${join(firstPath, ".")}  `,
          tags: ["CatalogOnly"],
          userTagIds: [" quality-id ", "combat", "combat", "missing"],
        },
        { id: "two", localPath: secondPath, userTagIds: ["combat", "same-combat"] },
        { id: "two-again", localPath: join(secondPath, "."), userTagIds: ["quality-id"] },
        { id: "relative", localPath: "relative/mod", userTagIds: ["combat"] },
        null,
      ],
      [
        { id: "quality-id", name: " Quality ", color: "#ffffff" },
        { id: "combat", name: " Combat ", color: "#000000" },
        { id: "same-combat", name: "COMBAT", color: "#aaaaaa" },
        { id: "unused", name: " Unused ", color: "#bbbbbb" },
        { id: "blank", name: "   ", color: "#cccccc" },
      ],
    );

    const dryRun = await run(process.execPath, [
      importer,
      "--vault",
      vaultPath,
      "--db",
      databasePath,
      "--dry-run",
    ]);
    assert.match(dryRun.stdout, /Dry-run summary:/);
    assert.match(dryRun.stdout, /Mod entries read: 5/);
    assert.match(dryRun.stdout, /Valid unique mod paths: 2/);
    assert.match(dryRun.stdout, /Unique normalized tags found: 3/);
    assert.match(dryRun.stdout, /New auxiliary_metadata rows: 1/);
    assert.match(dryRun.stdout, /New mod_tags rows: 2/);
    assert.match(dryRun.stdout, /New tags_table associations: 3/);
    assert.match(dryRun.stdout, /skipped association to unknown tag id "missing"/);
    assert.match(dryRun.stdout, /duplicate normalized mod path/);
    assert.equal((await backups(directory)).length, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM mod_tags").get()?.count, 1);

    const imported = await run(process.execPath, [
      importer,
      "--vault",
      vaultPath,
      "--db",
      databasePath,
    ]);
    assert.match(imported.stdout, /Import summary:/);
    assert.match(imported.stdout, /New tags_table associations: 3/);
    const backupMatch = /^ {2}Backup: (.+)$/m.exec(imported.stdout);
    assert.ok(backupMatch?.[1]);
    await stat(backupMatch[1]);

    const first = database
      .prepare("SELECT * FROM auxiliary_metadata WHERE path = ?")
      .get(firstPath);
    assert.ok(first);
    assert.equal(first.user_notes, "keep these notes");
    assert.equal(first.color_hex, "#123456");
    assert.equal(first.ignore_warnings, 1);
    assert.equal(first.type, "Steam Workshop");
    assert.equal(first.published_file_id, "123");

    const second = database
      .prepare("SELECT * FROM auxiliary_metadata WHERE path = ?")
      .get(secondPath);
    assert.ok(second);
    assert.equal(second.type, "Unknown");
    assert.equal(second.published_file_id, null);
    assert.equal(second.acf_time_touched, -1);
    assert.equal(second.acf_time_updated, -1);
    assert.equal(second.external_time_created, -1);
    assert.equal(second.external_time_updated, -1);
    assert.equal(second.user_notes, "");
    assert.equal(second.color_hex, null);
    assert.equal(second.ignore_warnings, 0);
    assert.equal(second.outdated, 0);
    assert.equal(typeof second.db_time_touched, "string");

    assert.deepEqual(
      database
        .prepare("SELECT tag FROM mod_tags ORDER BY tag")
        .all()
        .map((row) => row.tag),
      ["combat", "quality", "unused"],
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM mod_tags WHERE tag = ?").get("catalogonly")
        ?.count,
      0,
    );
    assert.deepEqual(
      database
        .prepare(
          `SELECT tags_table.left_id AS path, mod_tags.tag AS tag
           FROM tags_table
           JOIN mod_tags ON mod_tags.id = tags_table.right_id
           ORDER BY path, tag`,
        )
        .all()
        .map((row) => [row.path, row.tag]),
      [
        [firstPath, "combat"],
        [firstPath, "quality"],
        [secondPath, "combat"],
        [secondPath, "quality"],
      ],
    );

    const backup = new DatabaseSync(backupMatch[1], { readOnly: true });
    try {
      assert.equal(
        backup.prepare("SELECT COUNT(*) AS count FROM mod_tags WHERE tag = ?").get("quality")
          ?.count,
        1,
      );
      assert.equal(
        backup.prepare("SELECT COUNT(*) AS count FROM mod_tags WHERE tag = ?").get("combat")?.count,
        0,
      );
      assert.equal(
        backup
          .prepare("SELECT COUNT(*) AS count FROM auxiliary_metadata WHERE path = ?")
          .get(firstPath)?.count,
        1,
      );
      assert.equal(
        backup
          .prepare("SELECT COUNT(*) AS count FROM auxiliary_metadata WHERE path = ?")
          .get(secondPath)?.count,
        0,
      );
    } finally {
      backup.close();
    }

    const countsBeforeRerun = {
      mods: database.prepare("SELECT COUNT(*) AS count FROM auxiliary_metadata").get()?.count,
      tags: database.prepare("SELECT COUNT(*) AS count FROM mod_tags").get()?.count,
      joins: database.prepare("SELECT COUNT(*) AS count FROM tags_table").get()?.count,
    };
    const backupCount = (await backups(directory)).length;
    const rerun = await run(process.execPath, [
      importer,
      "--vault",
      vaultPath,
      "--db",
      databasePath,
    ]);
    assert.match(rerun.stdout, /New auxiliary_metadata rows: 0/);
    assert.match(rerun.stdout, /New mod_tags rows: 0/);
    assert.match(rerun.stdout, /New tags_table associations: 0/);
    assert.match(rerun.stdout, /Backup: not created \(database was already up to date\)/);
    assert.equal((await backups(directory)).length, backupCount);
    assert.deepEqual(
      {
        mods: database.prepare("SELECT COUNT(*) AS count FROM auxiliary_metadata").get()?.count,
        tags: database.prepare("SELECT COUNT(*) AS count FROM mod_tags").get()?.count,
        joins: database.prepare("SELECT COUNT(*) AS count FROM tags_table").get()?.count,
      },
      countsBeforeRerun,
    );
  } finally {
    database?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

void test("RimSort tag import maps Workshop IDs to the current instance's exact path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rimlib-rimsort-workshop-path-"));
  try {
    const rimSortRoot = join(directory, "RimSort");
    const instancePath = join(rimSortRoot, "instances", "Default");
    await mkdir(instancePath, { recursive: true });
    const databasePath = join(instancePath, "aux_metadata.db");
    const vaultPath = join(directory, "mod-vault.json");
    const settingsPath = join(rimSortRoot, "settings.json");
    const sourceRoot = join(
      directory,
      "SteamLibrary",
      "steamapps",
      "workshop",
      "content",
      "294100",
    );
    const configuredRoot = join(
      directory,
      "SteamLibrary",
      "steamapps",
      "Workshop",
      "content",
      "294100",
    );
    const sourcePath = join(sourceRoot, "123");
    const targetPath = join(configuredRoot, "123");
    const database = createCanonicalDatabase(databasePath);
    addAuxiliaryRow(database, sourcePath);
    const qualityId = Number(
      database.prepare("INSERT INTO mod_tags (tag) VALUES ('quality')").run().lastInsertRowid,
    );
    database
      .prepare("INSERT INTO tags_table (left_id, right_id) VALUES (?, ?)")
      .run(sourcePath, qualityId);
    database.close();
    await writeVault(
      vaultPath,
      [
        {
          id: "steam-123",
          workshopId: "123",
          localPath: sourcePath,
          userTagIds: ["quality"],
        },
      ],
      [{ id: "quality", name: "Quality", color: "#ffffff" }],
    );
    await writeRimSortSettings(settingsPath, databasePath, configuredRoot);

    const dryRun = await run(process.execPath, [
      importer,
      "--vault",
      vaultPath,
      "--db",
      databasePath,
      "--dry-run",
    ]);
    assert.match(dryRun.stdout, /Workshop paths mapped from RimSort settings: 1/);
    assert.match(dryRun.stdout, /New auxiliary_metadata rows: 1/);
    assert.match(dryRun.stdout, /New tags_table associations: 1/);
    assert.match(dryRun.stdout, /Existing associations reused: 0/);

    await run(process.execPath, [importer, "--vault", vaultPath, "--db", databasePath]);
    const result = openDatabase(databasePath);
    try {
      const targetMetadata = result
        .prepare("SELECT type, published_file_id FROM auxiliary_metadata WHERE path = ?")
        .get(targetPath);
      assert.ok(targetMetadata);
      assert.equal(targetMetadata.type, "ModType.STEAM_WORKSHOP");
      assert.equal(targetMetadata.published_file_id, "123");
      assert.equal(
        result
          .prepare(
            `SELECT COUNT(*) AS count
             FROM tags_table
             JOIN mod_tags ON mod_tags.id = tags_table.right_id
             WHERE tags_table.left_id = ? AND mod_tags.tag = 'quality'`,
          )
          .get(targetPath)?.count,
        1,
      );
      assert.equal(
        result
          .prepare(
            `SELECT COUNT(*) AS count
             FROM tags_table
             JOIN mod_tags ON mod_tags.id = tags_table.right_id
             WHERE tags_table.left_id = ? AND mod_tags.tag = 'quality'`,
          )
          .get(sourcePath)?.count,
        1,
      );
    } finally {
      result.close();
    }

    const rerun = await run(process.execPath, [
      importer,
      "--vault",
      vaultPath,
      "--db",
      databasePath,
    ]);
    assert.match(rerun.stdout, /New tags_table associations: 0/);
    assert.match(rerun.stdout, /Existing associations reused: 1/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("RimSort tag import initializes missing tables from the canonical schema", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rimlib-rimsort-init-"));
  try {
    const databasePath = join(directory, "aux_metadata.db");
    const vaultPath = join(directory, "mod-vault.json");
    const database = openDatabase(databasePath);
    database.exec("CREATE TABLE unrelated (value TEXT)");
    database.close();
    const modPath = join(directory, "mods", "one");
    await writeVault(
      vaultPath,
      [{ id: "one", localPath: modPath, userTagIds: ["tag"] }],
      [{ id: "tag", name: " TAG ", color: "#ffffff" }],
    );

    const dryRun = await run(process.execPath, [
      importer,
      "--vault",
      vaultPath,
      "--db",
      databasePath,
      "--dry-run",
    ]);
    assert.match(
      dryRun.stdout,
      /Missing tables that would be initialized: auxiliary_metadata, mod_tags, tags_table/,
    );
    const afterDryRun = openDatabase(databasePath);
    assert.deepEqual(
      afterDryRun
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => row.name),
      ["unrelated"],
    );
    afterDryRun.close();

    const imported = await run(process.execPath, [
      importer,
      "--vault",
      vaultPath,
      "--db",
      databasePath,
    ]);
    assert.match(
      imported.stdout,
      /Missing tables initialized: auxiliary_metadata, mod_tags, tags_table/,
    );
    assert.equal((await backups(directory)).length, 1);
    const result = openDatabase(databasePath);
    try {
      assert.equal(
        result
          .prepare("SELECT COUNT(*) AS count FROM auxiliary_metadata WHERE path = ?")
          .get(modPath)?.count,
        1,
      );
      assert.equal(result.prepare("SELECT tag FROM mod_tags").get()?.tag, "tag");
      assert.equal(result.prepare("SELECT COUNT(*) AS count FROM tags_table").get()?.count, 1);
      assert.equal(result.prepare("PRAGMA foreign_key_check").all().length, 0);
    } finally {
      result.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("RimSort tag import explicitly repairs the known stale foreign keys before importing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rimlib-rimsort-schema-repair-"));
  try {
    const databasePath = join(directory, "aux_metadata.db");
    const vaultPath = join(directory, "mod-vault.json");
    const database = openDatabase(databasePath);
    database.exec(
      canonicalSchema.replace(
        "REFERENCES auxiliary_metadata (path)",
        'REFERENCES "_auxiliary_metadata_old" (path)',
      ),
    );
    database.exec(staleGitHubModsSchema);
    database.exec("PRAGMA foreign_keys = OFF");

    const modPaths = Array.from({ length: 31 }, (_value, index) =>
      join(directory, "mods", String(index)),
    );
    const repairPath = modPaths[0];
    assert.ok(repairPath);
    for (const modPath of modPaths) {
      addAuxiliaryRow(database, modPath);
    }
    const insertTag = database.prepare("INSERT INTO mod_tags (tag) VALUES (?)");
    const tagIds = Array.from({ length: 33 }, (_value, index) =>
      Number(insertTag.run(`existing-${index}`).lastInsertRowid),
    );
    const insertJoin = database.prepare("INSERT INTO tags_table (left_id, right_id) VALUES (?, ?)");
    let joinCount = 0;
    for (const modPath of modPaths) {
      for (const tagId of tagIds) {
        if (joinCount === 1_021) {
          break;
        }
        insertJoin.run(modPath, tagId);
        joinCount += 1;
      }
    }
    database
      .prepare(
        `INSERT INTO github_mods (
           id, owner_repo, mod_path, installed_version, installed_asset_name,
           installed_commit_sha, auto_update, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(7, "owner/repository", repairPath, "v1", "asset.zip", null, 1, "created", "updated");
    // This is the second part of the deployed migration defect: stale join rows can survive while
    // their auxiliary parent is missing. The importer may restore it only because the same exact
    // normalized path is present in mod-vault.json.
    database.prepare("DELETE FROM auxiliary_metadata WHERE path = ?").run(repairPath);
    const githubBefore = database.prepare("SELECT * FROM github_mods ORDER BY id").all();
    database.close();

    await writeVault(
      vaultPath,
      [{ id: "one", localPath: repairPath, userTagIds: ["combat"] }],
      [{ id: "combat", name: "Combat", color: "#ffffff" }],
    );

    const dryRun = await run(process.execPath, [
      importer,
      "--vault",
      vaultPath,
      "--db",
      databasePath,
      "--repair-rimsort-schema",
      "--dry-run",
    ]);
    assert.match(
      dryRun.stdout,
      /Stale foreign keys that would be repaired: tags_table, github_mods/,
    );
    assert.match(dryRun.stdout, /New tags_table associations: 1/);
    assert.match(dryRun.stdout, /New auxiliary_metadata rows: 1/);
    assert.equal((await backups(directory)).length, 0);
    const afterDryRun = openDatabase(databasePath);
    assert.deepEqual(
      afterDryRun
        .prepare("PRAGMA foreign_key_list(tags_table)")
        .all()
        .map((row) => row.table)
        .sort(),
      ["_auxiliary_metadata_old", "mod_tags"],
    );
    afterDryRun.close();

    const imported = await run(process.execPath, [
      importer,
      "--vault",
      vaultPath,
      "--db",
      databasePath,
      "--repair-rimsort-schema",
    ]);
    assert.match(imported.stdout, /Stale foreign keys repaired: tags_table, github_mods/);
    const backupMatch = /^ {2}Backup: (.+)$/m.exec(imported.stdout);
    assert.ok(backupMatch?.[1]);

    const repaired = openDatabase(databasePath);
    try {
      assert.deepEqual(
        repaired
          .prepare("PRAGMA foreign_key_list(tags_table)")
          .all()
          .map((row) => `${String(row.from)}->${String(row.table)}.${String(row.to)}`)
          .sort(),
        ["left_id->auxiliary_metadata.path", "right_id->mod_tags.id"],
      );
      assert.deepEqual(
        repaired
          .prepare("PRAGMA foreign_key_list(github_mods)")
          .all()
          .map((row) => `${String(row.from)}->${String(row.table)}.${String(row.to)}`),
        ["mod_path->auxiliary_metadata.path"],
      );
      assert.equal(
        repaired.prepare("SELECT COUNT(*) AS count FROM tags_table").get()?.count,
        1_022,
      );
      assert.deepEqual(
        repaired.prepare("SELECT * FROM github_mods ORDER BY id").all(),
        githubBefore,
      );
      assert.equal(
        repaired
          .prepare("PRAGMA index_list(github_mods)")
          .all()
          .some((row) => row.name === "ix_github_mods_owner_repo"),
        true,
      );
      assert.equal(repaired.prepare("PRAGMA foreign_key_check").all().length, 0);
      assert.equal(repaired.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
      assert.equal(
        repaired
          .prepare(
            `SELECT COUNT(*) AS count
             FROM sqlite_master
             WHERE name IN ('_rimlib_tags_table_fk_repair', '_rimlib_github_mods_fk_repair')`,
          )
          .get()?.count,
        0,
      );
    } finally {
      repaired.close();
    }

    const backup = new DatabaseSync(backupMatch[1], { readOnly: true });
    try {
      assert.deepEqual(
        backup
          .prepare("PRAGMA foreign_key_list(tags_table)")
          .all()
          .map((row) => row.table)
          .sort(),
        ["_auxiliary_metadata_old", "mod_tags"],
      );
      assert.equal(backup.prepare("SELECT COUNT(*) AS count FROM tags_table").get()?.count, 1_021);
      assert.equal(
        backup.prepare("SELECT COUNT(*) AS count FROM mod_tags WHERE tag = 'combat'").get()?.count,
        0,
      );
      assert.equal(
        backup
          .prepare("SELECT COUNT(*) AS count FROM auxiliary_metadata WHERE path = ?")
          .get(repairPath)?.count,
        0,
      );
    } finally {
      backup.close();
    }

    const rerun = await run(process.execPath, [
      importer,
      "--vault",
      vaultPath,
      "--db",
      databasePath,
      "--repair-rimsort-schema",
    ]);
    assert.match(rerun.stdout, /Stale foreign keys repaired: none/);
    assert.match(rerun.stdout, /New tags_table associations: 0/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("RimSort tag import accepts the app's canonical external-time migration variant", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rimlib-rimsort-migrated-schema-"));
  try {
    const databasePath = join(directory, "aux_metadata.db");
    const vaultPath = join(directory, "mod-vault.json");
    const database = openDatabase(databasePath);
    database.exec(
      canonicalSchema
        .replace(
          "    external_time_created INTEGER NOT NULL,\n    external_time_updated INTEGER NOT NULL,\n",
          "",
        )
        .replace(
          "    db_time_touched DATETIME,\n    PRIMARY KEY (path)",
          "    db_time_touched DATETIME,\n" +
            "    external_time_created INTEGER DEFAULT -1,\n" +
            "    external_time_updated INTEGER DEFAULT -1,\n" +
            "    PRIMARY KEY (path)",
        ),
    );
    database.close();
    await writeVault(vaultPath, [], []);

    const dryRun = await run(process.execPath, [
      importer,
      "--vault",
      vaultPath,
      "--db",
      databasePath,
      "--dry-run",
    ]);
    assert.match(dryRun.stdout, /Dry-run summary:/);
    assert.match(dryRun.stdout, /Missing tables that would be initialized: none/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("RimSort tag import never increases a pre-existing duplicate association", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rimlib-rimsort-duplicate-join-"));
  try {
    const databasePath = join(directory, "aux_metadata.db");
    const vaultPath = join(directory, "mod-vault.json");
    const modPath = join(directory, "mods", "one");
    const database = createCanonicalDatabase(databasePath);
    addAuxiliaryRow(database, modPath);
    const qualityId = Number(
      database.prepare("INSERT INTO mod_tags (tag) VALUES (?)").run("quality").lastInsertRowid,
    );
    const insertJoin = database.prepare("INSERT INTO tags_table (left_id, right_id) VALUES (?, ?)");
    insertJoin.run(modPath, qualityId);
    insertJoin.run(modPath, qualityId);
    database.close();
    await writeVault(
      vaultPath,
      [{ id: "one", localPath: modPath, userTagIds: ["quality", "combat"] }],
      [
        { id: "quality", name: "Quality", color: "#ffffff" },
        { id: "combat", name: "Combat", color: "#000000" },
      ],
    );

    const imported = await run(process.execPath, [
      importer,
      "--vault",
      vaultPath,
      "--db",
      databasePath,
    ]);
    assert.match(imported.stdout, /existing duplicate association .* has 2 rows; left unchanged/);
    const result = openDatabase(databasePath);
    try {
      const counts = result
        .prepare(
          `SELECT mod_tags.tag AS tag, COUNT(*) AS copies
           FROM tags_table
           JOIN mod_tags ON mod_tags.id = tags_table.right_id
           GROUP BY mod_tags.tag
           ORDER BY mod_tags.tag`,
        )
        .all();
      assert.deepEqual(
        counts.map((row) => [row.tag, row.copies]),
        [
          ["combat", 1],
          ["quality", 2],
        ],
      );
    } finally {
      result.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("RimSort tag import stops on a mismatched join-table schema", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rimlib-rimsort-mismatch-"));
  try {
    const databasePath = join(directory, "aux_metadata.db");
    const vaultPath = join(directory, "mod-vault.json");
    const database = openDatabase(databasePath);
    database.exec(
      canonicalSchema.replace(
        "REFERENCES auxiliary_metadata (path)",
        'REFERENCES "_auxiliary_metadata_old" (path)',
      ),
    );
    database.close();
    await writeVault(vaultPath, [], []);

    await assert.rejects(
      run(process.execPath, [importer, "--vault", vaultPath, "--db", databasePath]),
      (error: Error & { stderr?: string }) => {
        assert.match(error.stderr ?? "", /RimSort schema mismatch in tags_table/);
        assert.match(error.stderr ?? "", /left_id->auxiliary_metadata\.path/);
        assert.match(error.stderr ?? "", /left_id->_auxiliary_metadata_old\.path/);
        return true;
      },
    );
    assert.equal((await backups(directory)).length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("RimSort schema repair refuses orphan paths absent from the vault", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rimlib-rimsort-repair-orphan-"));
  try {
    const databasePath = join(directory, "aux_metadata.db");
    const vaultPath = join(directory, "mod-vault.json");
    const database = openDatabase(databasePath);
    database.exec(
      canonicalSchema.replace(
        "REFERENCES auxiliary_metadata (path)",
        'REFERENCES "_auxiliary_metadata_old" (path)',
      ),
    );
    database.exec("PRAGMA foreign_keys = OFF");
    const tagId = Number(
      database.prepare("INSERT INTO mod_tags (tag) VALUES ('quality')").run().lastInsertRowid,
    );
    database
      .prepare("INSERT INTO tags_table (left_id, right_id) VALUES (?, ?)")
      .run(join(directory, "not-in-vault"), tagId);
    database.close();
    await writeVault(vaultPath, [], []);

    await assert.rejects(
      run(process.execPath, [
        importer,
        "--vault",
        vaultPath,
        "--db",
        databasePath,
        "--repair-rimsort-schema",
      ]),
      (error: Error & { stderr?: string }) => {
        assert.match(error.stderr ?? "", /cannot be restored from mod-vault\.json/);
        return true;
      },
    );
    assert.equal((await backups(directory)).length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("RimSort schema repair refuses extra constraints instead of rebuilding them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rimlib-rimsort-repair-constraint-"));
  try {
    const databasePath = join(directory, "aux_metadata.db");
    const vaultPath = join(directory, "mod-vault.json");
    const database = openDatabase(databasePath);
    database.exec(
      canonicalSchema
        .replace(
          "REFERENCES auxiliary_metadata (path)",
          'REFERENCES "_auxiliary_metadata_old" (path)',
        )
        .replace("right_id INTEGER,", "right_id INTEGER CHECK (right_id IS NULL OR right_id > 0),"),
    );
    database.close();
    await writeVault(vaultPath, [], []);

    await assert.rejects(
      run(process.execPath, [
        importer,
        "--vault",
        vaultPath,
        "--db",
        databasePath,
        "--repair-rimsort-schema",
      ]),
      (error: Error & { stderr?: string }) => {
        assert.match(error.stderr ?? "", /requires the exact RimSort table definition/);
        return true;
      },
    );
    assert.equal((await backups(directory)).length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
