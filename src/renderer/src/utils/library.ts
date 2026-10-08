import { modActivities, steamStatusSources } from "../../../shared/domainConstants";
import { normalizePackageId } from "../../../shared/packages";
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
import { type ModSort, modSorts, type SearchScope, searchScopes } from "./uiConstants";

export type { ModSort } from "./uiConstants";

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
    if (sort === modSorts.active) {
      const difference = (activeOrder.get(a.id) ?? Infinity) - (activeOrder.get(b.id) ?? Infinity);
      if (difference && !Number.isNaN(difference)) {
        return difference;
      }
    }
    return (
      (sort === modSorts.oldest ? 1 : -1) *
      ((Date.parse(a.downloadedAt) || 0) - (Date.parse(b.downloadedAt) || 0))
    );
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

export function modBatchAvailability(
  mods: Mod[],
  savedIds: ReadonlySet<string>,
  busy: boolean,
  subscriptionDisabled: boolean,
  subscriptionReason?: string,
  activeIds: ReadonlySet<string> = new Set(),
  activeError?: string,
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
        : unsubscribing && activeError
          ? "Active status could not be verified. Unsubscribe is disabled."
          : subscriptionDisabled
            ? (subscriptionReason ?? "Subscription changes are unavailable")
            : undefined);
  const removalDisabledReason =
    tagsDisabledReason ??
    (unsubscribing ? "Unsubscribe these mods before removing them from the library" : undefined);
  return { tagsDisabledReason, subscriptionDisabledReason, removalDisabledReason };
}
