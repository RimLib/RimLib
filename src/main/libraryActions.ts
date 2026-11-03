import { modActivities } from "../shared/domainConstants";
import { createActivityLookup } from "../shared/subscriptions";
import type { ActiveModsState, AppSettings, ModVault } from "../shared/types";
import { deleteLibraryModsExplicitly } from "../shared/vault";
import { getActiveModsView, getInstalledMods } from "./installedMods";
import type { VaultStore } from "./vaultStore";

type ActiveModsReader = (settings?: AppSettings) => Promise<ActiveModsState>;

const readFreshActiveMods: ActiveModsReader = (settings = {}) =>
  getActiveModsView(settings, () => getInstalledMods(settings, true));

async function assertRemovalTargetsInactive(
  vault: ModVault,
  ids: string[],
  readActive: ActiveModsReader,
) {
  // Validate saved identity and subscription state before doing the more expensive active read.
  deleteLibraryModsExplicitly(vault, ids);
  const active = await readActive(vault.settings);
  if (active.error || active.metadataError) {
    throw new Error(
      `Active status could not be verified. No library records were removed. ${active.error ?? active.metadataError}`,
    );
  }
  const activityOf = createActivityLookup(active);
  for (const id of new Set(ids)) {
    const mod = vault.mods.find((entry) => entry.id === id);
    const activity = mod ? activityOf(mod) : modActivities.unknown;
    if (activity === modActivities.active) {
      throw new Error(
        `${mod?.name ?? "This mod"} is Active and cannot be removed from the library.`,
      );
    }
    if (activity !== modActivities.inactive) {
      throw new Error(
        `${mod?.name ?? "This mod"}'s Active status could not be verified. No library records were removed.`,
      );
    }
  }
}

export async function deleteLibraryMods(
  store: VaultStore,
  ids: string[],
  readActive: ActiveModsReader = readFreshActiveMods,
) {
  const vault = await store.load();
  await assertRemovalTargetsInactive(vault, ids, readActive);
  await store.assertUnchanged();
  await store.checkpoint("delete-library-mods");
  // Revalidate membership inside the serialized update in case another action ran meanwhile.
  return store.update((current) => deleteLibraryModsExplicitly(current, ids));
}
