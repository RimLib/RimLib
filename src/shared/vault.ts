import { modSources, subscriptionCommands } from "./domainConstants";
import type { LocalSteamState, Mod, ModVault, SteamImportResult, VaultSaveOptions } from "./types";
import { isRecord } from "./validation";
import {
  parseStoredVault,
  type StoredMod,
  type StoredVault,
  vaultSchemaVersion,
} from "./vaultValidation";
export { vaultSchemaVersion } from "./vaultValidation";

export function createEmptyVault(): ModVault {
  return {
    schemaVersion: vaultSchemaVersion,
    mods: [],
    userTags: [],
    settings: {},
    localSteamState: { observedIds: [], pending: {} },
  };
}

function normalizeMod(mod: StoredMod, subscribedIds: ReadonlySet<string>): Mod {
  return {
    ...mod,
    author: mod.author ?? "Unknown author",
    source: mod.source ?? modSources.manual,
    summary: mod.summary ?? "",
    subscribed: Boolean(mod.workshopId && subscribedIds.has(mod.workshopId)),
    downloadedAt: mod.downloadedAt ?? "",
    addedAt: mod.addedAt ?? "",
    tags: mod.tags ?? [],
    userTagIds: mod.userTagIds ?? [],
    gameVersions: mod.gameVersions ?? [],
    screenshots: mod.screenshots ?? [],
  };
}

export function effectiveSubscribedIds(state: LocalSteamState): Set<string> {
  const ids = new Set(state.observedIds);
  for (const [id, command] of Object.entries(state.pending)) {
    if (command === subscriptionCommands.subscribe) {
      ids.add(id);
    } else {
      ids.delete(id);
    }
  }
  return ids;
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  const leftValues = new Set(left);
  const rightValues = new Set(right);
  if (leftValues.size !== rightValues.size) {
    return false;
  }
  return [...leftValues].every((value) => rightValues.has(value));
}

function samePendingSubscriptions(
  left: LocalSteamState["pending"],
  right: LocalSteamState["pending"],
) {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      ([id, command]) => Object.prototype.hasOwnProperty.call(right, id) && right[id] === command,
    )
  );
}

/**
 * Applies one authoritative local Steam observation without disturbing unrelated vault data.
 * Observation timestamps deliberately do not make an otherwise identical observation a write.
 */
export function reconcileLocalSteamState(vault: ModVault, nextState: LocalSteamState): ModVault {
  const subscribedIds = effectiveSubscribedIds(nextState);
  const flagsMatch = vault.mods.every(
    (mod) => !mod.workshopId || mod.subscribed === subscribedIds.has(mod.workshopId),
  );
  if (
    vault.localSteamState.source === nextState.source &&
    sameStringSet(vault.localSteamState.observedIds, nextState.observedIds) &&
    samePendingSubscriptions(vault.localSteamState.pending, nextState.pending) &&
    flagsMatch
  ) {
    return vault;
  }
  return {
    ...vault,
    localSteamState: {
      ...vault.localSteamState,
      ...nextState,
      observedIds: nextState.observedIds,
      pending: nextState.pending,
    },
    mods: flagsMatch
      ? vault.mods
      : vault.mods.map((mod) => {
          if (!mod.workshopId) {
            return mod;
          }
          const subscribed = subscribedIds.has(mod.workshopId);
          return mod.subscribed === subscribed ? mod : { ...mod, subscribed };
        }),
  };
}

function fromStoredVault(vault: StoredVault): ModVault {
  const subscribedIds = effectiveSubscribedIds(vault.deviceState.steam);
  const { mods: _storedMods, tags: _storedTags, ...libraryExtensions } = vault.library;
  const { steam: _steam, ...deviceStateExtensions } = vault.deviceState;
  const {
    library: _library,
    deviceState: _deviceState,
    schemaVersion: _schemaVersion,
    revision,
    settings,
    subscriptionSelection: _subscriptionSelection,
    steamSubscribedIds: _steamSubscribedIds,
    steamStatusSource: _steamStatusSource,
    workshopSubscriptionOverrides: _workshopSubscriptionOverrides,
    selectedModId: _selectedModId,
    ...extensions
  } = vault;
  return normalizeRuntimeVault({
    ...extensions,
    schemaVersion: vaultSchemaVersion,
    revision,
    settings,
    libraryExtensions,
    deviceStateExtensions,
    mods: vault.library.mods.map((mod) => normalizeMod(mod, subscribedIds)),
    userTags: vault.library.tags,
    localSteamState: vault.deviceState.steam,
  });
}

function isStoredVault(value: unknown): value is StoredVault {
  return (
    isRecord(value) && ("library" in value || ("schemaVersion" in value && !("mods" in value)))
  );
}

function normalizeRuntimeVault(vault: ModVault): ModVault {
  if (new Set(vault.mods.map((mod) => mod.id)).size !== vault.mods.length) {
    throw new Error("Duplicate database identifiers. Database writes have been blocked.");
  }
  const userTags = vault.userTags;
  if (new Set(userTags.map((tag) => tag.id)).size !== userTags.length) {
    throw new Error("Duplicate tag identifiers. Database writes have been blocked.");
  }
  const subscribedIds = effectiveSubscribedIds(vault.localSteamState);
  const mods = vault.mods.map((mod) => {
    const normalized = normalizeMod(mod, subscribedIds);
    return {
      ...normalized,
      userTagIds: [...new Set(normalized.userTagIds ?? [])],
    };
  });
  return {
    ...vault,
    schemaVersion: vaultSchemaVersion,
    settings: { ...vault.settings },
    mods,
    userTags,
    localSteamState: {
      ...vault.localSteamState,
      observedIds: [...new Set(vault.localSteamState.observedIds)],
      pending: { ...vault.localSteamState.pending },
    },
  };
}

export function normalizeVault(value: unknown): ModVault {
  if (isStoredVault(value)) {
    return fromStoredVault(parseStoredVault(value));
  }
  // Runtime state is validated through the persisted representation. This is not a v2 reader:
  // VaultStore always parses disk input with parseStoredVault before it reaches this branch.
  if (!isRecord(value)) {
    throw new Error("Invalid mod database. Database writes have been blocked.");
  }
  const rawMods = value.mods;
  if (rawMods !== undefined && !Array.isArray(rawMods)) {
    throw new Error("Invalid mod database at mods. Database writes have been blocked.");
  }
  if (rawMods?.some((mod) => !isRecord(mod))) {
    throw new Error("Invalid mod database at mods. Database writes have been blocked.");
  }
  if (
    rawMods?.some(
      (mod) => isRecord(mod) && mod.subscribed !== undefined && typeof mod.subscribed !== "boolean",
    )
  ) {
    throw new Error("Invalid mod database at mods.subscribed. Database writes have been blocked.");
  }
  const input = value as Partial<ModVault>;
  if (input.schemaVersion !== undefined && input.schemaVersion !== vaultSchemaVersion) {
    if (input.schemaVersion > vaultSchemaVersion) {
      throw new Error(
        "This database was created by a newer app version. Update the app before editing it.",
      );
    }
    throw new Error(
      "Unsupported database schema. Run scripts/migrate-vault-v2-to-v3.mjs before opening this database.",
    );
  }
  if (input.userTags !== undefined && !Array.isArray(input.userTags)) {
    throw new Error("Invalid user tags. Database writes have been blocked.");
  }
  if (input.localSteamState !== undefined && !isRecord(input.localSteamState)) {
    throw new Error("Invalid Steam state. Database writes have been blocked.");
  }
  const mods = input.mods ?? [];
  const candidate: ModVault = {
    ...input,
    schemaVersion: vaultSchemaVersion,
    mods,
    userTags: input.userTags ?? [],
    localSteamState: input.localSteamState ?? {
      observedIds: [
        ...new Set(
          mods.flatMap((mod) =>
            mod.subscribed && mod.workshopId && /^\d+$/.test(mod.workshopId)
              ? [mod.workshopId]
              : [],
          ),
        ),
      ],
      pending: {},
    },
  };
  const stored = serializeVault(candidate);
  parseStoredVault(stored);
  return normalizeRuntimeVault(candidate);
}

export function serializeVault(vault: ModVault): StoredVault {
  const {
    mods: _mods,
    userTags: _userTags,
    localSteamState: _localSteamState,
    deviceState: _deviceState,
    libraryExtensions,
    deviceStateExtensions,
    schemaVersion: _schemaVersion,
    revision,
    settings,
    selectedModId: _selectedModId,
    subscriptionSelection: _subscriptionSelection,
    steamSubscribedIds: _steamSubscribedIds,
    steamStatusSource: _steamStatusSource,
    workshopSubscriptionOverrides: _workshopSubscriptionOverrides,
    ...extensions
  } = vault;
  const mods = vault.mods.map(({ subscribed: _subscribed, ...mod }) => mod);
  return {
    ...extensions,
    schemaVersion: vaultSchemaVersion,
    ...(revision === undefined ? {} : { revision }),
    library: { ...libraryExtensions, mods, tags: vault.userTags },
    ...(settings === undefined ? {} : { settings }),
    deviceState: {
      ...deviceStateExtensions,
      steam: {
        ...vault.localSteamState,
        observedIds: [...new Set(vault.localSteamState.observedIds)],
        pending: { ...vault.localSteamState.pending },
      },
    },
  };
}

export function mergeModMetadata(previous: Mod, incoming: Mod): Mod {
  const defined = Object.fromEntries(
    Object.entries(incoming).filter(([key, value]) => value !== undefined && key !== "userTagIds"),
  );
  return {
    ...previous,
    ...defined,
    name: incoming.name.startsWith("Workshop item ") ? previous.name : incoming.name,
    author: incoming.author === "Unknown author" ? previous.author : incoming.author,
    summary:
      incoming.summary === "Steam Workshop metadata imported."
        ? previous.summary
        : incoming.summary,
    packageId:
      incoming.packageId === "" ? previous.packageId : (incoming.packageId ?? previous.packageId),
    addedAt: previous.addedAt,
    downloadedAt: incoming.downloadedAt || previous.downloadedAt,
    notes: previous.notes ?? incoming.notes,
    screenshots: [...new Set([...previous.screenshots, ...incoming.screenshots])],
    tags: incoming.tags.includes("Metadata needed") ? previous.tags : incoming.tags,
    gameVersions: incoming.gameVersions.length ? incoming.gameVersions : previous.gameVersions,
  };
}

export function mergeSteamSync(vault: ModVault, result: SteamImportResult): ModVault {
  const subscribed = new Set(result.subscribedIds);
  const incoming = new Map(result.mods.map((mod) => [mod.id, mod]));
  const mods = vault.mods.map((mod) => {
    const next = incoming.get(mod.id);
    incoming.delete(mod.id);
    const merged = next ? mergeModMetadata(mod, next) : mod;
    return mod.workshopId ? { ...merged, subscribed: subscribed.has(mod.workshopId) } : merged;
  });
  mods.push(
    ...[...incoming.values()].map((mod) => ({
      ...mod,
      screenshots: [...new Set(mod.screenshots)],
      subscribed: mod.workshopId ? subscribed.has(mod.workshopId) : mod.subscribed,
    })),
  );
  return {
    ...vault,
    mods,
    localSteamState: {
      ...vault.localSteamState,
      observedIds: [...subscribed],
      pending: {},
    },
  };
}

export function mergeVaultSave(
  previous: ModVault,
  incoming: ModVault,
  options: VaultSaveOptions = {},
): ModVault {
  const mods = new Map(previous.mods.map((mod) => [mod.id, mod]));
  for (const mod of incoming.mods) {
    mods.set(mod.id, { ...mods.get(mod.id), ...mod });
  }
  const tags = new Map(previous.userTags.map((tag) => [tag.id, tag]));
  for (const tag of incoming.userTags) {
    tags.set(tag.id, { ...tags.get(tag.id), ...tag });
  }
  const deletedTags = new Set(options.deletedTagIds ?? []);
  deletedTags.forEach((id) => tags.delete(id));
  return normalizeVault({
    ...previous,
    ...incoming,
    settings: { ...previous.settings, ...incoming.settings },
    localSteamState: { ...previous.localSteamState, ...incoming.localSteamState },
    userTags: [...tags.values()],
    mods: [...mods.values()].map((mod) =>
      deletedTags.size
        ? { ...mod, userTagIds: mod.userTagIds?.filter((id) => !deletedTags.has(id)) }
        : mod,
    ),
  });
}

export function deleteLibraryModsExplicitly(vault: ModVault, modIds: string[]): ModVault {
  if (
    !Array.isArray(modIds) ||
    !modIds.length ||
    modIds.some((id) => typeof id !== "string" || !id)
  ) {
    throw new Error("Choose library mods to delete.");
  }
  const ids = new Set(modIds);
  const saved = new Map(vault.mods.map((mod) => [mod.id, mod]));
  const live = effectiveSubscribedIds(vault.localSteamState);
  for (const id of ids) {
    const mod = saved.get(id);
    if (!mod || (mod.workshopId && live.has(mod.workshopId))) {
      throw new Error(
        "The library changed since confirmation. Nothing was deleted; reopen the confirmation. Subscribed mods cannot be removed from the library.",
      );
    }
  }
  return {
    ...vault,
    mods: vault.mods.filter((mod) => !ids.has(mod.id)),
  };
}
