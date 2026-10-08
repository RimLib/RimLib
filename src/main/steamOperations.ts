import { withReadTimeout } from "../shared/async";
import {
  hasConstantValue,
  modActivities,
  steamStatusSources,
  subscriptionActions,
  subscriptionCommands,
} from "../shared/domainConstants";
import { steamLimits } from "../shared/limits";
import {
  createActivityLookup,
  getModActivity,
  isWorkshopMod,
  workshopPlaceholder,
} from "../shared/subscriptions";
import type {
  ActiveModsState,
  LocalSteamState,
  Mod,
  ModVault,
  SteamOperationProgress,
  SteamOperationResult,
  SubscriptionAction,
  SubscriptionCheck,
  WorkshopStatusSnapshot,
} from "../shared/types";
import { requireValue } from "../shared/validation";
import { effectiveSubscribedIds, mergeSteamSync, reconcileLocalSteamState } from "../shared/vault";
import { getActiveModsView } from "./installedMods";
import { log } from "./logging";
import { assertGameClosed, type getActiveMods } from "./rimWorldConfig";
import {
  getSteamClient,
  type SteamClient,
  SteamRequestTimeoutError,
  withTimeout,
} from "./steamClient";
import {
  discoverWorkshopFolders,
  importInstalledSteamMods,
  readAboutXml,
  type WorkshopFolderDiscovery,
} from "./steamWorkshop";
import type { VaultStore } from "./vaultStore";
import { workshopFolderStatus } from "./workshopStatus";

type SteamOperationState =
  | { phase: "idle" }
  | { phase: "running"; token: symbol }
  | {
      phase: "indeterminate" | "reconciling" | "reconciliation-failed";
      token: symbol;
      settlement: Promise<void>;
      foregroundFinished: boolean;
      reconciliationFinished: boolean;
    };

export class SteamOperations {
  private operationState: SteamOperationState = { phase: "idle" };
  private dependencies;
  constructor(
    private store: VaultStore,
    private progress: (value: SteamOperationProgress) => void,
    private connect: () => SteamClient = getSteamClient,
    dependencies: Partial<{
      discover: typeof discoverWorkshopFolders;
      importMods: typeof importInstalledSteamMods;
      activeMods: typeof getActiveMods;
      assertClosed: typeof assertGameClosed;
      about: typeof readAboutXml;
      subscriptionTimeoutMs: number;
    }> = {},
  ) {
    this.dependencies = {
      discover: discoverWorkshopFolders,
      importMods: importInstalledSteamMods,
      activeMods: getActiveModsView,
      assertClosed: assertGameClosed,
      about: readAboutXml,
      subscriptionTimeoutMs: steamLimits.subscriptionTimeoutMs,
      ...dependencies,
    };
  }

  private async exclusive<T>(
    operation: (client: SteamClient) => Promise<T>,
    forceRefresh = true,
  ): Promise<T> {
    return this.exclusiveLocal(async () => {
      const client = this.connect();
      await client.refreshSubscribedIds(this.progress, forceRefresh);
      return operation(client);
    });
  }

  private async exclusiveLocal<T>(operation: () => Promise<T>): Promise<T> {
    if (this.operationState.phase !== "idle") {
      throw new Error(
        this.operationState.phase === "reconciliation-failed"
          ? "A timed-out Steam request could not be reconciled. Restart the app before changing subscriptions again."
          : "Another Steam operation is already running.",
      );
    }
    const token = Symbol("steam-operation");
    this.operationState = { phase: "running", token };
    try {
      return await operation();
    } finally {
      this.finishForegroundOperation(token);
    }
  }

  private finishForegroundOperation(token: symbol) {
    const state = this.operationState;
    if (state.phase === "idle" || state.token !== token) {
      return;
    }
    if (state.phase === "running" || state.reconciliationFinished) {
      this.operationState = { phase: "idle" };
      return;
    }
    this.operationState = { ...state, foregroundFinished: true };
  }

  private retainTimedOutMutation(
    client: SteamClient,
    workshopId: string,
    settlement: Promise<void>,
  ) {
    const state = this.operationState;
    if (state.phase !== "running") {
      throw new Error("Steam operation state changed unexpectedly while handling a timeout.");
    }
    const retained: SteamOperationState = {
      phase: "indeterminate",
      token: state.token,
      settlement,
      foregroundFinished: false,
      reconciliationFinished: false,
    };
    this.operationState = retained;
    void this.reconcileTimedOutMutation(retained.token, client, workshopId, settlement);
  }

  private async reconcileTimedOutMutation(
    token: symbol,
    client: SteamClient,
    workshopId: string,
    settlement: Promise<void>,
  ) {
    const settlementResult = await settlement.then(
      () => ({ status: "fulfilled" as const }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    if (settlementResult.status === "rejected") {
      log.warn("steam.mutation.late-settlement-failed", {
        workshopId,
        error: settlementResult.error,
      });
    } else {
      log.info("steam.mutation.late-settlement-completed", { workshopId });
    }
    const waiting = this.operationState;
    if (waiting.phase !== "indeterminate" || waiting.token !== token) {
      return;
    }
    this.operationState = { ...waiting, phase: "reconciling" };
    let subscribed: boolean;
    let vault: ModVault;
    try {
      const live = await client.refreshSubscribedIds((value) => {
        this.reportReconciliationProgress(value);
      }, true);
      subscribed = live.includes(workshopId);
      vault = await this.recordSubscriptions(client, new Map([[workshopId, subscribed]]));
    } catch (error) {
      log.error("steam.mutation.reconciliation-failed", { workshopId, error });
      const current = this.operationState;
      if (current.phase === "reconciling" && current.token === token) {
        this.operationState = { ...current, phase: "reconciliation-failed" };
      }
      return;
    }
    this.finishReconciliation(token);
    this.reportReconciliationProgress({
      message: "Timed-out Steam request reconciled",
      completed: 1,
      total: 1,
      vault,
    });
    log.info("steam.mutation.reconciled", { workshopId, subscribed });
  }

  private reportReconciliationProgress(value: SteamOperationProgress) {
    try {
      this.progress(value);
    } catch (error) {
      log.warn("steam.mutation.reconciliation-progress-failed", { error });
    }
  }

  private finishReconciliation(token: symbol) {
    const state = this.operationState;
    if (state.phase !== "reconciling" || state.token !== token) {
      return;
    }
    if (state.foregroundFinished) {
      this.operationState = { phase: "idle" };
      return;
    }
    this.operationState = { ...state, reconciliationFinished: true };
  }

  private async sync(): Promise<{ vault: ModVault; warnings: string[] }> {
    const discovery = await this.dependencies.discover(
      undefined,
      (await this.store.load()).settings,
    );
    await this.store.checkpoint("steam-sync");
    const status = await this.recordDiscovery(discovery);
    this.progress({
      message: "Workshop folders scanned; refreshing metadata...",
      completed: 0,
      total: 1,
      vault: status,
    });
    const imported = await this.dependencies.importMods(discovery, this.progress);
    const latest = await this.dependencies.discover(undefined, (await this.store.load()).settings);
    const vault = await this.store.update((current) => {
      const { observedIds, pending, effectiveIds } = workshopFolderStatus(current, latest);
      return {
        ...mergeSteamSync(current, { ...imported, subscribedIds: effectiveIds }),
        localSteamState: {
          source: steamStatusSources.workshopFolders,
          observedIds,
          observedAt: new Date().toISOString(),
          pending,
        },
      };
    });
    this.progress({ message: "Workshop folders synchronized", completed: 1, total: 1 });
    const warnings = [...new Set([...discovery.warnings, ...latest.warnings])];
    if (imported.warnings.some((warning) => !discovery.warnings.includes(warning))) {
      warnings.push(
        "Some Workshop metadata could not be refreshed. Existing metadata was preserved.",
      );
    }
    return { vault, warnings };
  }

  private async result(
    vault: ModVault,
    subscribed = 0,
    unsubscribed = 0,
    failures: string[] = [],
    warnings: string[] = [],
  ): Promise<SteamOperationResult> {
    if (failures.length) {
      log.warn("steam.operation.completed-with-failures", { subscribed, unsubscribed, failures });
    } else if (warnings.length) {
      log.warn("steam.operation.completed-with-warnings", { subscribed, unsubscribed, warnings });
    } else {
      log.info("steam.operation.completed", {
        subscribed,
        unsubscribed,
        savedCount: vault.mods.length,
        subscriptionCount: effectiveSubscribedIds(vault.localSteamState).size,
      });
    }
    return {
      vault,
      subscribed,
      unsubscribed,
      failures,
      warnings,
      activeMods: await this.dependencies.activeMods(vault.settings),
    };
  }

  syncSubscribedMods(): Promise<SteamOperationResult> {
    return this.exclusiveLocal(async () => {
      const { vault, warnings } = await this.sync();
      return this.result(vault, 0, 0, [], warnings);
    });
  }

  refreshSubscriptions(): Promise<SteamOperationResult> {
    return this.exclusiveLocal(async () => {
      const discovery = await this.dependencies.discover(
        undefined,
        (await this.store.load()).settings,
      );
      return this.result(await this.recordDiscovery(discovery), 0, 0, [], discovery.warnings);
    });
  }

  async inspectWorkshopStatus(): Promise<WorkshopStatusSnapshot> {
    const current = await this.store.load();
    const discovery = await withReadTimeout(
      this.dependencies.discover(undefined, current.settings),
      "Checking Workshop folders timed out. Saved mod status was preserved.",
    );
    const { observedIds, pending } = workshopFolderStatus(current, discovery);
    return {
      revision: current.revision,
      workshopModsPath: current.settings?.workshopModsPath,
      observedIds,
      observedAt: new Date().toISOString(),
      pending,
      warnings: discovery.warnings,
    };
  }

  private async recordDiscovery(discovery: WorkshopFolderDiscovery): Promise<ModVault> {
    const current = await this.store.load();
    const { observedIds, pending } = workshopFolderStatus(current, discovery);
    const nextState = {
      source: steamStatusSources.workshopFolders,
      observedIds,
      observedAt: new Date().toISOString(),
      pending,
    } satisfies LocalSteamState;
    if (reconcileLocalSteamState(current, nextState) === current) {
      return current;
    }
    log.info("workshop.discovery.persisting", {
      presentCount: observedIds.length,
      savedCount: current.mods.length,
      pendingActionCount: Object.keys(pending).length,
    });
    return this.store.update((vault) => reconcileLocalSteamState(vault, nextState));
  }

  private async changeSubscription(client: SteamClient, id: string, subscribed: boolean) {
    // Recheck protection immediately before every destructive Steam call.
    if (!subscribed) {
      await this.assertCanUnsubscribe(client, id);
    }
    const settlement = subscribed ? client.subscribe(id) : client.unsubscribe(id);
    try {
      await withTimeout(settlement, this.dependencies.subscriptionTimeoutMs);
    } catch (error) {
      if (error instanceof SteamRequestTimeoutError) {
        this.retainTimedOutMutation(client, id, settlement);
      }
      throw error;
    }
  }

  private async assertCanUnsubscribe(client: SteamClient, id: string) {
    const vault = await this.store.load();
    const saved = vault.mods.find((mod) => mod.workshopId === id);
    const entry = await this.installedMetadata(
      client,
      saved ? { ...saved, subscribed: true } : workshopPlaceholder(id),
    );
    await this.dependencies.assertClosed();
    const active = await withReadTimeout(
      this.dependencies.activeMods(vault.settings),
      "Checking Active mods timed out. Unsubscribe is disabled.",
      steamLimits.activeMetadataTimeoutMs,
    );
    this.assertActivityReadable(active);
    const activity = getModActivity(entry, active);
    if (activity === modActivities.active) {
      throw new Error("Active mods cannot be unsubscribed. Disable the mod in RimWorld first.");
    }
    if (activity !== modActivities.inactive) {
      throw new Error(
        "This mod's Active status could not be verified. No unsubscribe was performed.",
      );
    }
    await this.store.assertUnchanged();
  }

  private assertActivityReadable(active: ActiveModsState) {
    if (active.error || active.metadataError) {
      throw new Error(
        `Active status could not be verified. Unsubscribe is disabled. ${active.error ?? active.metadataError}`,
      );
    }
  }

  private async installedMetadata(client: SteamClient, mod: Mod): Promise<Mod> {
    const path = client.installPath(requireValue(mod.workshopId));
    if (!path) {
      return { ...mod, packageId: undefined };
    }
    try {
      const metadata = await withReadTimeout(
        this.dependencies.about(path),
        "Reading installed mod metadata timed out. Unsubscribe is disabled.",
      );
      return {
        ...mod,
        ...Object.fromEntries(
          Object.entries(metadata).filter(
            ([key, value]: [string, unknown]) => value !== undefined && key !== "userTagIds",
          ),
        ),
        packageId: metadata.packageId,
      };
    } catch (error) {
      log.warn("steam.installed-metadata.failed", { workshopId: mod.workshopId, path, error });
      return { ...mod, packageId: undefined };
    }
  }

  previewLibrarySubscriptions(
    action: SubscriptionAction,
    modIds: string[],
  ): Promise<SubscriptionCheck> {
    return this.exclusive(async (client) => {
      if (
        !hasConstantValue(subscriptionActions, action) ||
        !Array.isArray(modIds) ||
        !modIds.length ||
        modIds.some((id) => typeof id !== "string")
      ) {
        throw new Error("Invalid subscription request.");
      }
      if (action !== subscriptionActions.subscribeMods) {
        await this.dependencies.assertClosed();
      }
      const current = await this.store.load();
      const active = await this.dependencies.activeMods(current.settings);
      if (action !== subscriptionActions.subscribeMods) {
        this.assertActivityReadable(active);
      }
      const activityOf = createActivityLookup(active);
      const live = new Set(client.subscribedIds());
      if ([...live].some((id) => !/^\d+$/.test(id))) {
        throw new Error("Steam returned invalid Workshop ids. No subscriptions were changed.");
      }
      const byId = new Map(current.mods.map((mod) => [mod.id, mod]));
      const requested = [...new Set(modIds)].map((id) => {
        const mod = byId.get(id);
        if (!mod || !isWorkshopMod(mod)) {
          throw new Error(
            "A requested mod is no longer saved or has no valid Workshop id. Review your selection.",
          );
        }
        return mod;
      });
      const targets = requested.filter((mod) =>
        action === subscriptionActions.subscribeMods
          ? !live.has(requireValue(mod.workshopId))
          : live.has(requireValue(mod.workshopId)),
      );
      const mods: Mod[] = [];
      let activeCount = 0;
      const seen = new Set<string>();
      for (const mod of targets) {
        if (seen.has(requireValue(mod.workshopId))) {
          continue;
        }
        seen.add(requireValue(mod.workshopId));
        const entry =
          action === subscriptionActions.subscribeMods
            ? mod
            : await this.installedMetadata(client, mod);
        const activity = activityOf(entry);
        if (action === subscriptionActions.unsubscribeMods && activity !== modActivities.inactive) {
          throw new Error(
            activity === modActivities.active
              ? "Active mods cannot be unsubscribed. Remove Active mods from your selection."
              : "This mod's Active status could not be verified. No unsubscribe was performed.",
          );
        }
        if (activity === modActivities.active) {
          activeCount++;
        }
        mods.push({ ...entry, subscribed: live.has(requireValue(mod.workshopId)) });
      }
      const vault = await this.recordSubscriptions(client);
      const check: SubscriptionCheck = {
        vault,
        mods,
        activeCount,
        activeError: active.error ?? active.metadataError,
      };
      log.info("steam.preflight.completed", {
        action,
        targetCount: mods.length,
        activeCount,
        activeError: check.activeError,
      });
      return check;
    });
  }

  private async recordSubscriptions(
    client: SteamClient,
    confirmedSubscriptions: ReadonlyMap<string, boolean> = new Map(),
  ): Promise<ModVault> {
    const live = client.subscribedIds();
    if (live.some((id) => !/^\d+$/.test(id))) {
      throw new Error("Steam returned invalid Workshop ids. The library was preserved.");
    }
    const current = await this.store.load();
    // Folder discovery remains the view's source; only confirmed actions override it.
    const folderBased = current.localSteamState.source === steamStatusSources.workshopFolders;
    const pending = { ...current.localSteamState.pending };
    const observed = new Set(current.localSteamState.observedIds);
    for (const [id, present] of confirmedSubscriptions) {
      if (observed.has(id) === present) {
        Reflect.deleteProperty(pending, id);
      } else {
        pending[id] = present ? subscriptionCommands.subscribe : subscriptionCommands.unsubscribe;
      }
    }
    const localSteamState: LocalSteamState = folderBased
      ? { ...current.localSteamState, pending }
      : {
          ...(current.localSteamState.source === undefined
            ? {}
            : { source: steamStatusSources.steamClient }),
          observedIds: live,
          observedAt: new Date().toISOString(),
          pending: {},
        };
    const subscribed = effectiveSubscribedIds(localSteamState);
    if (reconcileLocalSteamState(current, localSteamState) === current) {
      return current;
    }
    const changed = current.mods.filter(
      (mod) => mod.workshopId && mod.subscribed !== subscribed.has(mod.workshopId),
    );
    log.info("steam.subscriptions.persisting", {
      subscriptionCount: subscribed.size,
      savedCount: current.mods.length,
      changedFlagCount: changed.length,
    });
    for (const mod of changed) {
      log.debug("steam.mod.status.changed", {
        workshopId: mod.workshopId,
        previous: mod.subscribed,
        subscribed: subscribed.has(requireValue(mod.workshopId)),
      });
    }
    return this.store.update((vault) => reconcileLocalSteamState(vault, localSteamState));
  }

  setSubscription(
    modId: string,
    subscribed: boolean,
    expectedWorkshopId?: string,
  ): Promise<SteamOperationResult> {
    return this.exclusive(async (client) => {
      if (typeof subscribed !== "boolean") {
        throw new Error("Invalid subscription state.");
      }
      const vault = await this.store.load();
      const mod = vault.mods.find((entry) => entry.id === modId);
      if (!mod?.workshopId || !/^\d+$/.test(mod.workshopId)) {
        throw new Error("This saved mod has no valid Workshop id.");
      }
      if (expectedWorkshopId !== undefined && mod.workshopId !== expectedWorkshopId) {
        throw new Error(
          "The draft's Workshop identity changed. Review the pending changes; no subscription was changed.",
        );
      }
      await this.store.assertUnchanged();
      if (client.subscribedIds().includes(mod.workshopId) === subscribed) {
        return this.result(
          await this.recordSubscriptions(client, new Map([[mod.workshopId, subscribed]])),
        );
      }
      if (!subscribed) {
        await this.assertCanUnsubscribe(client, mod.workshopId);
      }
      await this.store.checkpoint(
        subscribed ? subscriptionCommands.subscribe : subscriptionCommands.unsubscribe,
      );
      this.progress({
        message: `${subscribed ? "Subscribing" : "Unsubscribing"} ${mod.name}`,
        completed: 0,
        total: 1,
      });
      const failures: string[] = [];
      try {
        await this.changeSubscription(client, mod.workshopId, subscribed);
      } catch (error) {
        failures.push((error as Error).message);
      }
      return this.result(
        await this.recordSubscriptions(
          client,
          failures.length ? undefined : new Map([[mod.workshopId, subscribed]]),
        ),
        subscribed && !failures.length ? 1 : 0,
        !subscribed && !failures.length ? 1 : 0,
        failures,
      );
    }, false);
  }
}
