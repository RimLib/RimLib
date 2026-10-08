import type { Mod, ModTag } from "./types";
import { normalizeVault } from "./vault";

export type PortableMod = Omit<Mod, "downloadedAt" | "fileSize" | "localPath" | "subscribed">;

export function toPortableMod(mod: Mod): PortableMod {
  const {
    downloadedAt: _downloadedAt,
    fileSize: _fileSize,
    localPath: _localPath,
    subscribed: _subscribed,
    ...portable
  } = mod;
  return portable;
}

export function parsePortableMod(value: unknown): PortableMod {
  const [mod] = normalizeVault({
    schemaVersion: 3,
    mods: [{ ...(value as object), downloadedAt: "", subscribed: false }],
    userTags: [],
    localSteamState: { observedIds: [], pending: {} },
  }).mods;
  if (!mod) {
    throw new Error("Firebase returned an invalid mod record.");
  }
  return toPortableMod(mod);
}

export function mergePortableMod(local: Mod | undefined, remote: PortableMod): Mod {
  return {
    ...local,
    ...remote,
    subscribed: local?.subscribed ?? false,
    downloadedAt: local?.downloadedAt ?? "",
    ...(local?.fileSize === undefined ? {} : { fileSize: local.fileSize }),
    ...(local?.localPath === undefined ? {} : { localPath: local.localPath }),
  };
}

export function parsePortableTag(value: unknown): ModTag {
  const [tag] = normalizeVault({
    schemaVersion: 3,
    mods: [],
    userTags: [value] as ModTag[],
    localSteamState: { observedIds: [], pending: {} },
  }).userTags;
  if (!tag) {
    throw new Error("Firebase returned an invalid tag record.");
  }
  return tag;
}
