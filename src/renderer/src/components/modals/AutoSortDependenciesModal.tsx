import { AlertTriangle, CheckCircle2, CircleHelp, Sparkles, X } from "lucide-react";

import type { Mod } from "../../../../shared/types";
import {
  type AutoSortDependencyEntry,
  type AutoSortDependencyPlan,
  autoSortDependencyStatuses,
} from "../../utils/autoSortDependencies";
import { TooltipIconButton } from "../common/TooltipIconButton";

export interface AutoSortDependenciesModalProps {
  plan: AutoSortDependencyPlan;
  disabled?: boolean;
  decisionDisabledReason?: string;
  onClose: () => void;
  onSortWithoutAdding: () => void;
  onAddAndSort: (mods: readonly Mod[]) => void;
}

function dependencyName(entry: AutoSortDependencyEntry) {
  const displayName = entry.dependency.displayName?.trim();
  return displayName?.length ? displayName : entry.dependency.packageId;
}

function dependencyStatus(entry: AutoSortDependencyEntry) {
  switch (entry.status) {
    case autoSortDependencyStatuses.available:
      return (
        <span className="auto-sort-dependency-status available">
          <CheckCircle2 size={15} aria-hidden /> Available in Library
        </span>
      );
    case autoSortDependencyStatuses.ambiguous:
      return (
        <span className="auto-sort-dependency-status unresolved">
          <CircleHelp size={15} aria-hidden /> Multiple Library matches
        </span>
      );
    case autoSortDependencyStatuses.unavailable:
      return (
        <span className="auto-sort-dependency-status unresolved">
          <AlertTriangle size={15} aria-hidden /> Not available in Library
        </span>
      );
  }
}

export function AutoSortDependenciesModal({
  plan,
  disabled = false,
  decisionDisabledReason,
  onClose,
  onSortWithoutAdding,
  onAddAndSort,
}: AutoSortDependenciesModalProps) {
  const missingCount = plan.entries.length;
  const availableCount = plan.availableMods.length;
  const unresolvedCount = plan.unresolvedEntries.length;
  return (
    <div
      className="modal modal-open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auto-sort-dependencies-title"
    >
      <div className="modal-box app-modal auto-sort-dependencies-modal">
        <div className="app-modal-header">
          <h2 id="auto-sort-dependencies-title">Missing dependencies</h2>
          <TooltipIconButton label="Close" disabled={disabled} onClick={onClose}>
            <X size={17} aria-hidden />
          </TooltipIconButton>
        </div>
        <p className="app-modal-copy">
          Auto-sort found <strong>{missingCount}</strong> missing{" "}
          {missingCount === 1 ? "dependency" : "dependencies"} across{" "}
          <strong>{plan.affectedModCount}</strong> current or planned Active{" "}
          {plan.affectedModCount === 1 ? "mod" : "mods"}.
        </p>
        <ul className="auto-sort-dependency-list" aria-label="Missing dependencies">
          {plan.entries.map((entry) => (
            <li key={entry.packageId}>
              <div className="auto-sort-dependency-identity">
                <strong>{dependencyName(entry)}</strong>
                <code>{entry.packageId}</code>
                <small>Required by {entry.requiredBy.map((mod) => mod.name).join(", ")}</small>
              </div>
              {dependencyStatus(entry)}
            </li>
          ))}
        </ul>
        {unresolvedCount > 0 && (
          <p className="auto-sort-dependency-warning" role="status">
            <AlertTriangle size={16} aria-hidden />
            <span>
              {unresolvedCount}{" "}
              {unresolvedCount === 1 ? "dependency cannot" : "dependencies cannot"} be added
              automatically. You can still sort the current Active list.
            </span>
          </p>
        )}
        {decisionDisabledReason && (
          <p className="auto-sort-dependency-warning" role="status">
            <AlertTriangle size={16} aria-hidden />
            <span>{decisionDisabledReason} Wait for the current check or close this dialog.</span>
          </p>
        )}
        <div className="app-modal-actions auto-sort-dependency-actions">
          <button className="ghost-action" type="button" disabled={disabled} onClick={onClose}>
            Cancel
          </button>
          <button
            className="ghost-action"
            type="button"
            disabled={disabled || Boolean(decisionDisabledReason)}
            onClick={onSortWithoutAdding}
          >
            <Sparkles size={16} aria-hidden />
            Sort current list
          </button>
          <button
            className="primary-action"
            type="button"
            disabled={disabled || Boolean(decisionDisabledReason) || availableCount === 0}
            onClick={() => {
              if (!disabled && !decisionDisabledReason && availableCount > 0) {
                onAddAndSort(plan.availableMods);
              }
            }}
          >
            <CheckCircle2 size={16} aria-hidden />
            Add {availableCount} &amp; sort
          </button>
        </div>
      </div>
      <button className="modal-backdrop" type="button" disabled={disabled} onClick={onClose}>
        Close
      </button>
    </div>
  );
}
