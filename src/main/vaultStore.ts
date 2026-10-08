import { randomUUID } from "node:crypto";
import { copyFile, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import { vaultBackupDirectory, vaultBackupSuffix } from "../shared/storage";
import type { ModVault, VaultSaveOptions } from "../shared/types";
import { errorCode } from "../shared/validation";
import { createEmptyVault, mergeVaultSave, normalizeVault, serializeVault } from "../shared/vault";
import { parseStoredVault } from "../shared/vaultValidation";
import { log } from "./logging";
import { fileErrorCodes, privateFileMode } from "./platformConstants";

export async function atomicWrite(
  path: string,
  text: string,
  guard?: { expected: string | undefined },
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
      const existing = await readFile(path, "utf8").catch((error: unknown) => {
        if (errorCode(error) !== fileErrorCodes.notFound) {
          throw error;
        }
        return undefined;
      });
      if (existing !== guard.expected) {
        throw new Error("File changed outside this app. Writes are blocked; reload before saving.");
      }
    }
    await rename(temporary, path);
    // Flush the rename on filesystems that support directory fsync.
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
        const parsed = parseStoredVault(JSON.parse(raw));
        this.current = normalizeVault(parsed);
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
