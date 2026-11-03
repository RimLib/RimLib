import { CircleMinus, FileDown, FileUp, LoaderCircle, RefreshCw, Tags } from "lucide-react";

import { applicationName } from "../../../shared/application";
import { tooltipPlacements } from "../utils/tooltips";
import { TooltipIconButton } from "./common/TooltipIconButton";

const rimLibLogo = new URL("../../../../assets/rimlib-github-avatar.png", import.meta.url).href;

interface AppHeaderProps {
  notice: string;
  workshopError?: string;
  activeError?: string;
  metadataError?: string;
  disabled: boolean;
  loading?: boolean;
  cleanupDisabledReason?: string;
  importDisabledReason?: string;
  exportDisabledReason?: string;
  onOpenSettings: () => void;
  onManageTags: () => void;
  onSync: () => void;
  onUnsubscribeInactive: () => void;
  onImportModList?: () => void;
  onExportModList?: () => void;
}

export function AppHeader({
  notice,
  workshopError,
  activeError,
  metadataError,
  disabled,
  loading = false,
  cleanupDisabledReason,
  importDisabledReason,
  exportDisabledReason,
  onOpenSettings,
  onManageTags,
  onSync,
  onUnsubscribeInactive,
  onImportModList,
  onExportModList,
}: AppHeaderProps) {
  const activeWarning = activeError ?? metadataError;
  const importUnavailable = disabled || Boolean(importDisabledReason);
  const exportUnavailable = disabled || Boolean(exportDisabledReason);
  return (
    <header className="flex min-h-[74px] min-w-0 items-center justify-between gap-6 border-b border-[#242b33] bg-[#12161d] px-[18px] pt-3.5 pb-3">
      <div className="flex min-w-0 flex-1 items-center gap-[13px]">
        <TooltipIconButton
          className="app-logo-button"
          label="Settings"
          placement={tooltipPlacements.bottom}
          onClick={onOpenSettings}
        >
          <img src={rimLibLogo} alt="" aria-hidden />
        </TooltipIconButton>
        <div className="min-w-0 flex-1">
          <h1 className="m-0 truncate text-xl font-[740] tracking-normal text-[#e8edf2]">
            {applicationName}
          </h1>
          <p
            className="mt-0.5 mb-0 flex min-w-0 items-center gap-2 text-[13px] text-[#9aa7b6]"
            title={notice}
            role="status"
          >
            {loading && (
              <span
                className="inline-flex size-3.5 shrink-0 items-center justify-center"
                aria-hidden="true"
              >
                <LoaderCircle
                  className="animate-spin motion-reduce:animate-none"
                  size={14}
                  aria-hidden
                />
              </span>
            )}
            {workshopError && (
              <span className="workshop-status-warning" title={workshopError}>
                Workshop unavailable
              </span>
            )}
            <span className="min-w-0 truncate">{notice}</span>
          </p>
          {activeWarning && (
            <p className="header-active-warning" role="status" title={activeWarning}>
              {activeError
                ? "Active-list changes and auto-sort are unavailable."
                : "Auto-sort is unavailable until installed mod details can be read."}
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2" aria-label="Library actions">
        {onImportModList && (
          <TooltipIconButton
            className={`ghost-action px-3 text-[13px] whitespace-nowrap ${
              importUnavailable ? "action-unavailable" : ""
            }`}
            aria-label="Import mod list"
            aria-disabled={importUnavailable}
            label={importDisabledReason ?? "Import mod list from XML"}
            placement={tooltipPlacements.bottom}
            onClick={importUnavailable ? undefined : onImportModList}
          >
            <FileUp size={18} aria-hidden />
            <span>Import</span>
          </TooltipIconButton>
        )}
        {onExportModList && (
          <TooltipIconButton
            className={`ghost-action px-3 text-[13px] whitespace-nowrap ${
              exportUnavailable ? "action-unavailable" : ""
            }`}
            aria-label="Export mod list"
            aria-disabled={exportUnavailable}
            label={exportDisabledReason ?? "Export current mod list as XML"}
            placement={tooltipPlacements.bottom}
            onClick={exportUnavailable ? undefined : onExportModList}
          >
            <FileDown size={18} aria-hidden />
            <span>Export</span>
          </TooltipIconButton>
        )}
        <TooltipIconButton
          className="ghost-action px-3 text-[13px] whitespace-nowrap"
          label="Manage Tags"
          placement={tooltipPlacements.bottom}
          disabled={disabled}
          onClick={onManageTags}
        >
          <Tags size={18} aria-hidden />
          <span>Manage Tags</span>
        </TooltipIconButton>
        <TooltipIconButton
          className="ghost-action px-3 text-[13px] whitespace-nowrap"
          label="Sync Workshop"
          placement={tooltipPlacements.bottom}
          disabled={disabled}
          onClick={onSync}
        >
          <RefreshCw size={18} aria-hidden />
          <span>Sync Workshop</span>
        </TooltipIconButton>
        <TooltipIconButton
          className="danger-action px-3 text-[13px] whitespace-nowrap"
          aria-label="Unsubscribe all non-active mods"
          label={cleanupDisabledReason ?? "Unsubscribe all non-active mods"}
          placement={tooltipPlacements.bottom}
          disabled={disabled || Boolean(cleanupDisabledReason)}
          onClick={onUnsubscribeInactive}
        >
          <CircleMinus size={18} aria-hidden />
          <span>Unsubscribe inactive</span>
        </TooltipIconButton>
      </div>
    </header>
  );
}
