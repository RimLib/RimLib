import assert from "node:assert/strict";

import type { applyDraftChanges } from "../../src/renderer/src/services/draftActions";
import {
  draftActions,
  type DraftChange,
  type DraftProgress,
} from "../../src/renderer/src/utils/drafts";
import { modSources } from "../../src/shared/domainConstants";
import type { Mod, ModVault } from "../../src/shared/types";
import { requireValue } from "../../src/shared/validation";
import { deleteLibraryModsExplicitly } from "../../src/shared/vault";
import { vaultSchemaVersion } from "../../src/shared/vaultValidation";

export function draftMod(id: string, subscribed = false): Mod {
  return {
    id: `steam-${id}`,
    workshopId: id,
    packageId: `author.mod${id}`,
    name: `Mod ${id}`,
    author: "Author",
    source: modSources.steam,
    summary: "Retained summary",
    tags: [],
    userTagIds: ["qol"],
    gameVersions: [],
    subscribed,
    downloadedAt: "",
    addedAt: "",
    screenshots: [],
    notes: "Retained notes",
  };
}
export function draftHarness(mods = [draftMod("1", true), draftMod("2"), draftMod("3")]) {
  let vault: ModVault = {
    schemaVersion: vaultSchemaVersion,
    mods,
    userTags: [{ id: "qol", name: "QoL", color: "#ffffff" }],
    localSteamState: {
      observedIds: mods.flatMap((mod) => (mod.subscribed ? [requireValue(mod.workshopId)] : [])),
      pending: {},
    },
  };
  const events: string[] = [];
  const completed: string[] = [];
  const progress: DraftProgress[] = [];
  const failures = new Set<string>();
  const store: Parameters<typeof applyDraftChanges>[1] = {
    load: async () => {
      events.push("load");
      return vault;
    },
    previewLibrarySubscriptions: async (action, ids) => {
      events.push(`preview:${action}`);
      return {
        mods: vault.mods.filter((mod) => ids.includes(mod.id)),
        vault,
        activeCount: 0,
      };
    },
    setSubscription: async (id, subscribed, expected) => {
      events.push(`steam:${id}:${String(subscribed)}`);
      const mod = requireValue(vault.mods.find((mod) => mod.id === id));
      assert.equal(expected, mod.workshopId);
      const failed = failures.has(id);
      if (!failed) {
        vault = {
          ...vault,
          mods: vault.mods.map((mod) => (mod.id === id ? { ...mod, subscribed } : mod)),
        };
        vault = {
          ...vault,
          localSteamState: {
            ...vault.localSteamState,
            observedIds: vault.mods.flatMap((mod) =>
              mod.subscribed ? [requireValue(mod.workshopId)] : [],
            ),
          },
        };
      }
      return {
        vault,
        activeMods: { packageIds: [] },
        subscribed: subscribed && !failed ? 1 : 0,
        unsubscribed: !subscribed && !failed ? 1 : 0,
        failures: failed ? ["Simulated Steam failure"] : [],
      };
    },
    deleteLibraryMods: async (ids) => {
      events.push(`delete:${ids.join(",")}`);
      vault = deleteLibraryModsExplicitly(vault, ids);
      return vault;
    },
  };
  const callbacks: Parameters<typeof applyDraftChanges>[2] = {
    progress: (value) => {
      progress.push(value);
    },
    adopt: (value) => {
      vault = value;
    },
    adoptActive: () => undefined,
    complete: (id) => {
      completed.push(id);
    },
  };
  const changes: DraftChange[] = mods.map((mod, index) => ({
    mod,
    action:
      index === 0
        ? draftActions.unsubscribe
        : index === 1
          ? draftActions.subscribe
          : draftActions.remove,
  }));
  return {
    store,
    callbacks,
    changes,
    events,
    completed,
    progress,
    failures,
    vault: () => vault,
    replace: (next: ModVault) => {
      vault = next;
    },
  };
}
