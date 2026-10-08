import { CheckCircle2, FolderCheck, FolderOpen, RefreshCw, Save, X } from "lucide-react";
import type { SyntheticEvent } from "react";

import type { FirebaseSyncSettings } from "../../../../shared/types";
import type { FirebaseSyncStatus } from "../../hooks/useFirebaseSync";
import { tooltipPlacements } from "../../utils/tooltips";
import { TooltipIconButton } from "../common/TooltipIconButton";

interface SettingsModalProps {
  isChoosingPath?: boolean;
  onBrowseConfigPath: () => void;
  onOpenLogs?: () => void;
  onOpenDatabaseFolder?: () => void;
  onClose: () => void;
  onConfigPathChange: (value: string) => void;
  onSubmit: (event: SyntheticEvent) => void;
  configPath: string;
  detectedPath?: string;
  configError?: string;
  workshopPath: string;
  onWorkshopPathChange: (value: string) => void;
  onBrowseWorkshopPath: () => void;
  onDetectWorkshopPath: () => void;
  onTestWorkshopPath: () => void;
  isDetectingPath?: boolean;
  isTestingPath?: boolean;
  workshopAccessPath?: string;
  isSaving?: boolean;
  settingsError?: string;
  firebaseSettings?: FirebaseSyncSettings;
  firebasePassword?: string;
  firebaseStatus?: FirebaseSyncStatus;
  onFirebaseSettingsChange?: (settings: FirebaseSyncSettings) => void;
  onFirebasePasswordChange?: (value: string) => void;
  onFirebaseDisconnect?: () => void;
}

export function SettingsModal({
  isChoosingPath = false,
  onBrowseConfigPath,
  onOpenLogs,
  onOpenDatabaseFolder,
  onClose,
  onConfigPathChange,
  onSubmit,
  configPath,
  detectedPath,
  configError,
  workshopPath,
  onWorkshopPathChange,
  onBrowseWorkshopPath,
  onDetectWorkshopPath,
  onTestWorkshopPath,
  isDetectingPath = false,
  isTestingPath = false,
  workshopAccessPath,
  isSaving = false,
  settingsError,
  firebaseSettings,
  firebasePassword = "",
  firebaseStatus,
  onFirebaseSettingsChange,
  onFirebasePasswordChange,
  onFirebaseDisconnect,
}: SettingsModalProps) {
  const changeFirebase = <Key extends keyof FirebaseSyncSettings>(
    key: Key,
    value: FirebaseSyncSettings[Key],
  ) => {
    if (firebaseSettings) {
      onFirebaseSettingsChange?.({ ...firebaseSettings, [key]: value });
    }
  };

  return (
    <div
      className="modal modal-open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <form className="modal-box app-modal settings-modal" onSubmit={onSubmit}>
        <div className="app-modal-header">
          <h2 id="settings-title">Settings</h2>
          <TooltipIconButton
            className="icon-button"
            label="Close"
            placement={tooltipPlacements.left}
            onClick={onClose}
            disabled={isSaving}
          >
            <X size={17} aria-hidden />
          </TooltipIconButton>
        </div>
        <label className="app-modal-field">
          <span>RimWorld ModsConfig.xml</span>
          <div className="settings-path-row">
            <input
              autoFocus
              value={configPath}
              onChange={(event) => {
                onConfigPathChange(event.target.value);
              }}
              placeholder={detectedPath ?? "Automatic detection"}
              aria-label="RimWorld ModsConfig.xml path"
              disabled={isSaving}
            />
            <button
              className="ghost-action"
              type="button"
              disabled={isChoosingPath || isSaving}
              onClick={onBrowseConfigPath}
            >
              <FolderOpen size={16} aria-hidden />
              Browse
            </button>
          </div>
        </label>
        {configError && (
          <p className="app-inline-error" title={configError} role="alert">
            {configError}
          </p>
        )}
        <div className="app-modal-field">
          <label className="text-xs font-bold text-[#9aa7b6]" htmlFor="workshop-mods-path">
            Workshop mods folder (294100)
          </label>
          <div className="grid grid-cols-[minmax(0,1fr)_38px_38px_38px] gap-2 [&_.tooltip-action]:w-full [&_.icon-button]:h-[38px] [&_.icon-button]:w-full">
            <input
              id="workshop-mods-path"
              value={workshopPath}
              onChange={(event) => {
                onWorkshopPathChange(event.target.value);
              }}
              placeholder={isDetectingPath ? "Detecting Workshop folder..." : "Automatic detection"}
              aria-label="Workshop mods folder path"
              title={workshopPath}
              disabled={isDetectingPath || isTestingPath || isSaving}
            />
            <TooltipIconButton
              label="Browse Workshop folder"
              disabled={isChoosingPath || isDetectingPath || isTestingPath || isSaving}
              onClick={onBrowseWorkshopPath}
            >
              <FolderOpen size={17} aria-hidden />
            </TooltipIconButton>
            <TooltipIconButton
              label="Auto-detect Workshop folder"
              disabled={isChoosingPath || isDetectingPath || isTestingPath || isSaving}
              onClick={onDetectWorkshopPath}
            >
              <RefreshCw size={17} aria-hidden />
            </TooltipIconButton>
            <TooltipIconButton
              label="Test Workshop folder access"
              disabled={
                !workshopPath.trim() ||
                isChoosingPath ||
                isDetectingPath ||
                isTestingPath ||
                isSaving
              }
              onClick={onTestWorkshopPath}
            >
              <FolderCheck size={17} aria-hidden />
            </TooltipIconButton>
          </div>
          {isTestingPath ? (
            <p className="m-0 text-xs text-[#9aa7b6]" role="status">
              Checking folder access...
            </p>
          ) : (
            workshopAccessPath && (
              <p
                className="m-0 flex items-center gap-2 text-xs text-[#8ed49b]"
                role="status"
                title={workshopAccessPath}
              >
                <CheckCircle2 size={15} aria-hidden />
                Folder is readable
              </p>
            )
          )}
        </div>
        {settingsError && (
          <p className="app-inline-error" title={settingsError} role="alert">
            {settingsError}
          </p>
        )}
        {firebaseSettings && (
          <section className="firebase-settings" aria-labelledby="firebase-settings-title">
            <div className="firebase-settings-heading">
              <div>
                <h3 id="firebase-settings-title">Firebase sync (beta)</h3>
                <p>Sync portable mods, notes, and personal tags through your Firebase project.</p>
              </div>
              <label className="firebase-toggle">
                <input
                  className="checkbox checkbox-sm"
                  type="checkbox"
                  checked={firebaseSettings.enabled}
                  disabled={isSaving}
                  onChange={(event) => {
                    changeFirebase("enabled", event.target.checked);
                  }}
                />
                <span>Enabled</span>
              </label>
            </div>
            {firebaseSettings.enabled && (
              <div className="firebase-settings-fields">
                <label className="app-modal-field">
                  <span>Project ID</span>
                  <input
                    value={firebaseSettings.projectId}
                    onChange={(event) => {
                      changeFirebase("projectId", event.target.value);
                    }}
                    autoComplete="off"
                    disabled={isSaving}
                    required
                  />
                </label>
                <label className="app-modal-field">
                  <span>Web API key</span>
                  <input
                    value={firebaseSettings.apiKey}
                    onChange={(event) => {
                      changeFirebase("apiKey", event.target.value);
                    }}
                    autoComplete="off"
                    disabled={isSaving}
                    required
                  />
                </label>
                <label className="app-modal-field">
                  <span>Auth domain</span>
                  <input
                    value={firebaseSettings.authDomain}
                    placeholder="your-project.firebaseapp.com"
                    onChange={(event) => {
                      changeFirebase("authDomain", event.target.value);
                    }}
                    autoComplete="off"
                    disabled={isSaving}
                    required
                  />
                </label>
                <label className="app-modal-field">
                  <span>Web app ID</span>
                  <input
                    value={firebaseSettings.appId}
                    onChange={(event) => {
                      changeFirebase("appId", event.target.value);
                    }}
                    autoComplete="off"
                    disabled={isSaving}
                    required
                  />
                </label>
                <label className="app-modal-field">
                  <span>Firebase account email</span>
                  <input
                    type="email"
                    value={firebaseSettings.email}
                    onChange={(event) => {
                      changeFirebase("email", event.target.value);
                    }}
                    autoComplete="username"
                    disabled={isSaving}
                    required
                  />
                </label>
                <label className="app-modal-field">
                  <span>Password (never saved by RimLib)</span>
                  <input
                    type="password"
                    value={firebasePassword}
                    placeholder="Only needed to connect this device"
                    onChange={(event) => {
                      onFirebasePasswordChange?.(event.target.value);
                    }}
                    autoComplete="current-password"
                    disabled={isSaving}
                  />
                </label>
                <p className="firebase-security-copy">
                  Use Firebase web-app values only. Never paste a service-account key or private
                  key. Device paths and Steam subscription state stay local.
                </p>
                {firebaseStatus && (
                  <div className="firebase-status-row">
                    <p data-phase={firebaseStatus.phase} role="status">
                      {firebaseStatus.message}
                    </p>
                    {onFirebaseDisconnect && firebaseStatus.phase !== "disabled" && (
                      <button
                        className="ghost-action"
                        type="button"
                        disabled={isSaving}
                        onClick={onFirebaseDisconnect}
                      >
                        Sign out
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        )}
        {onOpenDatabaseFolder && (
          <div className="app-modal-field">
            <span>User database</span>
            <button className="ghost-action" type="button" onClick={onOpenDatabaseFolder}>
              <FolderOpen size={16} aria-hidden />
              Open database folder
            </button>
          </div>
        )}
        {onOpenLogs && (
          <div className="app-modal-field">
            <span>Debug logs</span>
            <button className="ghost-action" type="button" onClick={onOpenLogs}>
              <FolderOpen size={16} aria-hidden />
              Open logs
            </button>
          </div>
        )}
        <div className="app-modal-actions">
          <button className="ghost-action" type="button" disabled={isSaving} onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-action"
            type="submit"
            disabled={isDetectingPath || isTestingPath || isChoosingPath || isSaving}
          >
            <Save size={16} aria-hidden />
            {firebaseSettings?.enabled ? "Save and sync" : "Save settings"}
          </button>
        </div>
      </form>
      <button className="modal-backdrop" type="button" disabled={isSaving} onClick={onClose}>
        Close
      </button>
    </div>
  );
}
