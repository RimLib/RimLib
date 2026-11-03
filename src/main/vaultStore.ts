import { randomUUID } from "node:crypto";
import { copyFile, link, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import { vaultBackupDirectory, vaultBackupSuffix } from "../shared/storage";
import type { ModVault, VaultSaveOptions } from "../shared/types";
import { errorCode } from "../shared/validation";
import { createEmptyVault, mergeVaultSave, normalizeVault, serializeVault } from "../shared/vault";
import { log } from "./logging";
import { fileErrorCodes, privateFileMode } from "./platformConstants";

interface AtomicWriteGuard {
  expected: string | undefined;
  /** A deterministic commit-boundary seam used by the filesystem race tests. */
  beforePublish?: (claimedPath: string | undefined) => Promise<void>;
}

export interface AtomicWriteDependencies {
  link: typeof link;
}

const outsideChangeMessage =
  "File changed outside this app. Writes are blocked; reload before saving.";

function outsideChangeError(cause?: unknown): Error {
  return new Error(outsideChangeMessage, cause === undefined ? undefined : { cause });
}

async function readOptional(path: string): Promise<string | undefined> {
  return readFile(path, "utf8").catch((error: unknown) => {
    if (errorCode(error) !== fileErrorCodes.notFound) {
      throw error;
    }
    return undefined;
  });
}

async function publishExclusively(
  temporary: string,
  path: string,
  linkFile: typeof link,
): Promise<void> {
  try {
    // A hard link publishes the fully flushed temporary inode without replacing a
    // pathname that another process may have created after we claimed the old one.
    await linkFile(temporary, path);
  } catch (error) {
    if (errorCode(error) === "EEXIST") {
      throw outsideChangeError(error);
    }
    throw error;
  }
}

async function restoreClaimedTarget(
  path: string,
  claimedPath: string,
  expected: string,
  published: boolean,
  linkFile: typeof link,
): Promise<string | undefined> {
  if (published) {
    // The new pathname may itself have been changed by another process. Never
    // replace it while handling an error; retain the previous inode for recovery.
    return claimedPath;
  }
  try {
    await linkFile(claimedPath, path);
    await unlink(claimedPath);
    return undefined;
  } catch (error) {
    if (errorCode(error) !== "EEXIST") {
      return claimedPath;
    }
  }
  // A new external pathname wins. The claimed copy is redundant only when it is
  // still the exact expected baseline; otherwise retain both competing edits.
  if ((await readOptional(claimedPath)) === expected) {
    await unlink(claimedPath).catch(() => undefined);
    return undefined;
  }
  return claimedPath;
}

async function guardedPublish(
  path: string,
  temporary: string,
  text: string,
  guard: AtomicWriteGuard,
  dependencies: AtomicWriteDependencies,
): Promise<void> {
  let claimedPath: string | undefined;
  let published = false;
  try {
    if (guard.expected === undefined) {
      await guard.beforePublish?.(undefined);
    } else {
      // Prove that this directory supports the hard-link primitive used for both exclusive
      // publication and non-destructive restoration before moving the user's current file.
      const probePath = `${temporary}.link-probe`;
      try {
        await dependencies.link(temporary, probePath);
      } finally {
        await unlink(probePath).catch(() => undefined);
      }
      claimedPath = `${path}.${randomUUID()}.previous`;
      try {
        // Moving the current pathname is the portable atomic claim. An edit made
        // before this operation moves with it; an edit made afterwards occupies
        // `path` and makes the exclusive publish fail rather than be overwritten.
        await rename(path, claimedPath);
      } catch (error) {
        if (errorCode(error) === fileErrorCodes.notFound) {
          throw outsideChangeError(error);
        }
        throw error;
      }
      await guard.beforePublish?.(claimedPath);
      if ((await readFile(claimedPath, "utf8")) !== guard.expected) {
        throw outsideChangeError();
      }
    }

    await publishExclusively(temporary, path, dependencies.link);
    published = true;
    if ((await readFile(path, "utf8")) !== text) {
      throw new Error(
        "The written file could not be verified; its previous version was preserved.",
      );
    }
    if (claimedPath) {
      if ((await readFile(claimedPath, "utf8")) !== guard.expected) {
        throw outsideChangeError();
      }
      // Recheck the destination after inspecting the claimed inode so changes to
      // either side of the commit are reported before the recovery copy is removed.
      if ((await readFile(path, "utf8")) !== text) {
        throw new Error(
          "The written file could not be verified; its previous version was preserved.",
        );
      }
      await unlink(claimedPath);
      claimedPath = undefined;
    }
  } catch (error) {
    const recoveryPath =
      claimedPath && guard.expected !== undefined
        ? await restoreClaimedTarget(
            path,
            claimedPath,
            guard.expected,
            published,
            dependencies.link,
          )
        : undefined;
    if (recoveryPath) {
      const wrapped = new Error(
        `${(error as Error).message} A recovery copy was preserved at ${recoveryPath}.`,
        { cause: error },
      );
      (wrapped as NodeJS.ErrnoException).code = errorCode(error);
      throw wrapped;
    }
    throw error;
  }
}

export async function atomicWrite(
  path: string,
  text: string,
  guard?: AtomicWriteGuard,
  dependencies: AtomicWriteDependencies = { link },
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, "wx", privateFileMode);
    try {
      await file.writeFile(text, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    if (guard) {
      await guardedPublish(path, temporary, text, guard, dependencies);
    } else {
      await rename(temporary, path);
      if ((await readFile(path, "utf8")) !== text) {
        throw new Error("The written file could not be verified after saving.");
      }
    }
    // Flush the published directory entry on filesystems that support directory fsync.
    const directory = await open(dirname(path), "r").catch(() => undefined);
    if (directory) {
      try {
        await directory.sync().catch(() => undefined);
      } finally {
        await directory.close();
      }
    }
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export class VaultStore {
  private queue: Promise<unknown> = Promise.resolve();
  private loaded = false;
  private current?: ModVault;
  private diskRaw?: string;

  constructor(readonly path: string) {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  load(): Promise<ModVault> {
    return this.serialize(async () => {
      if (this.current && this.loaded) {
        return this.current;
      }
      log.info("database.load.started", { path: this.path });
      this.current = undefined;
      let raw: string;
      try {
        raw = await readFile(this.path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== fileErrorCodes.notFound) {
          throw error;
        }
        try {
          const backup = normalizeVault(
            JSON.parse(await readFile(`${this.path}${vaultBackupSuffix}`, "utf8")),
          );
          this.current = { ...backup, revision: randomUUID() };
          log.warn("database.load.backup-used", {
            reason: "Main file missing",
            modCount: backup.mods.length,
          });
        } catch (backupError) {
          if ((backupError as NodeJS.ErrnoException).code !== fileErrorCodes.notFound) {
            throw backupError;
          }
          this.current = {
            ...createEmptyVault(),
            revision: randomUUID(),
          };
          log.info("database.load.new-library");
        }
        this.loaded = true;
        return this.current;
      }
      this.diskRaw = raw;
      try {
        // normalizeVault validates stored input before converting it. Passing a separately parsed
        // vault here validated every mod twice, which was particularly visible for large libraries.
        this.current = normalizeVault(JSON.parse(raw));
      } catch (error) {
        log.warn("database.load.invalid", { error });
        // An unsupported schema must never be silently replaced with a backup.
        if (/newer app version|Unsupported database schema/.test((error as Error).message)) {
          throw error;
        }
        try {
          const backup = normalizeVault(
            JSON.parse(await readFile(`${this.path}${vaultBackupSuffix}`, "utf8")),
          );
          await mkdir(join(dirname(this.path), vaultBackupDirectory), { recursive: true });
          await copyFile(
            this.path,
            join(
              dirname(this.path),
              vaultBackupDirectory,
              `corrupt-${Date.now()}-${randomUUID()}.json`,
            ),
          );
          await atomicWrite(this.path, JSON.stringify(serializeVault(backup), null, 2));
          this.diskRaw = JSON.stringify(serializeVault(backup), null, 2);
          this.current = backup;
          log.warn("database.recovered", { modCount: backup.mods.length });
        } catch {
          throw new Error(
            "Cannot read the mod database or its backup. Writes are blocked; your files have been preserved.",
          );
        }
      }
      this.current = { ...this.current, revision: this.current.revision ?? randomUUID() };
      this.loaded = true;
      log.info("database.load.completed", {
        schemaVersion: this.current.schemaVersion,
        modCount: this.current.mods.length,
        tagCount: this.current.userTags.length,
      });
      return this.current;
    });
  }

  private async commit(vault: ModVault): Promise<ModVault> {
    if (!this.loaded || !this.current) {
      throw new Error("Database has not been read successfully. Writes are blocked.");
    }
    const next = normalizeVault({ ...vault, revision: randomUUID() });
    log.debug("database.save.started", {
      modCount: next.mods.length,
      tagCount: next.userTags.length,
    });
    const raw = await readFile(this.path, "utf8").catch((error: unknown) => {
      if (errorCode(error) !== fileErrorCodes.notFound) {
        throw error;
      }
      return undefined;
    });
    if (raw !== this.diskRaw) {
      throw new Error(
        "Database changed outside this app. Writes are blocked; restart to reload it.",
      );
    }
    await atomicWrite(
      `${this.path}${vaultBackupSuffix}`,
      raw ?? JSON.stringify(serializeVault(this.current), null, 2),
    );
    const nextRaw = JSON.stringify(serializeVault(next), null, 2);
    await atomicWrite(this.path, nextRaw, { expected: raw });
    this.diskRaw = nextRaw;
    this.current = next;
    log.debug("database.save.completed", {
      bytes: Buffer.byteLength(nextRaw),
      modCount: next.mods.length,
    });
    return next;
  }

  save(vault: ModVault, options?: VaultSaveOptions): Promise<ModVault> {
    return this.serialize(async () => {
      if (!this.current || !this.loaded) {
        throw new Error("Database writes are blocked until loading succeeds.");
      }
      if (vault.revision !== this.current.revision) {
        throw new Error("Database changed during this operation. Reload before saving.");
      }
      if (options?.deletedTagIds?.length) {
        await atomicWrite(
          join(
            dirname(this.path),
            vaultBackupDirectory,
            `${Date.now()}-delete-tag-${randomUUID()}.json`,
          ),
          JSON.stringify(serializeVault(this.current), null, 2),
        );
      }
      return this.commit(mergeVaultSave(this.current, normalizeVault(vault), options));
    });
  }

  update(transform: (vault: ModVault) => ModVault): Promise<ModVault> {
    return this.serialize(async () => {
      if (!this.current) {
        throw new Error("Database has not been loaded.");
      }
      return this.commit(transform(this.current));
    });
  }

  checkpoint(reason: string): Promise<string> {
    return this.serialize(async () => {
      if (!this.current || !this.loaded) {
        throw new Error("Database has not been loaded.");
      }
      const path = join(
        dirname(this.path),
        vaultBackupDirectory,
        `${Date.now()}-${reason}-${randomUUID()}.json`,
      );
      log.info("database.checkpoint", { reason, path });
      await atomicWrite(path, JSON.stringify(serializeVault(this.current), null, 2));
      return path;
    });
  }

  assertUnchanged(): Promise<void> {
    return this.serialize(async () => {
      if (!this.current || !this.loaded) {
        throw new Error("Database has not been loaded.");
      }
      const raw = await readFile(this.path, "utf8").catch((error: unknown) => {
        if (errorCode(error) !== fileErrorCodes.notFound) {
          throw error;
        }
        return undefined;
      });
      if (raw !== this.diskRaw) {
        throw new Error(
          "Database changed outside this app. Steam changes were blocked; restart to reload it.",
        );
      }
    });
  }
}
