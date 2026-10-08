import { z } from "zod";

import { withReadTimeout } from "../shared/async";
import { millisecondsPerSecond, steamLimits } from "../shared/limits";
import {
  createSteamWorkshopUrl,
  getModWorkshopId,
  isSteamWorkshopId,
  publishedFileDetailsUrl,
  RIMWORLD_APP_ID,
  steamResultCodes,
} from "../shared/steam";
import type { Mod, ModVault } from "../shared/types";
import { log } from "./logging";
import type { VaultStore } from "./vaultStore";

const invalidMetadataMessage =
  "Steam returned invalid Workshop metadata. Saved information was preserved.";
const invalidAppIdMessage =
  "Steam returned an invalid Workshop app ID. Saved information was preserved.";
const workshopIdSchema = z.string().refine(isSteamWorkshopId);
const metadataRequestSchema = z.array(workshopIdSchema).min(1).max(steamLimits.metadataBatchSize);
const optionalTextSchema = z.string().optional().catch(undefined);
const optionalTimestampSchema = z
  .number()
  .refine((value) => Boolean(timestamp(value)))
  .optional()
  .catch(undefined);
const workshopTagSchema = z.object({ tag: z.string() });
const workshopDetailSchema = z.object({
  publishedfileid: workshopIdSchema,
  // Retain malformed core values when the item still has a usable identity. This lets bulk
  // callers reject one item without discarding valid siblings from the same response.
  result: z.unknown().optional(),
  // App identity is retained verbatim so one malformed item cannot poison an otherwise valid
  // bulk response. normalizeWorkshopDetail applies the strict per-item policy.
  consumer_app_id: z.unknown().optional(),
  title: optionalTextSchema,
  description: optionalTextSchema,
  preview_url: optionalTextSchema,
  creator: optionalTextSchema,
  time_created: optionalTimestampSchema,
  time_updated: optionalTimestampSchema,
  file_size: z.union([z.string(), z.number()]).transform(String).optional().catch(undefined),
  tags: z
    .array(z.unknown())
    .transform((entries) =>
      entries.flatMap((entry) => {
        const tag = workshopTagSchema.safeParse(entry);
        return tag.success ? [tag.data] : [];
      }),
    )
    .optional()
    .catch(undefined),
});
const workshopResponseSchema = z.object({
  response: z.object({ publishedfiledetails: z.array(z.unknown()) }),
});

export type WorkshopDetail = z.infer<typeof workshopDetailSchema>;

export async function fetchWorkshopDetails(
  ids: string[],
  request: typeof fetch = fetch,
  timeoutMs: number = steamLimits.metadataTimeoutMs,
): Promise<WorkshopDetail[]> {
  if (!metadataRequestSchema.safeParse(ids).success) {
    throw new Error("Invalid Workshop metadata request.");
  }
  const controller = new AbortController();
  const body = new URLSearchParams({ itemcount: String(ids.length) });
  ids.forEach((id, index) => {
    body.set(`publishedfileids[${index}]`, id);
  });
  try {
    return await withReadTimeout(
      (async () => {
        const response = await request(publishedFileDetailsUrl, {
          method: "POST",
          body,
          signal: controller.signal,
          headers: { "Cache-Control": "no-cache" },
        });
        log.debug("steam.metadata.http.response", {
          requestedCount: ids.length,
          status: response.status,
        });
        if (!response.ok) {
          throw new Error(`Steam metadata: HTTP ${response.status}`);
        }
        const payload: unknown = await response.json();
        const parsed = workshopResponseSchema.safeParse(payload);
        if (!parsed.success) {
          throw new Error(invalidMetadataMessage);
        }
        return parsed.data.response.publishedfiledetails.flatMap((entry) => {
          const detail = workshopDetailSchema.safeParse(entry);
          return detail.success && ids.includes(detail.data.publishedfileid) ? [detail.data] : [];
        });
      })(),
      "Workshop metadata refresh timed out. Check your internet connection; saved information was preserved.",
      timeoutMs,
    );
  } finally {
    controller.abort();
  }
}

export interface NormalizedWorkshopMetadata {
  name: string;
  url: string;
  summary?: string;
  thumbnail?: string;
  tags?: string[];
  gameVersions?: string[];
  steamCreatorId?: string;
  steamPublishedAt?: string;
  steamUpdatedAt?: string;
  fileSize?: number;
}

export type NormalizedWorkshopDetail =
  | { status: "available"; metadata: NormalizedWorkshopMetadata }
  | { status: "unavailable"; message: string }
  | { status: "invalid"; message: string };

type MetadataPatch = NormalizedWorkshopMetadata & Pick<Mod, "metadataUpdatedAt">;

function webImage(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) {
    return undefined;
  }
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      return undefined;
    }
    url.protocol = "https:";
    return url.href;
  } catch {
    return undefined;
  }
}

function timestamp(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  const date = new Date(value * millisecondsPerSecond);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function fileSize(value: unknown): number | undefined {
  if (!(
    (typeof value === "number" && Number.isSafeInteger(value)) ||
    (typeof value === "string" && /^[1-9]\d*$/.test(value))
  )) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function normalizeWorkshopDetail(detail: WorkshopDetail): NormalizedWorkshopDetail {
  if (typeof detail.result !== "number" || !Number.isInteger(detail.result)) {
    return { status: "invalid", message: invalidMetadataMessage };
  }
  if (detail.result !== steamResultCodes.ok) {
    return {
      status: "unavailable",
      message:
        "Workshop metadata is unavailable: the item may be private or deleted. Saved information was preserved.",
    };
  }
  if (detail.consumer_app_id === undefined) {
    return {
      status: "invalid",
      message: "Steam returned incomplete Workshop metadata. Saved information was preserved.",
    };
  }
  if (typeof detail.consumer_app_id !== "number" || !Number.isInteger(detail.consumer_app_id)) {
    return { status: "invalid", message: invalidAppIdMessage };
  }
  if (detail.consumer_app_id !== RIMWORLD_APP_ID) {
    return {
      status: "invalid",
      message: "This Workshop item is not a RimWorld mod. Saved information was preserved.",
    };
  }
  if (typeof detail.title !== "string" || !detail.title.trim()) {
    return {
      status: "invalid",
      message: "Steam returned incomplete Workshop metadata. Saved information was preserved.",
    };
  }
  const metadata: NormalizedWorkshopMetadata = {
    name: detail.title,
    url: createSteamWorkshopUrl(detail.publishedfileid),
  };
  if (typeof detail.description === "string") {
    metadata.summary = detail.description;
  }
  const thumbnail = webImage(detail.preview_url);
  if (thumbnail) {
    metadata.thumbnail = thumbnail;
  }
  if (Array.isArray(detail.tags)) {
    const tags = detail.tags.flatMap((entry) => (typeof entry.tag === "string" ? [entry.tag] : []));
    metadata.tags = ["Steam", ...tags.filter((tag) => tag !== "Mod" && !/^\d+\.\d+$/.test(tag))];
    const versions = tags.filter((tag) => /^\d+\.\d+$/.test(tag));
    if (versions.length) {
      metadata.gameVersions = versions;
    }
  }
  if (isSteamWorkshopId(detail.creator)) {
    metadata.steamCreatorId = detail.creator;
  }
  const publishedAt = timestamp(detail.time_created);
  if (publishedAt) {
    metadata.steamPublishedAt = publishedAt;
  }
  const updatedAt = timestamp(detail.time_updated);
  if (updatedAt) {
    metadata.steamUpdatedAt = updatedAt;
  }
  const size = fileSize(detail.file_size);
  if (size) {
    metadata.fileSize = size;
  }
  return { status: "available", metadata };
}

export async function refreshModMetadata(
  store: VaultStore,
  id: unknown,
  request: typeof fetch = fetch,
  timeoutMs: number = steamLimits.metadataTimeoutMs,
): Promise<ModVault> {
  if (typeof id !== "string" || !id) {
    throw new Error("Choose a saved Workshop mod to refresh.");
  }
  const mod = (await store.load()).mods.find((entry) => entry.id === id);
  const workshopId = mod && getModWorkshopId(mod);
  if (!workshopId) {
    throw new Error("Only saved Workshop mods have online metadata to refresh.");
  }
  log.info("steam.metadata.refresh.started", { modId: id, workshopId, source: "public-web-api" });
  const details = await fetchWorkshopDetails([workshopId], request, timeoutMs);
  const detail = details.find((entry) => entry.publishedfileid === workshopId);
  if (!detail) {
    throw new Error("Steam did not return this mod's metadata. Saved information was preserved.");
  }
  const normalized = normalizeWorkshopDetail(detail);
  if (normalized.status !== "available") {
    throw new Error(normalized.message);
  }
  const patch: MetadataPatch = {
    ...normalized.metadata,
    metadataUpdatedAt: new Date().toISOString(),
  };
  const next = await store.update((vault) => {
    const current = vault.mods.find((entry) => entry.id === id);
    if (!current || getModWorkshopId(current) !== workshopId) {
      throw new Error("The saved mod changed during refresh. Retry the action.");
    }
    const merge = (entry: Mod): Mod => ({
      ...entry,
      ...patch,
      screenshots: patch.thumbnail
        ? [
            ...new Set([
              patch.thumbnail,
              ...entry.screenshots.filter((url) => url !== entry.thumbnail),
            ]),
          ]
        : entry.screenshots,
    });
    return {
      ...vault,
      mods: vault.mods.map((entry) => (entry.id === id ? merge(entry) : entry)),
    };
  });
  log.info("steam.metadata.refresh.completed", {
    modId: id,
    workshopId,
    hasThumbnail: Boolean(patch.thumbnail),
  });
  return next;
}
