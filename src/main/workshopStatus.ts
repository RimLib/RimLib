import { isAbsolute, relative, sep } from "node:path";

import { subscriptionCommands } from "../shared/domainConstants";
import type { ModVault } from "../shared/types";
import { requireValue } from "../shared/validation";
import { effectiveSubscribedIds } from "../shared/vault";
import type { WorkshopFolderDiscovery } from "./steamWorkshop";

function contains(library: string, path: string) {
  const child = relative(library, path);
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

export function workshopFolderStatus(vault: ModVault, discovery: WorkshopFolderDiscovery) {
  const installed = new Set(discovery.folders.map((folder) => folder.workshopId));
  const observed = new Set(installed);
  const mods = new Map(
    vault.mods.filter((mod) => mod.workshopId).map((mod) => [requireValue(mod.workshopId), mod]),
  );
  const available = (id: string) => {
    if (!discovery.unavailableLibraryPaths.length) {
      return true;
    }
    const path = mods.get(id)?.localPath;
    return Boolean(
      path &&
      discovery.scannedLibraryPaths.some((library) => contains(library, path)) &&
      !discovery.unavailableLibraryPaths.some((library) => contains(library, path)),
    );
  };
  // Absence is trustworthy only for libraries that were actually read.
  for (const id of vault.localSteamState.observedIds) {
    if (!available(id)) {
      observed.add(id);
    }
  }
  const pending = { ...vault.localSteamState.pending };
  for (const [id, command] of Object.entries(pending)) {
    const subscribed = command === subscriptionCommands.subscribe;
    if (installed.has(id) === subscribed && (subscribed || available(id))) {
      Reflect.deleteProperty(pending, id);
    }
  }
  const observedIds = [...observed];
  const effectiveIds = [
    ...effectiveSubscribedIds({ ...vault.localSteamState, observedIds, pending }),
  ];
  return { observedIds, pending, effectiveIds };
}
