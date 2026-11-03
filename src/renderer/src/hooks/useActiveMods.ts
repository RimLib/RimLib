import { useCallback, useEffect, useRef, useState } from "react";

import { withReadTimeout } from "../../../shared/async";
import { defaultReadTimeoutMs, steamLimits } from "../../../shared/limits";
import type { ActiveModsState, AppSettings, InstalledModMetadata } from "../../../shared/types";
import { getStore } from "../services/modStore";
import { uiTimings } from "../utils/uiConstants";

function samePackageIds(first: readonly string[], second: readonly string[]) {
  return (
    first.length === second.length && first.every((packageId, index) => packageId === second[index])
  );
}

function sameActiveState(first: ActiveModsState, second: ActiveModsState) {
  return (
    first.configPath === second.configPath &&
    first.gameVersion === second.gameVersion &&
    first.error === second.error &&
    first.metadataError === second.metadataError &&
    first.installedMods === second.installedMods &&
    samePackageIds(first.packageIds, second.packageIds)
  );
}

function mergeConfiguration(
  previous: ActiveModsState,
  next: ActiveModsState,
  preservePrevious: boolean,
): ActiveModsState {
  const preserveOrder = preservePrevious && Boolean(next.error) && previous.packageIds.length > 0;
  const resolved: ActiveModsState = {
    configPath: next.configPath ?? (preservePrevious ? previous.configPath : undefined),
    gameVersion: preserveOrder ? previous.gameVersion : next.gameVersion,
    packageIds: preserveOrder ? previous.packageIds : next.packageIds,
    // A same-generation inventory read can settle before this configuration read. A settings-key
    // change queued an empty state before either request, so preserving here cannot retain data
    // from the previous path but does prevent the faster result from being erased.
    installedMods: previous.installedMods,
    error: next.error,
    metadataError: next.metadataError ?? previous.metadataError,
  };
  return sameActiveState(previous, resolved) ? previous : resolved;
}

function mergeInstalledMetadata(
  previous: ActiveModsState,
  installedMods: InstalledModMetadata[],
): ActiveModsState {
  const resolved = { ...previous, installedMods, metadataError: undefined };
  return sameActiveState(previous, resolved) ? previous : resolved;
}

export function useActiveMods(settings: AppSettings, enabled: boolean) {
  const [active, setActive] = useState<ActiveModsState>({ packageIds: [] });
  const [loading, setLoading] = useState(true);
  const [metadataLoading, setMetadataLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [checkingConfiguration, setCheckingConfiguration] = useState(false);
  const request = useRef(0);
  const configurationRequest = useRef(0);
  const pending = useRef<number | undefined>(undefined);
  const refreshIndicatorTimer = useRef<number | undefined>(undefined);
  const { rimWorldConfigPath, workshopModsPath } = settings;
  const settingsKey = JSON.stringify([
    rimWorldConfigPath?.trim() ?? "",
    workshopModsPath?.trim() ?? "",
  ]);
  const activeSettingsKey = useRef(settingsKey);

  const clearRefreshIndicator = useCallback(() => {
    if (refreshIndicatorTimer.current !== undefined) {
      window.clearTimeout(refreshIndicatorTimer.current);
      refreshIndicatorTimer.current = undefined;
    }
    setRefreshing(false);
  }, []);

  const adoptActive = useCallback(
    (next: ActiveModsState, preserveInstalled = true) => {
      const hasMetadataResult =
        next.installedMods !== undefined || next.metadataError !== undefined;
      configurationRequest.current++;
      if (hasMetadataResult || !preserveInstalled) {
        request.current++;
        pending.current = undefined;
      }
      clearRefreshIndicator();
      setCheckingConfiguration(false);
      setActive((previous) => {
        const preserveConfiguration =
          preserveInstalled && Boolean(next.error) && previous.packageIds.length > 0;
        const resolved = {
          ...next,
          configPath: next.configPath ?? (preserveConfiguration ? previous.configPath : undefined),
          gameVersion: preserveConfiguration ? previous.gameVersion : next.gameVersion,
          packageIds: preserveConfiguration ? previous.packageIds : next.packageIds,
          installedMods:
            next.installedMods ?? (preserveInstalled ? previous.installedMods : undefined),
          metadataError:
            next.installedMods !== undefined
              ? undefined
              : (next.metadataError ?? (preserveInstalled ? previous.metadataError : undefined)),
        };
        return sameActiveState(previous, resolved) ? previous : resolved;
      });
      setLoading(false);
      if (hasMetadataResult || !preserveInstalled) {
        setMetadataLoading(false);
      }
    },
    [clearRefreshIndicator],
  );

  const refresh = useCallback(
    (showLoading = true, refreshMetadata = showLoading, forceMetadata = false) => {
      if (!enabled) {
        return;
      }
      if (pending.current !== undefined && !showLoading && !forceMetadata) {
        return;
      }
      const sequence = ++request.current;
      const configurationSequence = ++configurationRequest.current;
      setCheckingConfiguration(true);
      const preservePrevious = activeSettingsKey.current === settingsKey;
      activeSettingsKey.current = settingsKey;
      if (!preservePrevious) {
        setActive({ packageIds: [] });
      }
      if (showLoading) {
        clearRefreshIndicator();
        setLoading(true);
      } else {
        refreshIndicatorTimer.current = window.setTimeout(() => {
          if (sequence === request.current) {
            setRefreshing(true);
          }
        }, uiTimings.loadingIndicatorDelayMs);
      }
      if (refreshMetadata) {
        setMetadataLoading(true);
      }
      pending.current = sequence;

      let remaining = 1 + Number(refreshMetadata);
      const complete = () => {
        remaining--;
        if (remaining === 0 && pending.current === sequence) {
          pending.current = undefined;
        }
      };
      const requestedSettings = { rimWorldConfigPath, workshopModsPath };
      const configuration = withReadTimeout(
        getStore().getActiveModConfiguration(requestedSettings),
        "Active mod lookup is not responding. Check the drive and paths in Settings.",
        steamLimits.activeMetadataTimeoutMs,
      ).catch((error: unknown): ActiveModsState => ({
        configPath: rimWorldConfigPath,
        packageIds: [],
        error: String(error),
      }));

      // ModsConfig.xml is small. Publish its authoritative package order without waiting for the
      // much larger installed-mod scan so saved rows/placeholders can render immediately.
      void configuration
        .then((next) => {
          if (
            sequence !== request.current ||
            configurationSequence !== configurationRequest.current
          ) {
            return;
          }
          setActive((previous) => mergeConfiguration(previous, next, preservePrevious));
          setLoading(false);
          clearRefreshIndicator();
        })
        .finally(() => {
          if (
            sequence === request.current &&
            configurationSequence === configurationRequest.current
          ) {
            setCheckingConfiguration(false);
          }
          complete();
        });

      if (refreshMetadata) {
        void withReadTimeout(
          getStore().getInstalledMods(requestedSettings, forceMetadata),
          "Installed mod details are taking too long to load. Check the Workshop drive and path in Settings.",
          steamLimits.activeMetadataTimeoutMs + defaultReadTimeoutMs,
        )
          .then((installedMods) => {
            if (sequence !== request.current) {
              return;
            }
            setActive((previous) => mergeInstalledMetadata(previous, installedMods));
          })
          .catch((error: unknown) => {
            if (sequence !== request.current) {
              return;
            }
            setActive((previous) => ({
              ...previous,
              metadataError: `Installed mod metadata is unavailable. ${String(error)}`,
            }));
          })
          .finally(() => {
            if (sequence === request.current) {
              setMetadataLoading(false);
            }
            complete();
          });
      }
    },
    [clearRefreshIndicator, enabled, rimWorldConfigPath, settingsKey, workshopModsPath],
  );

  const invalidate = useCallback(() => {
    request.current++;
    configurationRequest.current++;
    pending.current = undefined;
    setCheckingConfiguration(false);
    if (refreshIndicatorTimer.current !== undefined) {
      window.clearTimeout(refreshIndicatorTimer.current);
      refreshIndicatorTimer.current = undefined;
    }
  }, []);
  useEffect(() => {
    if (!enabled) {
      return;
    }
    refresh();
    return invalidate;
  }, [enabled, refresh, invalidate]);

  return {
    active,
    loading,
    metadataLoading,
    refreshing,
    checkingConfiguration,
    refresh,
    adoptActive,
  };
}
