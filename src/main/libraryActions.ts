import { deleteLibraryModsExplicitly } from "../shared/vault";
import type { VaultStore } from "./vaultStore";

export async function deleteLibraryMods(store: VaultStore, ids: string[]) {
  const vault = await store.load();
  deleteLibraryModsExplicitly(vault, ids);
  await store.assertUnchanged();
  await store.checkpoint("delete-library-mods");
  // Revalidate membership inside the serialized update in case another action ran meanwhile.
  return store.update((current) => deleteLibraryModsExplicitly(current, ids));
}
