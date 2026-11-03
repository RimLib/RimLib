import { modActivities, steamStatusSources } from "../../../shared/domainConstants";
import { isOfficialMod, isUsablePackageId, normalizePackageId } from "../../../shared/packages";
import {
  createActivityLookup,
  isWorkshopMod,
  workshopPlaceholder,
} from "../../../shared/subscriptions";
import type {
  ActiveModsState,
  Mod,
  ModTag,
  ModVault,
  WorkshopStatusSnapshot,
} from "../../../shared/types";
import { requireValue } from "../../../shared/validation";
import { effectiveSubscribedIds, reconcileLocalSteamState } from "../../../shared/vault";
import {
  type ModSort,
  modSorts,
  type ModTagFilter,
  modTagFilters,
  type SearchScope,
  searchScopes,
} from "./uiConstants";

export type { ModSort } from "./uiConstants";

export function matchesModTagFilter(
  mod: Pick<Mod, "userTagIds">,
  tagFilter: ModTagFilter,
): boolean {
  if (tagFilter === modTagFilters.all) {
    return true;
  }
  if (tagFilter === modTagFilters.untagged) {
    return !mod.userTagIds?.length;
  }
  return Boolean(mod.userTagIds?.includes(tagFilter));
}

export function filterModsByTag(mods: readonly Mod[], tagFilter: ModTagFilter): Mod[] {
  return mods.filter((mod) => matchesModTagFilter(mod, tagFilter));
}

function parsedTimestamp(value: string | undefined): number {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/** Latest meaningful point at which this mod was added, installed locally, or updated upstream. */
export function modInstalledOrUpdatedAt(
  mod: Pick<Mod, "addedAt" | "downloadedAt" | "steamUpdatedAt">,
): number {
  return Math.max(
    parsedTimestamp(mod.addedAt),
    parsedTimestamp(mod.downloadedAt),
    parsedTimestamp(mod.steamUpdatedAt),
  );
}

/** Stable-prepend matching rows without changing the order of the remaining Library results. */
export function promoteModsToFront(mods: Mod[], priorityIds?: readonly string[]): Mod[] {
  if (!priorityIds?.length || !mods.length) {
    return mods;
  }
  const byId = new Map(mods.map((mod) => [mod.id, mod]));
  const promoted: Mod[] = [];
  const promotedIds = new Set<string>();
  for (const id of priorityIds) {
    const mod = byId.get(id);
    if (mod && !promotedIds.has(id)) {
      promoted.push(mod);
      promotedIds.add(id);
    }
  }
  return promoted.length ? [...promoted, ...mods.filter((mod) => !promotedIds.has(mod.id))] : mods;
}

export type ModPriorityIdentity = Pick<Mod, "id" | "packageId">;

/** Resolve a transient row identity after installed metadata replaces a package placeholder. */
export function resolveModPriorityId(
  mods: readonly Mod[],
  priority: ModPriorityIdentity,
): string | undefined {
  if (mods.some((mod) => mod.id === priority.id)) {
    return priority.id;
  }
  if (!isUsablePackageId(priority.packageId)) {
    return undefined;
  }
  const packageId = normalizePackageId(priority.packageId);
  const matches = mods.filter(
    (mod) => isUsablePackageId(mod.packageId) && normalizePackageId(mod.packageId) === packageId,
  );
  return matches.length === 1 ? matches[0]?.id : undefined;
}

function compareModIds(left: Mod, right: Mod): number {
  if (left.id < right.id) {
    return -1;
  }
  return left.id > right.id ? 1 : 0;
}

/**
 * Metadata-dependent actions cannot safely identify these entries. Installed local mods also use
 * the `active-package:` ID namespace, so only entries without a local path are placeholders.
 */
export function isModMetadataUnavailable(
  mod: Pick<Mod, "id" | "localPath" | "packageId" | "workshopId">,
): boolean {
  return (
    !isUsablePackageId(mod.packageId) ||
    (mod.id.startsWith("active-package:") && !mod.localPath && !isOfficialMod(mod))
  );
}

export function applyWorkshopStatus(vault: ModVault, snapshot: WorkshopStatusSnapshot): ModVault {
  if (
    vault.revision !== snapshot.revision ||
    vault.settings?.workshopModsPath !== snapshot.workshopModsPath
  ) {
    return vault;
  }
  const nextSteamState = {
    source: steamStatusSources.workshopFolders,
    observedIds: snapshot.observedIds,
    observedAt: snapshot.observedAt,
    pending: snapshot.pending,
  } as const;
  return reconcileLocalSteamState(vault, nextSteamState);
}

export function filterLibrary(
  mods: Mod[],
  query: string,
  searchScope: SearchScope,
  sort: ModSort,
  userTags: readonly ModTag[] = [],
  activeOrder: ReadonlyMap<string, number> = new Map(),
  invalidModIds: ReadonlySet<string> = new Set(),
) {
  const search = query.trim().toLowerCase();
  const userTagNames = new Map(userTags.map((tag) => [tag.id, tag.name.toLowerCase()]));
  const matchesSearch = (mod: Mod) => {
    if (!search) {
      return true;
    }
    const fields: Record<Exclude<SearchScope, "all">, readonly string[]> = {
      title: [mod.name],
      author: [mod.author],
      description: [mod.summary],
      tags: [
        ...mod.tags,
        ...(mod.userTagIds?.flatMap((id) => {
          const name = userTagNames.get(id);
          return name ? [name] : [];
        }) ?? []),
      ],
    };
    const candidates =
      searchScope === searchScopes.all ? Object.values(fields).flat() : fields[searchScope];
    return candidates.some((value) => value.toLowerCase().includes(search));
  };
  return mods.filter(matchesSearch).sort((a, b) => {
    if (sort === modSorts.notSubscribed) {
      const subscriptionDifference = Number(a.subscribed) - Number(b.subscribed);
      if (subscriptionDifference) {
        return subscriptionDifference;
      }
    }
    if (sort === modSorts.invalid) {
      const activeValidationDifference =
        Number(invalidModIds.has(b.id)) - Number(invalidModIds.has(a.id));
      if (activeValidationDifference) {
        return activeValidationDifference;
      }
      const invalidDifference =
        Number(isModMetadataUnavailable(b)) - Number(isModMetadataUnavailable(a));
      if (invalidDifference) {
        return invalidDifference;
      }
    }
    if (
      sort === modSorts.active ||
      sort === modSorts.loadOrder ||
      (sort === modSorts.invalid && activeOrder.size > 0)
    ) {
      const difference = (activeOrder.get(a.id) ?? Infinity) - (activeOrder.get(b.id) ?? Infinity);
      if (difference && !Number.isNaN(difference)) {
        return difference;
      }
    }
    const recencyDifference =
      (sort === modSorts.oldest ? 1 : -1) *
      (modInstalledOrUpdatedAt(a) - modInstalledOrUpdatedAt(b));
    return recencyDifference || compareModIds(a, b);
  });
}

export function subscriptionPanels(
  vault: Pick<ModVault, "localSteamState">,
  mods: Mod[],
  active: ActiveModsState,
  activeEntries: Mod[],
) {
  const live = effectiveSubscribedIds(vault.localSteamState);
  const byWorkshop = new Map(
    mods.filter((mod) => mod.workshopId).map((mod) => [requireValue(mod.workshopId), mod]),
  );
  const installed = new Map(activeEntries.map((mod) => [mod.id, mod]));
  const unsubscribed = mods
    .filter((mod) => !mod.workshopId || !live.has(mod.workshopId))
    .map((mod) => (mod.workshopId && mod.subscribed ? { ...mod, subscribed: false } : mod));
  const subscribed = [...live].map((id) => {
    const mod = byWorkshop.get(id);
    if (mod) {
      return mod.subscribed ? mod : { ...mod, subscribed: true };
    }
    return { ...workshopPlaceholder(id), ...installed.get(`steam-${id}`), subscribed: true };
  });
  const activity = createActivityLookup(active);
  // Saved packages and ModsConfig.xml can retain stale identities after an unsubscribe.
  const activeIds = new Set(
    subscribed.filter((mod) => activity(mod) === modActivities.active).map((mod) => mod.id),
  );
  const activeOrder = new Map(
    activeEntries.flatMap((mod, index) =>
      activeIds.has(mod.id) ? [[mod.id, index + 1] as const] : [],
    ),
  );
  const packageOrder = new Map(
    active.packageIds.map((id, index) => [normalizePackageId(id), index + 1]),
  );
  for (const mod of subscribed) {
    if (!activeIds.has(mod.id) || activeOrder.has(mod.id) || !mod.packageId) {
      continue;
    }
    const position = packageOrder.get(normalizePackageId(mod.packageId));
    if (position !== undefined) {
      activeOrder.set(mod.id, position);
    }
  }
  return { unsubscribed, subscribed, activeIds, activeOrder };
}

/** Partition the complete known mod universe by RimWorld activity, not Steam subscription. */
export function activityPanels(
  vault: Pick<ModVault, "localSteamState">,
  allEntries: readonly Mod[],
  activeEntries: readonly Mod[],
) {
  const live = effectiveSubscribedIds(vault.localSteamState);
  const withSubscription = (mod: Mod): Mod =>
    mod.workshopId && mod.subscribed !== live.has(mod.workshopId)
      ? { ...mod, subscribed: live.has(mod.workshopId) }
      : mod;
  const all = new Map(allEntries.map((mod) => [mod.id, withSubscription(mod)]));
  for (const workshopId of live) {
    const id = `steam-${workshopId}`;
    if (!all.has(id)) {
      all.set(id, workshopPlaceholder(workshopId));
    }
  }
  const activeMods = activeEntries.map((entry) =>
    withSubscription(isOfficialMod(entry) ? entry : (all.get(entry.id) ?? entry)),
  );
  const activeIds = new Set(activeMods.map((mod) => mod.id));
  const inactive = [...all.values()].filter((mod) => !activeIds.has(mod.id));
  const activeOrder = new Map(activeMods.map((mod, index) => [mod.id, index + 1]));
  return { inactive, active: activeMods, activeIds, activeOrder };
}

export function modBatchAvailability(
  mods: Mod[],
  savedIds: ReadonlySet<string>,
  busy: boolean,
  activeIds: ReadonlySet<string> = new Set(),
) {
  const tagsDisabledReason = busy
    ? "An operation is in progress"
    : !mods.length
      ? "No mods selected"
      : mods.some((mod) => !savedIds.has(mod.id))
        ? "Sync Workshop folders to save these mods before editing them"
        : undefined;
  const unsubscribing = mods.some((mod) => mod.subscribed);
  const subscriptionDisabledReason =
    tagsDisabledReason ??
    (mods.some((mod) => !isWorkshopMod(mod))
      ? "Local mods do not have Steam subscriptions"
      : unsubscribing && mods.some((mod) => activeIds.has(mod.id))
        ? "Active mods cannot be unsubscribed"
        : undefined);
  const subscribedRemovalTargets = mods.filter((mod) => mod.subscribed);
  const removalDisabledReason =
    tagsDisabledReason ??
    (subscribedRemovalTargets.some((mod) => !isWorkshopMod(mod))
      ? "Only Workshop mods can be unsubscribed before removal"
      : subscribedRemovalTargets.some((mod) => activeIds.has(mod.id))
        ? "Active mods cannot be unsubscribed"
        : undefined);
  return { tagsDisabledReason, subscriptionDisabledReason, removalDisabledReason };
}
