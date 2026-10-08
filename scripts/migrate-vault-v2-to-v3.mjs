#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { constants, copyFile, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { resolve } from "node:path";

const usage = `Usage:
  npm run migrate:vault:v3 -- /path/to/mod-vault.json
  npm run migrate:vault:v3 -- /path/to/v2.json --output /path/to/v3.json

Without --output, the source is migrated in place after an exclusive .v2-backup-* copy is made.`;

function fail(message) {
  throw new Error(message);
}

function parseArguments(args) {
  let input;
  let output;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      console.log(usage);
      process.exit(0);
    }
    if (argument === "--output") {
      output = args[++index];
      if (!output) {
        fail("--output requires a file path.");
      }
      continue;
    }
    if (argument.startsWith("--")) {
      fail(`Unknown option: ${argument}`);
    }
    if (input) {
      fail("Provide exactly one input vault path.");
    }
    input = argument;
  }
  if (!input) {
    fail(usage);
  }
  return { input: resolve(input), output: output ? resolve(output) : resolve(input) };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function workshopId(value, location) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    fail(`Invalid Steam Workshop id at ${location}.`);
  }
  return value;
}

function unique(values) {
  return [...new Set(values)];
}

function validateOptional(value, predicate, location) {
  if (value !== undefined && !predicate(value)) {
    fail(`Invalid v2 vault field: ${location}.`);
  }
}

function validateMod(mod, index) {
  const strings = [
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
  ];
  const arrays = ["tags", "gameVersions", "screenshots", "userTagIds"];
  for (const field of strings) {
    validateOptional(mod[field], (value) => typeof value === "string", `mods.${index}.${field}`);
  }
  for (const field of arrays) {
    validateOptional(
      mod[field],
      (value) => Array.isArray(value) && value.every((entry) => typeof entry === "string"),
      `mods.${index}.${field}`,
    );
  }
  validateOptional(
    mod.source,
    (value) => ["steam", "local", "manual"].includes(value),
    `mods.${index}.source`,
  );
  validateOptional(
    mod.subscribed,
    (value) => typeof value === "boolean",
    `mods.${index}.subscribed`,
  );
  validateOptional(
    mod.fileSize,
    (value) => typeof value === "number" && Number.isFinite(value) && value >= 0,
    `mods.${index}.fileSize`,
  );
}

function validateSettings(settings) {
  if (settings === undefined) {
    return;
  }
  if (!isRecord(settings)) {
    fail("Invalid v2 vault: settings must be an object.");
  }
  validateOptional(
    settings.rimWorldConfigPath,
    (value) => typeof value === "string",
    "settings.rimWorldConfigPath",
  );
  validateOptional(
    settings.workshopModsPath,
    (value) => typeof value === "string",
    "settings.workshopModsPath",
  );
  if (settings.firebaseSync !== undefined) {
    if (!isRecord(settings.firebaseSync)) {
      fail("Invalid v2 vault field: settings.firebaseSync.");
    }
    for (const field of ["apiKey", "authDomain", "projectId", "appId", "email"]) {
      validateOptional(
        settings.firebaseSync[field],
        (value) => typeof value === "string",
        `settings.firebaseSync.${field}`,
      );
    }
    if (typeof settings.firebaseSync.enabled !== "boolean") {
      fail("Invalid v2 vault field: settings.firebaseSync.enabled.");
    }
  }
}

function migrate(source) {
  if (!isRecord(source) || source.schemaVersion !== 2) {
    fail("The input must be a RimLib schema v2 vault.");
  }
  if (!Array.isArray(source.mods)) {
    fail("Invalid v2 vault: mods must be an array.");
  }
  const ids = new Set();
  const mods = source.mods.map((value, index) => {
    if (
      !isRecord(value) ||
      typeof value.id !== "string" ||
      !value.id ||
      typeof value.name !== "string"
    ) {
      fail(`Invalid mod at mods.${index}.`);
    }
    if (ids.has(value.id)) {
      fail(`Duplicate mod id: ${value.id}.`);
    }
    validateMod(value, index);
    ids.add(value.id);
    const mod = { ...value };
    Reflect.deleteProperty(mod, "subscribed");
    return mod;
  });
  const tags = source.userTags ?? [];
  if (!Array.isArray(tags)) {
    fail("Invalid v2 vault: userTags must be an array.");
  }
  const tagIds = new Set();
  for (const [index, tag] of tags.entries()) {
    if (
      !isRecord(tag) ||
      typeof tag.id !== "string" ||
      !tag.id ||
      typeof tag.name !== "string" ||
      !tag.name.trim() ||
      typeof tag.color !== "string" ||
      !tag.color ||
      tagIds.has(tag.id)
    ) {
      fail(`Invalid or duplicate tag at userTags.${index}.`);
    }
    tagIds.add(tag.id);
  }

  const observedIds = unique(
    source.steamSubscribedIds === undefined
      ? source.mods.flatMap((mod, index) =>
          isRecord(mod) && mod.subscribed === true && mod.workshopId !== undefined
            ? [workshopId(mod.workshopId, `mods.${index}.workshopId`)]
            : [],
        )
      : (() => {
          if (!Array.isArray(source.steamSubscribedIds)) {
            fail("Invalid v2 vault: steamSubscribedIds must be an array.");
          }
          return source.steamSubscribedIds.map((id, index) =>
            workshopId(id, `steamSubscribedIds.${index}`),
          );
        })(),
  );

  const pending = {};
  if (source.workshopSubscriptionOverrides !== undefined) {
    if (!isRecord(source.workshopSubscriptionOverrides)) {
      fail("Invalid v2 vault: workshopSubscriptionOverrides must be an object.");
    }
    for (const [id, subscribed] of Object.entries(source.workshopSubscriptionOverrides)) {
      workshopId(id, "workshopSubscriptionOverrides");
      if (typeof subscribed !== "boolean") {
        fail(`Invalid pending subscription value for Workshop item ${id}.`);
      }
      pending[id] = subscribed ? "subscribe" : "unsubscribe";
    }
  }

  const localSteamState = { observedIds, pending };
  if (source.steamStatusSource !== undefined) {
    if (!["workshop-folders", "steam-client"].includes(source.steamStatusSource)) {
      fail("Invalid v2 vault: unsupported steamStatusSource.");
    }
    localSteamState.source = source.steamStatusSource;
  }
  // v2 stored effective membership. Undo pending actions to recover the last observation;
  // applying pending again in v3 then produces exactly the same effective membership.
  const observation = new Set(localSteamState.observedIds);
  for (const [id, command] of Object.entries(pending)) {
    if (command === "subscribe") {
      observation.delete(id);
    } else {
      observation.add(id);
    }
  }
  localSteamState.observedIds = [...observation];
  validateSettings(source.settings);
  validateOptional(source.revision, (value) => typeof value === "string", "revision");

  const migratedKeys = new Set([
    "schemaVersion",
    "revision",
    "mods",
    "userTags",
    "settings",
    "steamSubscribedIds",
    "steamStatusSource",
    "workshopSubscriptionOverrides",
    "subscriptionSelection",
    "selectedModId",
  ]);
  const extensions = Object.fromEntries(
    Object.entries(source).filter(([key]) => !migratedKeys.has(key)),
  );

  return {
    ...extensions,
    schemaVersion: 3,
    ...(typeof source.revision === "string" ? { revision: source.revision } : {}),
    library: { mods, tags },
    ...(source.settings === undefined ? {} : { settings: source.settings }),
    deviceState: { steam: localSteamState },
  };
}

async function atomicWrite(path, text, mode, expected) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, "wx", mode);
    try {
      await file.writeFile(text, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    if (expected !== undefined && (await readFile(path, "utf8")) !== expected) {
      fail("The input vault changed while migration was running; no replacement was made.");
    }
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function main() {
  const paths = parseArguments(process.argv.slice(2));
  const sourceText = await readFile(paths.input, "utf8");
  let source;
  try {
    source = JSON.parse(sourceText);
  } catch (error) {
    fail(`The input is not valid JSON: ${error.message}`);
  }
  const migrated = migrate(source);
  const mode = (await stat(paths.input)).mode & 0o777;
  let backup;
  if (paths.output === paths.input) {
    backup = `${paths.input}.v2-backup-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.json`;
    await copyFile(paths.input, backup, constants.COPYFILE_EXCL);
  } else {
    await open(paths.output, "wx", mode).then((file) => file.close());
    await unlink(paths.output);
  }
  await atomicWrite(
    paths.output,
    `${JSON.stringify(migrated, null, 2)}\n`,
    mode,
    paths.output === paths.input ? sourceText : undefined,
  );
  console.log(
    `Migrated ${migrated.library.mods.length} mods and ${migrated.library.tags.length} tags to schema v3.`,
  );
  console.log(`Output: ${paths.output}`);
  if (backup) {
    console.log(`Backup: ${backup}`);
  }
}

main().catch((error) => {
  console.error(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
