import { AlertTriangle, Check, CopyCheck, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { importChoiceReasons, type ModListImportPlan } from "../../utils/modListImport";
import { TooltipIconButton } from "../common/TooltipIconButton";

export interface ImportModListModalProps {
  plan: ModListImportPlan;
  disabled?: boolean;
  confirmDisabledReason?: string;
  onClose: () => void;
  onConfirm: () => void;
}

function sourceLabel(source: ModListImportPlan["targetMods"][number]["source"]): string {
  switch (source) {
    case "local":
      return "local";
    case "manual":
      return "manual";
    case "steam":
      return "Workshop";
  }
}

function duplicateReason(choice: ModListImportPlan["duplicateChoices"][number]): string {
  switch (choice.reason) {
    case importChoiceReasons.steamHint:
      return "the _steam suffix prefers a Workshop copy";
    case importChoiceReasons.nonSteamHint:
      return "the bare package ID prefers a local or manual copy";
    case importChoiceReasons.currentActive:
      return "the currently Active copy is preserved";
    case importChoiceReasons.sourcePriority:
      return "the deterministic source priority was used";
  }
}

export function ImportModListModal({
  plan,
  disabled = false,
  confirmDisabledReason,
  onClose,
  onConfirm,
}: ImportModListModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null),
  );
  useEffect(() => {
    const returnFocus = returnFocusRef.current;
    return () => {
      if (returnFocus?.isConnected) {
        returnFocus.focus();
      }
    };
  }, []);
  const availableCount = plan.targetMods.length;
  const missingCount = plan.missingPackageIds.length;
  const deactivationCount = plan.deactivatedMods.length;
  const confirmLabel = missingCount
    ? "Stage " +
      availableCount.toString() +
      " available " +
      (availableCount === 1 ? "mod" : "mods") +
      " only"
    : "Stage " + availableCount.toString() + " " + (availableCount === 1 ? "mod" : "mods");
  return (
    <div
      ref={dialogRef}
      className="modal modal-open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-mod-list-title"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !disabled) {
          event.preventDefault();
          onClose();
          return;
        }
        if (event.key !== "Tab") {
          return;
        }
        const focusable = [
          ...(dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ) ?? []),
        ].filter((element) => !element.hidden && element.tabIndex >= 0);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) {
          event.preventDefault();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <div className="modal-box app-modal max-h-[calc(100vh-64px)] w-[min(620px,calc(100vw-40px))] overflow-y-auto">
        <div className="app-modal-header">
          <h2 id="import-mod-list-title">Load RimWorld mod list</h2>
          <TooltipIconButton label="Close" disabled={disabled} onClick={onClose}>
            <X size={17} aria-hidden />
          </TooltipIconButton>
        </div>

        <p className="app-modal-copy">
          Review <strong>{plan.file.fileName}</strong> before replacing the pending Active list.
          Nothing changes in RimWorld until you apply the staged draft.
        </p>

        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 rounded-md border border-[#303a45] bg-[#121820] p-2.5 text-[13px]">
          <dt className="text-[#91a0b1]">Exported game</dt>
          <dd className="m-0 text-right text-[#e8edf2]">
            {plan.file.gameVersion ?? "Not specified"}
          </dd>
          <dt className="text-[#91a0b1]">Available in RimLib</dt>
          <dd className="m-0 text-right text-[#e8edf2]">{availableCount}</dd>
          <dt className="text-[#91a0b1]">Unavailable</dt>
          <dd className="m-0 text-right text-[#e8edf2]">{missingCount}</dd>
          <dt className="text-[#91a0b1]">Current mods to deactivate</dt>
          <dd className="m-0 text-right text-[#e8edf2]">{deactivationCount}</dd>
        </dl>

        {plan.versionMismatch && (
          <p
            className="m-0 flex items-start gap-2 rounded-md border border-[#80652f] bg-[#2c2618] px-2.5 py-2 text-xs text-[#f0c777]"
            role="status"
          >
            <AlertTriangle className="mt-0.5 shrink-0" size={16} aria-hidden />
            <span>
              This list targets RimWorld {plan.versionMismatch.importedVersion}; your current
              configuration is {plan.versionMismatch.currentVersion}. You can still stage it, but
              compatibility may differ.
            </span>
          </p>
        )}

        {missingCount > 0 && (
          <section className="grid min-w-0 gap-1.5" aria-labelledby="missing-import-mods-title">
            <h3 className="m-0 text-[13px] font-bold text-[#f0c777]" id="missing-import-mods-title">
              {missingCount} unavailable {missingCount === 1 ? "package" : "packages"}
            </h3>
            <p className="app-modal-copy">
              RimLib will not subscribe, download, or invent these packages. If you continue, they
              are omitted and only the available mods are staged.
            </p>
            <ul
              className="m-0 grid max-h-[min(240px,32vh)] list-none gap-1 overflow-auto rounded-md border border-[#594d31] bg-[#181711] p-2"
              aria-label="Unavailable package IDs"
            >
              {plan.missingPackageIds.map((packageId) => (
                <li className="min-w-0" key={packageId}>
                  <code className="break-all text-xs text-[#f0c777]">{packageId}</code>
                </li>
              ))}
            </ul>
          </section>
        )}

        {plan.duplicateChoices.length > 0 && (
          <section className="grid min-w-0 gap-1.5" aria-labelledby="duplicate-import-mods-title">
            <h3
              className="m-0 flex items-center gap-1.5 text-[13px] font-bold text-[#c7d1dd]"
              id="duplicate-import-mods-title"
            >
              <CopyCheck size={15} aria-hidden />
              Duplicate physical copies resolved
            </h3>
            <p className="app-modal-copy">
              {plan.duplicateChoices.length} imported{" "}
              {plan.duplicateChoices.length === 1 ? "package matches" : "packages match"} more than
              one known copy. The selected copies are shown below.
            </p>
            <ul
              className="m-0 grid max-h-[min(200px,28vh)] list-none gap-1 overflow-auto rounded-md border border-[#303a45] bg-[#121820] p-2"
              aria-label="Resolved duplicate package copies"
            >
              {plan.duplicateChoices.map((choice) => (
                <li className="min-w-0 text-xs text-[#91a0b1]" key={choice.normalizedPackageId}>
                  <code className="break-all text-[#c7d1dd]">{choice.packageId}</code>: using{" "}
                  <strong className="text-[#e8edf2]">{choice.selected.name}</strong> (
                  {sourceLabel(choice.selected.source)}); {duplicateReason(choice)}.{" "}
                  {choice.candidates.length} copies found.
                </li>
              ))}
            </ul>
          </section>
        )}

        {confirmDisabledReason && (
          <p className="app-modal-copy text-[#f0c777]" role="status">
            {confirmDisabledReason}
          </p>
        )}

        <div className="app-modal-actions">
          <button
            className="ghost-action"
            type="button"
            disabled={disabled}
            onClick={onClose}
            autoFocus
          >
            Cancel
          </button>
          <button
            className="primary-action"
            type="button"
            disabled={disabled || Boolean(confirmDisabledReason) || availableCount === 0}
            onClick={() => {
              if (!disabled && !confirmDisabledReason && availableCount > 0) {
                onConfirm();
              }
            }}
          >
            <Check size={16} aria-hidden />
            {confirmLabel}
          </button>
        </div>
      </div>
      <button
        className="modal-backdrop"
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={onClose}
      >
        Close
      </button>
    </div>
  );
}
