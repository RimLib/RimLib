import {
  CalendarDays,
  CircleMinus,
  CirclePlus,
  ExternalLink,
  FolderOpen,
  Hash,
  Info,
  LoaderCircle,
  Package,
  RefreshCw,
  Trash2,
  TriangleAlert,
  User,
  WandSparkles,
} from "lucide-react";

import { isOfficialMod } from "../../../../shared/packages";
import { createSteamWorkshopUrl, getModWorkshopId } from "../../../../shared/steam";
import { isWorkshopMod } from "../../../../shared/subscriptions";
import type { Mod, ModDependency, ModTag } from "../../../../shared/types";
import type { ActiveModIssue } from "../../utils/activeValidation";
import { dependenciesForGameVersion } from "../../utils/dependencies";
import { type DraftAction, draftActions } from "../../utils/drafts";
import { formatDate, getModHue } from "../../utils/mods";
import { tooltipPlacements } from "../../utils/tooltips";
import { DraftBadge } from "../common/DraftBadge";
import { EmptyState } from "../common/EmptyState";
import { ExpandableSummary } from "../common/ExpandableSummary";
import { ModImage } from "../common/ModImage";
import { OfficialMarker } from "../common/OfficialMarker";
import { PanelTitle } from "../common/PanelTitle";
import { TagAssignments } from "../common/TagAssignments";
import { TooltipIconButton } from "../common/TooltipIconButton";

interface ModInfoPanelProps {
  active?: boolean;
  isSaved?: boolean;
  isRevealingFolder?: boolean;
  isRefreshingMetadata?: boolean;
  removalCount?: number;
  removalDisabledReason?: string;
  removalRequiresUnsubscribe?: boolean;
  pendingAction?: DraftAction;
  pendingActions?: readonly DraftAction[];
  subscriptionDisabledReason?: string;
  validationIssues?: readonly ActiveModIssue[];
  missingDependencies?: readonly ModDependency[];
  dependencyFixDisabledReason?: string;
  gameVersion?: string;
  mod?: Mod;
  onAddModToLibrary?: (modId: string) => void;
  onRemoveModFromLibrary: (modId: string) => void;
  onRevealModFolder?: (modId: string) => void;
  onOpenWorkshop?: (workshopId: string) => void;
  onRefreshMetadata?: (modId: string) => void;
  onFixDependencies?: (modId: string) => void;
  onSubscribe?: (modId: string) => void;
  onUnsubscribe?: (modId: string) => void;
  tags: ModTag[];
  onAssignTag: (modId: string, tagId: string, assigned: boolean) => void;
  onCreateTag: (name: string, modId: string) => void;
}

export function ModInfoPanel({
  active = false,
  isSaved = true,
  isRevealingFolder = false,
  isRefreshingMetadata = false,
  removalCount = 1,
  removalDisabledReason,
  removalRequiresUnsubscribe = false,
  pendingAction,
  pendingActions,
  subscriptionDisabledReason,
  validationIssues = [],
  missingDependencies = [],
  dependencyFixDisabledReason,
  gameVersion,
  mod,
  onAddModToLibrary,
  onRemoveModFromLibrary,
  onRevealModFolder,
  onOpenWorkshop,
  onRefreshMetadata,
  onFixDependencies,
  onSubscribe,
  onUnsubscribe,
  tags,
  onAssignTag,
  onCreateTag,
}: ModInfoPanelProps) {
  const workshopId = mod ? getModWorkshopId(mod) : undefined;
  const missingPackages = new Set(missingDependencies.map((dependency) => dependency.packageId));
  const dependencies = mod ? dependenciesForGameVersion(mod, gameVersion) : [];
  const displayedPendingActions = pendingActions ?? (pendingAction ? [pendingAction] : []);
  const pendingRemoval = displayedPendingActions.includes(draftActions.remove);
  const otherValidationIssues = validationIssues.filter(
    ({ code }) => code !== "missing-dependency",
  );

  return (
    <aside className="panel info-panel" aria-label="Mod Info">
      <PanelTitle icon={<Info size={18} />} title="Mod Info">
        {mod && (
          <TooltipIconButton
            aria-label="Refresh mod metadata"
            label={
              isRefreshingMetadata ? "Refreshing Workshop metadata..." : "Refresh mod metadata"
            }
            placement={tooltipPlacements.bottom}
            disabled={isRefreshingMetadata || !onRefreshMetadata || !workshopId || !isSaved}
            onClick={() => onRefreshMetadata?.(mod.id)}
          >
            {isRefreshingMetadata ? (
              <LoaderCircle className="animate-spin" size={16} aria-hidden />
            ) : (
              <RefreshCw size={16} aria-hidden />
            )}
          </TooltipIconButton>
        )}
      </PanelTitle>

      {mod ? (
        <div className="mod-info">
          <div className={`mod-visual ${getModHue(mod)}`}>
            <ModImage
              key={mod.id}
              src={mod.thumbnail}
              refreshedAt={mod.metadataUpdatedAt}
              size={42}
            />
            <span className="mod-source">{mod.source}</span>
          </div>

          <div className="info-heading">
            <h2>{mod.name}</h2>
            <span
              className={`mod-subscription-status ${mod.subscribed ? "subscribed" : "not-subscribed"}`}
            >
              {mod.subscribed ? "Subscribe" : "Not subscribe"}
            </span>
          </div>
          {isOfficialMod(mod) && <OfficialMarker />}
          {displayedPendingActions.map((action) => (
            <DraftBadge key={action} action={action} />
          ))}

          {isSaved && (
            <div className="action-row">
              {isWorkshopMod(mod) && (
                <button
                  className={mod.subscribed ? "danger-action" : "primary-action"}
                  disabled={Boolean(subscriptionDisabledReason)}
                  title={subscriptionDisabledReason}
                  onClick={() => {
                    if (!subscriptionDisabledReason) {
                      if (mod.subscribed) {
                        onUnsubscribe?.(mod.id);
                      } else {
                        onSubscribe?.(mod.id);
                      }
                    }
                  }}
                >
                  {mod.subscribed ? (
                    <CircleMinus size={16} aria-hidden />
                  ) : (
                    <CirclePlus size={16} aria-hidden />
                  )}
                  {mod.subscribed ? "Unsubscribe" : "Subscribe"}
                </button>
              )}
              {pendingRemoval ? (
                <button
                  className="primary-action"
                  disabled={!onAddModToLibrary || Boolean(removalDisabledReason)}
                  title={
                    removalDisabledReason ??
                    "Keep this mod in Library; other pending actions are unchanged"
                  }
                  onClick={() => {
                    if (!removalDisabledReason) {
                      onAddModToLibrary?.(mod.id);
                    }
                  }}
                >
                  <CirclePlus size={16} aria-hidden />
                  Add back
                </button>
              ) : (
                <button
                  className="danger-action"
                  disabled={Boolean(removalDisabledReason)}
                  title={
                    removalDisabledReason ??
                    (removalRequiresUnsubscribe
                      ? removalCount > 1
                        ? `Unsubscribe and remove ${removalCount} mods from library`
                        : "Unsubscribe and remove from library"
                      : removalCount > 1
                        ? `Remove ${removalCount} mods from library`
                        : "Remove from library")
                  }
                  onClick={() => {
                    if (!removalDisabledReason) {
                      onRemoveModFromLibrary(mod.id);
                    }
                  }}
                >
                  <Trash2 size={16} aria-hidden />
                  Removed
                </button>
              )}
            </div>
          )}

          {missingDependencies.length > 0 && (
            <div className="dependency-warning" role="status" aria-label="Dependency status">
              <TriangleAlert size={18} aria-hidden />
              <div>
                <strong>
                  {missingDependencies.length === 1
                    ? "Missing active dependency"
                    : `${missingDependencies.length} missing active dependencies`}
                </strong>
                <span>
                  Enable{" "}
                  {missingDependencies
                    .map((dependency) => dependency.displayName ?? dependency.packageId)
                    .join(", ")}{" "}
                  in RimWorld.
                </span>
                {onFixDependencies && (
                  <button
                    type="button"
                    className="dependency-fix-action"
                    disabled={Boolean(dependencyFixDisabledReason)}
                    title={dependencyFixDisabledReason}
                    onClick={() => {
                      if (!dependencyFixDisabledReason) {
                        onFixDependencies(mod.id);
                      }
                    }}
                  >
                    <WandSparkles size={13} aria-hidden />
                    Auto-fix dependencies
                  </button>
                )}
              </div>
            </div>
          )}

          {otherValidationIssues.length > 0 && (
            <div className="validation-warning" role="status" aria-label="Active mod errors">
              <TriangleAlert size={18} aria-hidden />
              <div>
                <strong>
                  {otherValidationIssues.length === 1
                    ? "Active mod error"
                    : `${otherValidationIssues.length} active mod errors`}
                </strong>
                <ul>
                  {otherValidationIssues.map((issue) => (
                    <li key={issue.id}>{issue.message}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {isSaved && (
            <TagAssignments
              key={`tags:${mod.id}`}
              tags={tags}
              assignedIds={mod.userTagIds ?? []}
              onToggle={(id, assigned) => {
                onAssignTag(mod.id, id, assigned);
              }}
              onCreate={(name) => {
                onCreateTag(name, mod.id);
              }}
            />
          )}

          <ExpandableSummary key={`summary:${mod.id}`} summary={mod.summary} />

          <section className="dependency-section" aria-label="Mod requirements">
            <h3>
              <Package size={15} aria-hidden />
              Requirements
            </h3>
            {dependencies.length ? (
              <ul>
                {dependencies.map((dependency) => {
                  const missing = missingPackages.has(dependency.packageId);
                  return (
                    <li key={dependency.packageId} className={missing ? "missing" : undefined}>
                      <span>
                        <strong>{dependency.displayName ?? dependency.packageId}</strong>
                        {dependency.displayName && <code>{dependency.packageId}</code>}
                        {dependency.gameVersions?.length && (
                          <code>RimWorld {dependency.gameVersions.join(", ")}</code>
                        )}
                      </span>
                      {active && <em>{missing ? "Missing" : "Active"}</em>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p>No dependencies declared in About.xml.</p>
            )}
          </section>

          <dl className="metadata-list">
            <div>
              <dt>
                <Hash size={14} aria-hidden />
                Id
              </dt>
              <dd>{mod.workshopId ?? mod.id}</dd>
            </div>
            <div>
              <dt>
                <Package size={14} aria-hidden />
                Package
              </dt>
              <dd>{mod.packageId ?? "Unknown"}</dd>
            </div>
            <div>
              <dt>
                <User size={14} aria-hidden />
                Author
              </dt>
              <dd>{mod.author}</dd>
            </div>
            <div>
              <dt>
                <CalendarDays size={14} aria-hidden />
                Downloaded
              </dt>
              <dd>{mod.downloadedAt ? formatDate(mod.downloadedAt) : "Unknown"}</dd>
            </div>
          </dl>

          <div className="version-row">
            {mod.gameVersions.map((version) => (
              <span key={version}>RimWorld {version}</span>
            ))}
          </div>

          {workshopId || mod.localPath ? (
            <div className="external-links">
              {workshopId ? (
                <a
                  className="external-link"
                  href={createSteamWorkshopUrl(workshopId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => {
                    if (onOpenWorkshop) {
                      event.preventDefault();
                      onOpenWorkshop(workshopId);
                    }
                  }}
                >
                  <ExternalLink size={15} aria-hidden />
                  Steam Workshop
                </a>
              ) : null}
              <a
                aria-disabled={
                  isRevealingFolder || !onRevealModFolder || (!mod.localPath && !workshopId)
                    ? "true"
                    : undefined
                }
                aria-label={isRevealingFolder ? "Finding mod folder" : "Open mod folder"}
                className="external-link"
                href="#open-mod-folder"
                onClick={(event) => {
                  event.preventDefault();
                  if (!isRevealingFolder && onRevealModFolder && (mod.localPath || workshopId)) {
                    onRevealModFolder(mod.id);
                  }
                }}
              >
                {isRevealingFolder ? (
                  <LoaderCircle className="animate-spin" size={15} aria-hidden />
                ) : (
                  <FolderOpen size={15} aria-hidden />
                )}
                {isRevealingFolder ? "Finding mod folder..." : "Open mod folder"}
              </a>
            </div>
          ) : null}
        </div>
      ) : (
        <EmptyState label="No mod selected" />
      )}
    </aside>
  );
}
