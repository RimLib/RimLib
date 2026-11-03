#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

const RIMSORT_SCHEMA_REVISION = "4964bf8900aa31f946591cd1c711be58d0ef2873";
const RIMSORT_SCHEMA_URL =
  `https://github.com/RimSort/RimSort/blob/${RIMSORT_SCHEMA_REVISION}/` +
  "app/models/metadata/metadata_db.py#L20-L80";

const usage = `Usage:
  node scripts/import-mod-vault-tags-to-rimsort.mjs \\
    --vault /absolute/path/to/mod-vault.json \\
    --db /absolute/path/to/aux_metadata.db \\
    [--settings /absolute/path/to/RimSort/settings.json] \\
    [--dry-run] [--repair-rimsort-schema]

Imports RimLib schema-v3 personal tags (library.tags + mods[].userTagIds) into
RimSort's per-instance auxiliary metadata database. Workshop/catalog mods[].tags
are intentionally not imported.

Options:
  --vault PATH  RimLib mod-vault.json to read (required)
  --db PATH     Existing RimSort aux_metadata.db to update (required)
  --settings PATH
                RimSort settings.json used to map Workshop IDs to the selected
                instance's exact configured paths. Automatically discovered for
                canonical .../RimSort/instances/<name>/aux_metadata.db paths
  --dry-run     Validate and report without initializing tables or writing data
  --repair-rimsort-schema
                Repair only RimSort's known stale _auxiliary_metadata_old foreign keys,
                after backing up the database, then continue the import
  --help, -h    Show this help

The database file itself must already exist. In normal mode, missing canonical
tables are initialized from RimSort's schema pinned at:
${RIMSORT_SCHEMA_URL}`;

const canonicalTables = ["auxiliary_metadata", "mod_tags", "tags_table"];
const protectedTables = [...canonicalTables, "github_mods"];
const repairTableNames = {
  tags_table: "_rimlib_tags_table_fk_repair",
  github_mods: "_rimlib_github_mods_fk_repair",
};

// These are the SQLite tables emitted by RimSort's SQLAlchemy models at the pinned revision.
// Keep the unusual INTEGER affinity on tags_table.left_id: upstream declares it that way even
// though it references and stores auxiliary_metadata.path strings.
const canonicalTableSql = {
  auxiliary_metadata: `CREATE TABLE auxiliary_metadata (
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
  )`,
  mod_tags: `CREATE TABLE mod_tags (
    id INTEGER NOT NULL,
    tag VARCHAR NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (tag)
  )`,
  tags_table: `CREATE TABLE tags_table (
    left_id INTEGER,
    right_id INTEGER,
    FOREIGN KEY(left_id) REFERENCES auxiliary_metadata (path),
    FOREIGN KEY(right_id) REFERENCES mod_tags (id)
  )`,
};

const canonicalGitHubModsSql = `CREATE TABLE github_mods (
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
  FOREIGN KEY(mod_path) REFERENCES auxiliary_metadata (path)
)`;

const expectedColumns = {
  auxiliary_metadata: [
    ["path", "VARCHAR", 1, 1],
    ["type", "VARCHAR", 1, 0],
    ["published_file_id", "VARCHAR", 0, 0],
    ["acf_time_touched", "INTEGER", 1, 0],
    ["acf_time_updated", "INTEGER", 1, 0],
    ["external_time_created", "INTEGER", 1, 0],
    ["external_time_updated", "INTEGER", 1, 0],
    ["user_notes", "VARCHAR", 1, 0],
    ["color_hex", "VARCHAR", 0, 0],
    ["ignore_warnings", "BOOLEAN", 1, 0],
    ["outdated", "BOOLEAN", 1, 0],
    ["db_time_touched", "DATETIME", 0, 0],
  ],
  mod_tags: [
    ["id", "INTEGER", 1, 1],
    ["tag", "VARCHAR", 1, 0],
  ],
  tags_table: [
    ["left_id", "INTEGER", 0, 0],
    ["right_id", "INTEGER", 0, 0],
  ],
  github_mods: [
    ["id", "INTEGER", 1, 1],
    ["owner_repo", "VARCHAR", 1, 0],
    ["mod_path", "VARCHAR", 1, 0],
    ["installed_version", "VARCHAR", 1, 0],
    ["installed_asset_name", "VARCHAR", 0, 0],
    ["installed_commit_sha", "VARCHAR", 0, 0],
    ["auto_update", "BOOLEAN", 1, 0],
    ["created_at", "DATETIME", 0, 0],
    ["updated_at", "DATETIME", 0, 0],
  ],
};

const repairTableSql = {
  tags_table: `CREATE TABLE ${repairTableNames.tags_table} (
    left_id INTEGER,
    right_id INTEGER,
    FOREIGN KEY(left_id) REFERENCES auxiliary_metadata (path),
    FOREIGN KEY(right_id) REFERENCES mod_tags (id)
  )`,
  github_mods: `CREATE TABLE ${repairTableNames.github_mods} (
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
    FOREIGN KEY(mod_path) REFERENCES auxiliary_metadata (path)
  )`,
};

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArguments(args) {
  let vault;
  let database;
  let settings;
  let dryRun = false;
  let repairRimSortSchema = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      console.log(usage);
      process.exit(0);
    }
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argument === "--repair-rimsort-schema") {
      repairRimSortSchema = true;
      continue;
    }
    if (argument === "--vault" || argument === "--db" || argument === "--settings") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        fail(`${argument} requires a file path.`);
      }
      index += 1;
      if (argument === "--vault") {
        if (vault) {
          fail("--vault may be provided only once.");
        }
        vault = resolve(value);
      } else if (argument === "--db") {
        if (database) {
          fail("--db may be provided only once.");
        }
        database = resolve(value);
      } else {
        if (settings) {
          fail("--settings may be provided only once.");
        }
        settings = resolve(value);
      }
      continue;
    }
    fail(`Unknown argument: ${argument}\n\n${usage}`);
  }
  if (!vault || !database) {
    fail(usage);
  }
  return { vault, database, settings, dryRun, repairRimSortSchema };
}

function hasControlCharacter(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) {
      return true;
    }
  }
  return false;
}

function normalizeTag(value, location, issues) {
  if (typeof value !== "string") {
    issues.push(`${location}: skipped tag with a non-string name.`);
    return undefined;
  }
  const tag = value.trim().toLowerCase();
  if (!tag) {
    issues.push(`${location}: skipped an empty tag.`);
    return undefined;
  }
  if (hasControlCharacter(tag)) {
    issues.push(`${location}: skipped tag containing a control character.`);
    return undefined;
  }
  return tag;
}

function normalizeModPath(value, location, issues) {
  if (typeof value !== "string") {
    issues.push(`${location}: skipped mod with a non-string localPath.`);
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    issues.push(`${location}: skipped mod with an empty localPath.`);
    return undefined;
  }
  if (hasControlCharacter(trimmed)) {
    issues.push(`${location}: skipped localPath containing a control character.`);
    return undefined;
  }
  if (!isAbsolute(trimmed)) {
    issues.push(
      `${location}: skipped non-native or relative localPath ${JSON.stringify(trimmed)}.`,
    );
    return undefined;
  }
  // On Windows, Node considers root-relative paths such as \"\\mods\\one\" absolute even though
  // RimSort needs a concrete drive or UNC path to identify the same mod across processes.
  if (process.platform === "win32" && /^[\\/](?![\\/])/.test(trimmed)) {
    issues.push(
      `${location}: skipped drive-relative Windows localPath ${JSON.stringify(trimmed)}.`,
    );
    return undefined;
  }
  const path = normalize(join(trimmed, "."));
  if (!isAbsolute(path)) {
    issues.push(`${location}: skipped localPath that could not be normalized safely.`);
    return undefined;
  }
  return path;
}

function normalizeVault(source, rimSortInstance) {
  if (!isRecord(source) || source.schemaVersion !== 3) {
    fail(
      "The input must be a RimLib schema-v3 vault. Migrate older vaults with " +
        "scripts/migrate-vault-v2-to-v3.mjs first.",
    );
  }
  if (!isRecord(source.library)) {
    fail("Invalid schema-v3 vault: library must be an object.");
  }
  if (!Array.isArray(source.library.tags)) {
    fail("Invalid schema-v3 vault: library.tags must be an array.");
  }
  if (!Array.isArray(source.library.mods)) {
    fail("Invalid schema-v3 vault: library.mods must be an array.");
  }
  const hasWorkshopMods = source.library.mods.some(
    (value) => isRecord(value) && value.workshopId !== undefined && value.workshopId !== null,
  );
  if (hasWorkshopMods && !rimSortInstance) {
    fail(
      "RimSort settings.json is required because mod-vault.json contains Workshop mods. " +
        "Provide --settings when the database is outside RimSort's canonical instances folder.",
    );
  }

  const issues = [];
  const tagsById = new Map();
  const conflictedTagIds = new Set();
  for (const [index, value] of source.library.tags.entries()) {
    const location = `library.tags[${index}]`;
    if (!isRecord(value)) {
      issues.push(`${location}: skipped malformed tag definition.`);
      continue;
    }
    if (typeof value.id !== "string" || !value.id.trim()) {
      issues.push(`${location}: skipped tag definition with an invalid id.`);
      continue;
    }
    const id = value.id.trim();
    const name = normalizeTag(value.name, `${location}.name`, issues);
    if (!name) {
      continue;
    }
    if (conflictedTagIds.has(id)) {
      issues.push(`${location}: skipped duplicate conflicted tag id ${JSON.stringify(id)}.`);
      continue;
    }
    const existing = tagsById.get(id);
    if (existing === undefined) {
      tagsById.set(id, name);
    } else if (existing === name) {
      issues.push(`${location}: duplicate tag id ${JSON.stringify(id)} was deduplicated.`);
    } else {
      tagsById.delete(id);
      conflictedTagIds.add(id);
      issues.push(
        `${location}: conflicting names for tag id ${JSON.stringify(id)}; ` +
          "that id and its associations were skipped.",
      );
    }
  }

  const tagIdsByName = new Map();
  for (const [id, name] of tagsById) {
    const priorId = tagIdsByName.get(name);
    if (priorId !== undefined && priorId !== id) {
      issues.push(
        `library.tags: tag ids ${JSON.stringify(priorId)} and ${JSON.stringify(id)} ` +
          `both normalize to ${JSON.stringify(name)} and will share one RimSort tag.`,
      );
    } else {
      tagIdsByName.set(name, id);
    }
  }

  const tags = new Set(tagsById.values());
  const mods = new Map();
  const modMetadata = new Map();
  let remappedPaths = 0;
  for (const [index, value] of source.library.mods.entries()) {
    const location = `library.mods[${index}]`;
    if (!isRecord(value)) {
      issues.push(`${location}: skipped malformed mod entry.`);
      continue;
    }
    const sourcePath = normalizeModPath(value.localPath, `${location}.localPath`, issues);
    if (!sourcePath) {
      continue;
    }
    let path = sourcePath;
    let publishedFileId;
    if (value.workshopId !== undefined && value.workshopId !== null) {
      if (typeof value.workshopId !== "string" || !/^\d+$/.test(value.workshopId.trim())) {
        issues.push(`${location}.workshopId: skipped mod with an invalid Workshop id.`);
        continue;
      }
      publishedFileId = value.workshopId.trim();
      path = normalize(join(rimSortInstance.workshopFolder, publishedFileId));
      if (path !== sourcePath) {
        remappedPaths += 1;
      }
    }
    let assigned = mods.get(path);
    if (assigned) {
      issues.push(`${location}: duplicate normalized mod path ${JSON.stringify(path)} was merged.`);
    } else {
      assigned = new Set();
      mods.set(path, assigned);
      modMetadata.set(path, {
        type: publishedFileId ? "ModType.STEAM_WORKSHOP" : "Unknown",
        publishedFileId: publishedFileId ?? null,
      });
    }

    const ids = value.userTagIds ?? [];
    if (!Array.isArray(ids)) {
      issues.push(`${location}.userTagIds: skipped malformed tag association list.`);
      continue;
    }
    const seenIds = new Set();
    for (const [tagIndex, rawId] of ids.entries()) {
      const tagLocation = `${location}.userTagIds[${tagIndex}]`;
      if (typeof rawId !== "string" || !rawId.trim()) {
        issues.push(`${tagLocation}: skipped invalid tag id.`);
        continue;
      }
      const id = rawId.trim();
      if (seenIds.has(id)) {
        continue;
      }
      seenIds.add(id);
      if (conflictedTagIds.has(id)) {
        issues.push(
          `${tagLocation}: skipped association to conflicted tag id ${JSON.stringify(id)}.`,
        );
        continue;
      }
      const tag = tagsById.get(id);
      if (tag === undefined) {
        issues.push(`${tagLocation}: skipped association to unknown tag id ${JSON.stringify(id)}.`);
        continue;
      }
      assigned.add(tag);
    }
  }

  return {
    entriesRead: source.library.mods.length,
    tags,
    mods,
    modMetadata,
    issues,
    remappedPaths,
    rimSortInstanceName: rimSortInstance?.name,
    associationCount: [...mods.values()].reduce((total, assigned) => total + assigned.size, 0),
  };
}

function tableNames(database) {
  return new Set(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name),
  );
}

function schemaMismatch(table, details) {
  fail(
    `RimSort schema mismatch in ${table}: ${details} ` +
      `Expected the schema from ${RIMSORT_SCHEMA_URL}. No database changes were made.`,
  );
}

function validateColumns(database, table) {
  const actual = database.prepare(`PRAGMA table_info(${table})`).all();
  const expected = expectedColumns[table];
  if (actual.length !== expected.length) {
    schemaMismatch(
      table,
      `expected ${expected.length} columns (${expected.map(([name]) => name).join(", ")}), ` +
        `found ${actual.length} (${actual.map((column) => column.name).join(", ")}).`,
    );
  }
  const columnsByName = new Map(actual.map((column) => [column.name, column]));
  for (const [name, type, notnull, primaryKey] of expected) {
    const column = columnsByName.get(name);
    if (!column) {
      schemaMismatch(table, `required column ${name} is missing.`);
    }
    const actualType = String(column.type).toUpperCase();
    // RimSort's own migration adds these two columns with `INTEGER DEFAULT -1`. SQLite records
    // that deployed variant as nullable even though a fresh SQLAlchemy-created table is NOT NULL.
    const isCanonicalMigratedExternalTime =
      table === "auxiliary_metadata" &&
      (name === "external_time_created" || name === "external_time_updated") &&
      Number(column.notnull) === 0 &&
      String(column.dflt_value) === "-1";
    if (
      column.name !== name ||
      actualType !== type ||
      (Number(column.notnull) !== notnull && !isCanonicalMigratedExternalTime) ||
      Number(column.pk) !== primaryKey
    ) {
      schemaMismatch(
        table,
        `column ${name} should be ${type} ` +
          `(notnull=${notnull}, pk=${primaryKey}), found ${column.name} ${actualType} ` +
          `(notnull=${column.notnull}, pk=${column.pk}).`,
      );
    }
  }
}

function hasCanonicalIndex(database, table, expectedNames, unique) {
  const indexes = database.prepare(`PRAGMA index_list(${table})`).all();
  return indexes.some((index) => {
    if (Number(index.unique) !== Number(unique) || Number(index.partial) !== 0) {
      return false;
    }
    const keyColumns = database
      .prepare(`PRAGMA index_xinfo(${JSON.stringify(index.name)})`)
      .all()
      .filter((column) => Number(column.key) === 1);
    return (
      keyColumns.length === expectedNames.length &&
      keyColumns.every(
        (column, position) =>
          column.name === expectedNames[position] &&
          Number(column.desc) === 0 &&
          String(column.coll).toUpperCase() === "BINARY",
      )
    );
  });
}

function normalizedSchemaSql(sql) {
  return String(sql).replaceAll('"', "").replace(/\s+/g, "").replace(/;$/, "").toLowerCase();
}

function validateExactStaleTableDefinition(database, table) {
  const row = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  const canonical = table === "tags_table" ? canonicalTableSql.tags_table : canonicalGitHubModsSql;
  const stale = canonical.replace(
    "REFERENCES auxiliary_metadata",
    'REFERENCES "_auxiliary_metadata_old"',
  );
  if (!row || normalizedSchemaSql(row.sql) !== normalizedSchemaSql(stale)) {
    schemaMismatch(
      table,
      "the known repair requires the exact RimSort table definition with only the stale " +
        "_auxiliary_metadata_old foreign-key target changed.",
    );
  }
}

function validateTagUniqueIndex(database) {
  const hasTagUniqueIndex = hasCanonicalIndex(database, "mod_tags", ["tag"], true);
  if (!hasTagUniqueIndex) {
    schemaMismatch(
      "mod_tags",
      "the non-partial, case-sensitive UNIQUE(tag) constraint is missing.",
    );
  }
}

function validateGitHubModsIndexes(database) {
  const indexes = database.prepare("PRAGMA index_list(github_mods)").all();
  const indexesByName = new Map(indexes.map((index) => [index.name, index]));
  const ownerRepoIndex = indexesByName.get("ix_github_mods_owner_repo");
  const uniqueIndex = indexesByName.get("sqlite_autoindex_github_mods_1");
  if (
    indexes.length !== 2 ||
    !ownerRepoIndex ||
    Number(ownerRepoIndex.unique) !== 0 ||
    ownerRepoIndex.origin !== "c" ||
    Number(ownerRepoIndex.partial) !== 0 ||
    !uniqueIndex ||
    Number(uniqueIndex.unique) !== 1 ||
    uniqueIndex.origin !== "u" ||
    Number(uniqueIndex.partial) !== 0
  ) {
    schemaMismatch(
      "github_mods",
      "expected the canonical uq_github_mod constraint and ix_github_mods_owner_repo index.",
    );
  }
  if (!hasCanonicalIndex(database, "github_mods", ["owner_repo", "mod_path"], true)) {
    schemaMismatch(
      "github_mods",
      "the non-partial, case-sensitive UNIQUE(owner_repo, mod_path) constraint is missing.",
    );
  }
  if (!hasCanonicalIndex(database, "github_mods", ["owner_repo"], false)) {
    schemaMismatch("github_mods", "the canonical non-unique owner_repo index is missing.");
  }
  const explicitIndex = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get("ix_github_mods_owner_repo");
  if (
    !explicitIndex ||
    normalizedSchemaSql(explicitIndex.sql) !==
      normalizedSchemaSql("CREATE INDEX ix_github_mods_owner_repo ON github_mods (owner_repo)")
  ) {
    schemaMismatch("github_mods", "the canonical owner_repo index definition differs.");
  }
}

function validateNoCanonicalTableTriggers(database) {
  const triggers = database
    .prepare(
      `SELECT name, tbl_name
       FROM sqlite_master
       WHERE type = 'trigger' AND tbl_name IN (?, ?, ?, ?)
       ORDER BY name`,
    )
    .all(...protectedTables);
  if (triggers.length > 0) {
    const descriptions = triggers.map((trigger) => `${trigger.name} on ${trigger.tbl_name}`);
    schemaMismatch(
      "canonical tables",
      `unexpected trigger(s) are present: ${descriptions.join(", ")}.`,
    );
  }
}

function foreignKeySignatures(database, table) {
  return database
    .prepare(`PRAGMA foreign_key_list(${table})`)
    .all()
    .map(
      (row) =>
        `${row.from}->${row.table}.${row.to}` +
        `[update=${row.on_update},delete=${row.on_delete},match=${row.match}]`,
    )
    .sort();
}

function validateForeignKeys(database, table, allowKnownStaleForeignKeys) {
  const actual = foreignKeySignatures(database, table);
  const expected =
    table === "tags_table"
      ? [
          "left_id->auxiliary_metadata.path[update=NO ACTION,delete=NO ACTION,match=NONE]",
          "right_id->mod_tags.id[update=NO ACTION,delete=NO ACTION,match=NONE]",
        ].sort()
      : ["mod_path->auxiliary_metadata.path[update=NO ACTION,delete=NO ACTION,match=NONE]"];
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    return false;
  }
  const knownStale =
    table === "tags_table"
      ? [
          "left_id->_auxiliary_metadata_old.path[update=NO ACTION,delete=NO ACTION,match=NONE]",
          "right_id->mod_tags.id[update=NO ACTION,delete=NO ACTION,match=NONE]",
        ].sort()
      : ["mod_path->_auxiliary_metadata_old.path[update=NO ACTION,delete=NO ACTION,match=NONE]"];
  if (allowKnownStaleForeignKeys && JSON.stringify(actual) === JSON.stringify(knownStale)) {
    return true;
  }
  schemaMismatch(
    table,
    `expected foreign keys ${expected.join(", ")}; found ${actual.join(", ") || "none"}.`,
  );
}

function validatePresentSchema(database, allowKnownStaleForeignKeys = false) {
  const names = tableNames(database);
  validateNoCanonicalTableTriggers(database);
  for (const temporary of Object.values(repairTableNames)) {
    if (names.has(temporary)) {
      schemaMismatch(
        temporary,
        "a previous schema repair did not finish; restore its backup before retrying",
      );
    }
  }
  if (names.has("_auxiliary_metadata_old")) {
    schemaMismatch(
      "_auxiliary_metadata_old",
      "an unfinished RimSort migration table is present; let RimSort complete or repair its migration",
    );
  }
  for (const table of canonicalTables) {
    if (names.has(table)) {
      validateColumns(database, table);
    }
  }
  if (names.has("mod_tags")) {
    validateTagUniqueIndex(database);
  }
  const staleForeignKeyTables = [];
  if (names.has("tags_table")) {
    if (validateForeignKeys(database, "tags_table", allowKnownStaleForeignKeys)) {
      validateExactStaleTableDefinition(database, "tags_table");
      staleForeignKeyTables.push("tags_table");
    }
  }
  if (names.has("github_mods")) {
    validateColumns(database, "github_mods");
    validateGitHubModsIndexes(database);
    if (validateForeignKeys(database, "github_mods", allowKnownStaleForeignKeys)) {
      validateExactStaleTableDefinition(database, "github_mods");
      staleForeignKeyTables.push("github_mods");
    }
  }
  if (names.has("tags_table")) {
    const joinRows = Number(
      database.prepare("SELECT COUNT(*) AS count FROM tags_table").get().count,
    );
    if (joinRows > 0 && (!names.has("auxiliary_metadata") || !names.has("mod_tags"))) {
      schemaMismatch(
        "tags_table",
        "it contains rows while one or both referenced canonical tables are missing.",
      );
    }
  }
  return {
    missingTables: canonicalTables.filter((table) => !names.has(table)),
    staleForeignKeyTables,
  };
}

function validateRepairableRows(database, staleForeignKeyTables, restorableModPaths) {
  if (staleForeignKeyTables.length > 0) {
    const inbound = [];
    for (const table of tableNames(database)) {
      if (staleForeignKeyTables.includes(table)) {
        continue;
      }
      for (const foreignKey of database
        .prepare("SELECT * FROM pragma_foreign_key_list(?)")
        .all(table)) {
        if (staleForeignKeyTables.includes(foreignKey.table)) {
          inbound.push(`${table}.${foreignKey.from}->${foreignKey.table}.${foreignKey.to}`);
        }
      }
    }
    if (inbound.length > 0) {
      fail(
        `Cannot repair RimSort schema because other tables reference the affected tables: ` +
          `${inbound.join(", ")}. No changes were made.`,
      );
    }
  }
  if (staleForeignKeyTables.includes("tags_table")) {
    const indexes = database.prepare("PRAGMA index_list(tags_table)").all();
    if (indexes.length > 0) {
      schemaMismatch("tags_table", `the known repair expects no indexes; found ${indexes.length}.`);
    }
    const irreparable = database
      .prepare(
        `SELECT tags_table.rowid AS rowid,
                tags_table.left_id AS path,
                tags_table.right_id AS tag_id,
                auxiliary_metadata.path IS NULL AS missing_mod,
                mod_tags.id IS NULL AS missing_tag
         FROM tags_table
         LEFT JOIN auxiliary_metadata ON auxiliary_metadata.path = tags_table.left_id
         LEFT JOIN mod_tags ON mod_tags.id = tags_table.right_id
         WHERE (tags_table.left_id IS NOT NULL AND auxiliary_metadata.path IS NULL)
            OR (tags_table.right_id IS NOT NULL AND mod_tags.id IS NULL)`,
      )
      .all()
      .filter(
        (row) =>
          Number(row.missing_tag) === 1 ||
          (Number(row.missing_mod) === 1 && !restorableModPaths.has(row.path)),
      );
    if (irreparable.length > 0) {
      fail(
        `Cannot repair tags_table: ${irreparable.length} row(s) have missing parents that ` +
          "cannot be restored from mod-vault.json. No changes were made.",
      );
    }
  }
  if (staleForeignKeyTables.includes("github_mods")) {
    const irreparable = database
      .prepare(
        `SELECT github_mods.id AS id, github_mods.mod_path AS path
         FROM github_mods
         LEFT JOIN auxiliary_metadata ON auxiliary_metadata.path = github_mods.mod_path
         WHERE auxiliary_metadata.path IS NULL`,
      )
      .all()
      .filter((row) => !restorableModPaths.has(row.path));
    if (irreparable.length > 0) {
      fail(
        `Cannot repair github_mods: ${irreparable.length} row(s) have missing mod paths that ` +
          "cannot be restored from mod-vault.json. No changes were made.",
      );
    }
  }
}

function verifyDatabaseHealth(database, requireForeignKeys) {
  const integrityRows = database.prepare("PRAGMA integrity_check").all();
  if (
    integrityRows.length !== 1 ||
    String(Object.values(integrityRows[0])[0]).toLowerCase() !== "ok"
  ) {
    fail(
      `SQLite integrity_check failed: ${integrityRows
        .map((row) => Object.values(row).join(" "))
        .join("; ")}`,
    );
  }
  if (requireForeignKeys) {
    const violations = database.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      fail(
        `RimSort database has ${violations.length} existing foreign-key violation(s); ` +
          "no changes were made.",
      );
    }
  }
}

function fetchSnapshot(database, missingTables) {
  const missing = new Set(missingTables);
  const paths = missing.has("auxiliary_metadata")
    ? new Set()
    : new Set(
        database
          .prepare("SELECT path FROM auxiliary_metadata")
          .all()
          .map((row) => row.path),
      );
  const tags = missing.has("mod_tags")
    ? new Map()
    : new Map(
        database
          .prepare("SELECT id, tag FROM mod_tags")
          .all()
          .map((row) => [row.tag, row.id]),
      );
  const associations = new Map();
  const duplicateAssociations = new Map();
  if (!missing.has("tags_table") && !missing.has("mod_tags")) {
    const rows = database
      .prepare(
        `SELECT tags_table.left_id AS path, mod_tags.tag AS tag, COUNT(*) AS copies
         FROM tags_table
         JOIN mod_tags ON mod_tags.id = tags_table.right_id
         GROUP BY tags_table.left_id, mod_tags.tag`,
      )
      .all();
    for (const row of rows) {
      let tagCounts = associations.get(row.path);
      if (!tagCounts) {
        tagCounts = new Map();
        associations.set(row.path, tagCounts);
      }
      const copies = Number(row.copies);
      tagCounts.set(row.tag, copies);
      if (copies > 1) {
        duplicateAssociations.set(
          `${JSON.stringify(row.path)} / ${JSON.stringify(row.tag)}`,
          copies,
        );
      }
    }
  }
  return { paths, tags, associations, duplicateAssociations };
}

function associationCopies(snapshot, path, tag) {
  return snapshot.associations.get(path)?.get(tag) ?? 0;
}

function analyzeImport(vault, snapshot, missingTables, repairTables = []) {
  let newAuxiliaryRows = 0;
  let newAssociations = 0;
  for (const [path, assigned] of vault.mods) {
    if (!snapshot.paths.has(path)) {
      newAuxiliaryRows += 1;
    }
    for (const tag of assigned) {
      if (associationCopies(snapshot, path, tag) === 0) {
        newAssociations += 1;
      }
    }
  }
  const newTagRows = [...vault.tags].filter((tag) => !snapshot.tags.has(tag)).length;
  return {
    entriesRead: vault.entriesRead,
    validPaths: vault.mods.size,
    uniqueTags: vault.tags.size,
    expectedAssociations: vault.associationCount,
    newAuxiliaryRows,
    newTagRows,
    newAssociations,
    reusedAssociations: vault.associationCount - newAssociations,
    remappedPaths: vault.remappedPaths,
    rimSortInstanceName: vault.rimSortInstanceName,
    missingTables,
    repairTables,
    duplicateAssociations: snapshot.duplicateAssociations,
    issues: vault.issues,
  };
}

function printSummary(summary, dryRun, backupPath) {
  console.log(dryRun ? "Dry-run summary:" : "Import summary:");
  console.log(`  Mod entries read: ${summary.entriesRead}`);
  console.log(`  Valid unique mod paths: ${summary.validPaths}`);
  console.log(
    `  Workshop paths mapped from RimSort settings: ${summary.remappedPaths}` +
      (summary.rimSortInstanceName
        ? ` (instance ${JSON.stringify(summary.rimSortInstanceName)})`
        : ""),
  );
  console.log(`  Unique normalized tags found: ${summary.uniqueTags}`);
  console.log(`  Expected tag associations: ${summary.expectedAssociations}`);
  console.log(`  New auxiliary_metadata rows: ${summary.newAuxiliaryRows}`);
  console.log(`  New mod_tags rows: ${summary.newTagRows}`);
  console.log(`  New tags_table associations: ${summary.newAssociations}`);
  console.log(`  Existing associations reused: ${summary.reusedAssociations}`);
  console.log(
    `  Missing tables ${dryRun ? "that would be initialized" : "initialized"}: ` +
      (summary.missingTables.length > 0 ? summary.missingTables.join(", ") : "none"),
  );
  console.log(
    `  Stale foreign keys ${dryRun ? "that would be repaired" : "repaired"}: ` +
      (summary.repairTables.length > 0 ? summary.repairTables.join(", ") : "none"),
  );
  if (!dryRun) {
    console.log(`  Backup: ${backupPath ?? "not created (database was already up to date)"}`);
  }

  const notices = [...summary.issues];
  for (const [pair, copies] of summary.duplicateAssociations) {
    notices.push(
      `database: existing duplicate association ${pair} has ${copies} rows; left unchanged.`,
    );
  }
  console.log(`Conflicts/skipped rows (${notices.length}):`);
  if (notices.length === 0) {
    console.log("  none");
  } else {
    for (const notice of notices) {
      console.log(`  - ${notice}`);
    }
  }
  if (dryRun) {
    console.log("Dry run complete; no database changes or backup were made.");
  }
}

function initializeMissingTables(database, missingTables) {
  for (const table of canonicalTables) {
    if (missingTables.includes(table)) {
      database.exec(canonicalTableSql[table]);
    }
  }
}

function tableContentsFingerprint(database, table) {
  const query =
    table === "tags_table"
      ? `SELECT left_id, right_id
         FROM tags_table
         ORDER BY typeof(left_id), left_id, typeof(right_id), right_id`
      : `SELECT id, owner_repo, mod_path, installed_version, installed_asset_name,
                installed_commit_sha, auto_update, created_at, updated_at
         FROM github_mods
         ORDER BY id`;
  return metadataFingerprint(database.prepare(query).all());
}

function temporaryTableContentsFingerprint(database, table) {
  const temporary = repairTableNames[table];
  const query =
    table === "tags_table"
      ? `SELECT left_id, right_id
         FROM ${temporary}
         ORDER BY typeof(left_id), left_id, typeof(right_id), right_id`
      : `SELECT id, owner_repo, mod_path, installed_version, installed_asset_name,
                installed_commit_sha, auto_update, created_at, updated_at
         FROM ${temporary}
         ORDER BY id`;
  return metadataFingerprint(database.prepare(query).all());
}

function repairKnownForeignKeys(database, staleForeignKeyTables) {
  for (const table of staleForeignKeyTables) {
    const temporary = repairTableNames[table];
    const before = tableContentsFingerprint(database, table);
    database.exec(repairTableSql[table]);
    if (table === "tags_table") {
      database.exec(
        `INSERT INTO ${temporary} (left_id, right_id)
         SELECT left_id, right_id FROM tags_table`,
      );
    } else {
      database.exec(
        `INSERT INTO ${temporary} (
           id, owner_repo, mod_path, installed_version, installed_asset_name,
           installed_commit_sha, auto_update, created_at, updated_at
         )
         SELECT id, owner_repo, mod_path, installed_version, installed_asset_name,
                installed_commit_sha, auto_update, created_at, updated_at
         FROM github_mods`,
      );
    }
    if (temporaryTableContentsFingerprint(database, table) !== before) {
      fail(`Schema repair validation failed while copying ${table}; rolling back.`);
    }
    database.exec(`DROP TABLE ${table}`);
    database.exec(`ALTER TABLE ${temporary} RENAME TO ${table}`);
    if (table === "github_mods") {
      database.exec("CREATE INDEX ix_github_mods_owner_repo ON github_mods (owner_repo)");
    }
    if (tableContentsFingerprint(database, table) !== before) {
      fail(`Schema repair validation failed after rebuilding ${table}; rolling back.`);
    }
  }
}

function metadataFingerprint(row) {
  return JSON.stringify(row, (_key, value) => (typeof value === "bigint" ? String(value) : value));
}

function snapshotExistingMetadata(database) {
  return new Map(
    database
      .prepare("SELECT * FROM auxiliary_metadata ORDER BY path")
      .all()
      .map((row) => [row.path, metadataFingerprint(row)]),
  );
}

function insertImport(database, vault, before) {
  const insertAuxiliary = database.prepare(
    `INSERT INTO auxiliary_metadata (
       path, type, published_file_id, acf_time_touched, acf_time_updated,
       external_time_created, external_time_updated, user_notes, color_hex,
       ignore_warnings, outdated, db_time_touched
     )
     SELECT ?, ?, ?, -1, -1, -1, -1, '', NULL, 0, 0, CURRENT_TIMESTAMP
     WHERE NOT EXISTS (SELECT 1 FROM auxiliary_metadata WHERE path = ?)`,
  );
  const insertTag = database.prepare(
    `INSERT INTO mod_tags (tag)
     SELECT ? WHERE NOT EXISTS (SELECT 1 FROM mod_tags WHERE tag = ?)`,
  );
  const insertAssociation = database.prepare(
    `INSERT INTO tags_table (left_id, right_id)
     SELECT ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM tags_table WHERE left_id = ? AND right_id = ?
     )`,
  );

  let auxiliaryRows = 0;
  let tagRows = 0;
  let associations = 0;
  for (const path of [...vault.mods.keys()].sort()) {
    const metadata = vault.modMetadata.get(path);
    if (!metadata) {
      fail(`Internal error: normalized metadata is missing for ${JSON.stringify(path)}.`);
    }
    auxiliaryRows += Number(
      insertAuxiliary.run(path, metadata.type, metadata.publishedFileId, path).changes,
    );
  }
  for (const tag of [...vault.tags].sort()) {
    tagRows += Number(insertTag.run(tag, tag).changes);
  }
  const tagIds = new Map(
    database
      .prepare("SELECT id, tag FROM mod_tags")
      .all()
      .map((row) => [row.tag, row.id]),
  );
  for (const [path, assigned] of [...vault.mods.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    for (const tag of [...assigned].sort()) {
      const tagId = tagIds.get(tag);
      if (tagId === undefined) {
        fail(`Post-insert validation failed: no mod_tags row exists for ${JSON.stringify(tag)}.`);
      }
      associations += Number(insertAssociation.run(path, tagId, path, tagId).changes);
    }
  }

  if (
    auxiliaryRows !== before.newAuxiliaryRows ||
    tagRows !== before.newTagRows ||
    associations !== before.newAssociations
  ) {
    fail(
      "The database changed unexpectedly while importing; the transaction has been rolled back.",
    );
  }
}

function validateImport(database, vault, beforeSnapshot, preservedMetadata) {
  const after = fetchSnapshot(database, []);
  const missingPaths = [...vault.mods.keys()].filter((path) => !after.paths.has(path));
  if (missingPaths.length > 0) {
    fail(
      `Post-import validation failed: ${missingPaths.length} auxiliary_metadata path(s) are missing.`,
    );
  }
  const missingTags = [...vault.tags].filter((tag) => !after.tags.has(tag));
  if (missingTags.length > 0) {
    fail(`Post-import validation failed: ${missingTags.length} mod_tags row(s) are missing.`);
  }
  for (const [path, assigned] of vault.mods) {
    for (const tag of assigned) {
      const beforeCopies = associationCopies(beforeSnapshot, path, tag);
      const afterCopies = associationCopies(after, path, tag);
      const expectedCopies = Math.max(1, beforeCopies);
      if (afterCopies !== expectedCopies) {
        fail(
          `Post-import validation failed for ${JSON.stringify(path)} / ${JSON.stringify(tag)}: ` +
            `expected ${expectedCopies} association row(s), found ${afterCopies}.`,
        );
      }
    }
  }

  const duplicateTags = database
    .prepare("SELECT tag, COUNT(*) AS copies FROM mod_tags GROUP BY tag HAVING COUNT(*) > 1")
    .all();
  if (duplicateTags.length > 0) {
    fail("Post-import validation failed: duplicate mod_tags rows exist.");
  }
  for (const [pair, copies] of after.duplicateAssociations) {
    if ((beforeSnapshot.duplicateAssociations.get(pair) ?? 1) !== copies) {
      fail(`Post-import validation failed: duplicate association count changed for ${pair}.`);
    }
  }
  for (const [path, fingerprint] of preservedMetadata) {
    const row = database.prepare("SELECT * FROM auxiliary_metadata WHERE path = ?").get(path);
    if (!row || metadataFingerprint(row) !== fingerprint) {
      fail(`Post-import validation failed: existing metadata changed for ${JSON.stringify(path)}.`);
    }
  }
  verifyDatabaseHealth(database, true);
}

function backupPathFor(databasePath) {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  return `${databasePath}.before-mod-vault-import-${timestamp}-${randomUUID()}.bak`;
}

async function createBackup(databasePath, lockedDatabase) {
  const path = backupPathFor(databasePath);
  const source = new DatabaseSync(databasePath, { readOnly: true, timeout: 5_000 });
  try {
    // lockedDatabase owns BEGIN IMMEDIATE while this independent read connection takes a
    // transactionally consistent online backup. This includes committed WAL content and prevents
    // another writer from changing the source between backup and import.
    try {
      await backup(source, path);
    } catch (error) {
      fail(
        `SQLite backup failed while writing ${path}; the file may be incomplete and no import ` +
          `was attempted: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } finally {
    source.close();
  }
  const copy = new DatabaseSync(path, { readOnly: true, timeout: 5_000 });
  try {
    verifyDatabaseHealth(copy, false);
  } catch (error) {
    fail(
      `The SQLite backup at ${path} could not be verified: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    copy.close();
  }
  // Keep the argument visible so a future refactor cannot accidentally remove the lock contract.
  if (!lockedDatabase) {
    fail("Internal error: backup requested without a locked database.");
  }
  return path;
}

function discoverRimSortSettings(paths) {
  if (paths.settings || basename(paths.database) !== "aux_metadata.db") {
    return;
  }
  const instancesDirectory = dirname(dirname(paths.database));
  if (basename(instancesDirectory) !== "instances") {
    return;
  }
  paths.settings = join(dirname(instancesDirectory), "settings.json");
}

async function assertInputFiles(paths) {
  const vaultStat = await stat(paths.vault).catch((error) => {
    fail(`Cannot read vault ${paths.vault}: ${error.message}`);
  });
  if (!vaultStat.isFile()) {
    fail(`Vault path is not a file: ${paths.vault}`);
  }
  const databaseStat = await stat(paths.database).catch((error) => {
    fail(
      `Cannot open RimSort database ${paths.database}: ${error.message}. ` +
        "Select an existing per-instance aux_metadata.db; the importer will not guess its location.",
    );
  });
  if (!databaseStat.isFile()) {
    fail(`RimSort database path is not a file: ${paths.database}`);
  }
  if (paths.settings) {
    const settingsStat = await stat(paths.settings).catch((error) => {
      fail(`Cannot read RimSort settings ${paths.settings}: ${error.message}`);
    });
    if (!settingsStat.isFile()) {
      fail(`RimSort settings path is not a file: ${paths.settings}`);
    }
  }
}

async function readRimSortInstance(path, databasePath) {
  if (!path) {
    return undefined;
  }
  let source;
  try {
    source = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    fail(`Cannot parse RimSort settings ${path}: ${error.message}`);
  }
  if (!isRecord(source)) {
    fail(`Invalid RimSort settings ${path}: expected a JSON object.`);
  }
  const name = source.current_instance;
  if (typeof name !== "string" || !name.trim()) {
    fail(`Invalid RimSort settings ${path}: current_instance is missing.`);
  }
  if (!isRecord(source.instances) || !isRecord(source.instances[name])) {
    fail(`Invalid RimSort settings ${path}: current instance ${JSON.stringify(name)} is missing.`);
  }
  if (
    typeof source.current_instance_path !== "string" ||
    !isAbsolute(source.current_instance_path)
  ) {
    fail(`Invalid RimSort settings ${path}: current_instance_path must be absolute.`);
  }
  const configuredInstancePath = normalize(join(source.current_instance_path, "."));
  const databaseInstancePath = normalize(dirname(databasePath));
  if (configuredInstancePath !== databaseInstancePath) {
    fail(
      `RimSort settings/database mismatch: current instance ${JSON.stringify(name)} uses ` +
        `${configuredInstancePath}, but --db is in ${databaseInstancePath}. No changes were made.`,
    );
  }
  const workshopFolder = source.instances[name].workshop_folder;
  if (
    typeof workshopFolder !== "string" ||
    !workshopFolder.trim() ||
    !isAbsolute(workshopFolder) ||
    hasControlCharacter(workshopFolder)
  ) {
    fail(
      `Invalid RimSort settings ${path}: instance ${JSON.stringify(name)} has no valid absolute ` +
        "workshop_folder.",
    );
  }
  return {
    name,
    workshopFolder: normalize(join(workshopFolder.trim(), ".")),
  };
}

async function readVault(path, rimSortInstance) {
  let source;
  try {
    source = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    fail(`Cannot parse vault ${path}: ${error.message}`);
  }
  return normalizeVault(source, rimSortInstance);
}

async function dryRun(paths, vault) {
  const database = new DatabaseSync(paths.database, { readOnly: true, timeout: 5_000 });
  try {
    const schema = validatePresentSchema(database, paths.repairRimSortSchema);
    validateRepairableRows(database, schema.staleForeignKeyTables, new Set(vault.mods.keys()));
    verifyDatabaseHealth(
      database,
      schema.missingTables.length === 0 && schema.staleForeignKeyTables.length === 0,
    );
    const snapshot = fetchSnapshot(database, schema.missingTables);
    printSummary(
      analyzeImport(vault, snapshot, schema.missingTables, schema.staleForeignKeyTables),
      true,
    );
  } finally {
    database.close();
  }
}

async function importTags(paths, vault) {
  // Fail on a known mismatch before creating a backup or taking a writer lock.
  const preflight = new DatabaseSync(paths.database, { readOnly: true, timeout: 5_000 });
  let preflightSchema;
  try {
    preflightSchema = validatePresentSchema(preflight, paths.repairRimSortSchema);
    validateRepairableRows(
      preflight,
      preflightSchema.staleForeignKeyTables,
      new Set(vault.mods.keys()),
    );
    verifyDatabaseHealth(
      preflight,
      preflightSchema.missingTables.length === 0 &&
        preflightSchema.staleForeignKeyTables.length === 0,
    );
  } finally {
    preflight.close();
  }

  const database = new DatabaseSync(paths.database, { timeout: 5_000 });
  let transactionOpen = false;
  let backupPath;
  try {
    const enforceForeignKeysDuringWrite = preflightSchema.staleForeignKeyTables.length === 0;
    database.exec(`PRAGMA foreign_keys = ${enforceForeignKeysDuringWrite ? "ON" : "OFF"}`);
    const foreignKeysEnabled = Number(database.prepare("PRAGMA foreign_keys").get().foreign_keys);
    if (foreignKeysEnabled !== Number(enforceForeignKeysDuringWrite)) {
      fail("Could not configure SQLite foreign-key enforcement safely; no changes were made.");
    }
    database.exec("BEGIN IMMEDIATE");
    transactionOpen = true;

    const schema = validatePresentSchema(database, paths.repairRimSortSchema);
    validateRepairableRows(database, schema.staleForeignKeyTables, new Set(vault.mods.keys()));
    const beforeSnapshot = fetchSnapshot(database, schema.missingTables);
    const summary = analyzeImport(
      vault,
      beforeSnapshot,
      schema.missingTables,
      schema.staleForeignKeyTables,
    );
    const needsWrite =
      schema.missingTables.length > 0 ||
      schema.staleForeignKeyTables.length > 0 ||
      summary.newAuxiliaryRows > 0 ||
      summary.newTagRows > 0 ||
      summary.newAssociations > 0;

    if (!needsWrite) {
      validateImport(database, vault, beforeSnapshot, snapshotExistingMetadata(database));
      database.exec("ROLLBACK");
      transactionOpen = false;
      database.exec("PRAGMA foreign_keys = ON");
      printSummary(summary, false);
      return;
    }

    backupPath = await createBackup(paths.database, database);
    initializeMissingTables(database, schema.missingTables);
    repairKnownForeignKeys(database, schema.staleForeignKeyTables);
    const repairedSchema = validatePresentSchema(database);
    if (repairedSchema.missingTables.length > 0) {
      fail(`Failed to initialize RimSort tables: ${repairedSchema.missingTables.join(", ")}.`);
    }
    if (repairedSchema.staleForeignKeyTables.length > 0) {
      fail(
        `Failed to repair RimSort foreign keys: ${repairedSchema.staleForeignKeyTables.join(", ")}.`,
      );
    }
    const currentSnapshot = fetchSnapshot(database, []);
    const currentSummary = analyzeImport(
      vault,
      currentSnapshot,
      schema.missingTables,
      schema.staleForeignKeyTables,
    );
    const preservedMetadata = snapshotExistingMetadata(database);
    insertImport(database, vault, currentSummary);
    validateImport(database, vault, currentSnapshot, preservedMetadata);
    database.exec("COMMIT");
    transactionOpen = false;
    database.exec("PRAGMA foreign_keys = ON");
    printSummary(currentSummary, false, backupPath);
  } catch (error) {
    if (transactionOpen) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Preserve the original error; SQLite will also roll back when the connection closes.
      }
    }
    if (backupPath && error instanceof Error) {
      error.message += ` A pre-import backup was preserved at ${backupPath}.`;
    }
    throw error;
  } finally {
    database.close();
  }
}

async function main() {
  const paths = parseArguments(process.argv.slice(2));
  discoverRimSortSettings(paths);
  await assertInputFiles(paths);
  const rimSortInstance = await readRimSortInstance(paths.settings, paths.database);
  const vault = await readVault(paths.vault, rimSortInstance);
  if (paths.dryRun) {
    await dryRun(paths, vault);
  } else {
    await importTags(paths, vault);
  }
}

main().catch((error) => {
  console.error(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
