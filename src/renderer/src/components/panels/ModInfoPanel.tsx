import {
  CalendarDays,
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
} from "lucide-react";

import { createSteamWorkshopUrl, getModWorkshopId } from "../../../../shared/steam";
import type { Mod, ModDependency, ModTag } from "../../../../shared/types";
import { dependencyAppliesToGameVersion } from "../../utils/dependencies";
import type { DraftAction } from "../../utils/drafts";
import { formatDate, getModHue } from "../../utils/mods";
import { tooltipPlacements } from "../../utils/tooltips";
import { DraftBadge } from "../common/DraftBadge";
import { EmptyState } from "../common/EmptyState";
import { ModImage } from "../common/ModImage";
import { PanelTitle } from "../common/PanelTitle";
import { TagAssignments } from "../common/TagAssignments";
import { TooltipIconButton } from "../common/TooltipIconButton";

interface ModInfoPanelProps {
  active?: boolean;
  isSaved?: boolean;
  locallyDetected?: boolean;
  isRevealingFolder?: boolean;
  isRefreshingMetadata?: boolean;
  removalCount?: number;
  removalDisabledReason?: string;
  pendingAction?: DraftAction;
  missingDependencies?: readonly ModDependency[];
  gameVersion?: string;
  mod?: Mod;
  onRemoveModFromLibrary: (modId: string) => void;
  onRevealModFolder?: (modId: string) => void;
  onOpenWorkshop?: (workshopId: string) => void;
  onRefreshMetadata?: (modId: string) => void;
  tags: ModTag[];
  onAssignTag: (modId: string, tagId: string, assigned: boolean) => void;
  onCreateTag: (name: string, modId: string) => void;
}

export function ModInfoPanel({
  active = false,
  isSaved = true,
  locallyDetected = false,
  isRevealingFolder = false,
  isRefreshingMetadata = false,
  removalCount = 1,
  removalDisabledReason,
  pendingAction,
  missingDependencies = [],
  gameVersion,
  mod,
  onRemoveModFromLibrary,
  onRevealModFolder,
  onOpenWorkshop,
  onRefreshMetadata,
  tags,
  onAssignTag,
  onCreateTag,
}: ModInfoPanelProps) {
  const workshopId = mod ? getModWorkshopId(mod) : undefined;
  const missingPackages = new Set(missingDependencies.map((dependency) => dependency.packageId));

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
            <span>{mod.source}</span>
          </div>

          <div className="info-heading">
            <h2>{mod.name}</h2>
            <span
              className={
                mod.subscribed ? "mod-subscription-status active" : "mod-subscription-status saved"
              }
            >
              {!isSaved
                ? "Not saved"
                : mod.subscribed
                  ? locallyDetected
                    ? "Installed"
                    : "Subscribed"
                  : locallyDetected
                    ? "Not installed"
                    : "Not subscribed"}
            </span>
          </div>
          {active && <span className="active-pill">Active in RimWorld</span>}
          {pendingAction && <DraftBadge action={pendingAction} />}

          {missingDependencies.length > 0 && (
            <div className="dependency-warning" role="alert">
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
              </div>
            </div>
          )}

          {isSaved && (
            <TagAssignments
              key={mod.id}
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

          <p className="summary">{mod.summary}</p>

          <section className="dependency-section" aria-label="Mod requirements">
            <h3>
              <Package size={15} aria-hidden />
              Requirements
            </h3>
            {mod.dependencies?.length ? (
              <ul>
                {mod.dependencies.map((dependency) => {
                  const missing = missingPackages.has(dependency.packageId);
                  const applies = dependencyAppliesToGameVersion(dependency, gameVersion);
                  return (
                    <li key={dependency.packageId} className={missing ? "missing" : undefined}>
                      <span>
                        <strong>{dependency.displayName ?? dependency.packageId}</strong>
                        {dependency.displayName && <code>{dependency.packageId}</code>}
                        {dependency.gameVersions?.length && (
                          <code>RimWorld {dependency.gameVersions.join(", ")}</code>
                        )}
                      </span>
                      {active && applies && <em>{missing ? "Missing" : "Active"}</em>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p>No dependencies declared in About.xml.</p>
            )}
          </section>

          {isSaved && !mod.subscribed ? (
            <div className="action-row">
              <button
                className="danger-action"
                disabled={Boolean(removalDisabledReason)}
                title={removalDisabledReason}
                onClick={() => {
                  if (!removalDisabledReason && !mod.subscribed) {
                    onRemoveModFromLibrary(mod.id);
                  }
                }}
              >
                <Trash2 size={16} aria-hidden />
                {removalCount > 1
                  ? `Remove ${removalCount} mods from library`
                  : "Remove from library"}
              </button>
            </div>
          ) : null}

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
