import { z } from "zod";

import { modSources, steamStatusSources, subscriptionCommands } from "./domainConstants";
import { maxIpcTextLength, modListLimits } from "./limits";
import { isUsablePackageId, normalizePackageId } from "./packages";
import type {
  appSettingKeys,
  AppSettings,
  FirebaseSyncSettings,
  LocalSteamState,
  Mod,
  ModTag,
  PendingDraft,
} from "./types";
import { isRecord, requireValue } from "./validation";

export const vaultSchemaVersion = 3;

const stringsSchema = z.array(z.string());
const modDependencySchema = z.looseObject({
  packageId: z.string().min(1),
  displayName: z.string().optional(),
  gameVersions: stringsSchema.optional(),
});
const modVersionedDependenciesSchema = z.looseObject({
  gameVersion: z.string().min(1),
  dependencies: z.array(modDependencySchema),
});
const modLoadRuleSchema = z.looseObject({
  packageId: z.string().min(1),
  gameVersions: stringsSchema.optional(),
});
const modVersionedLoadRulesSchema = z.looseObject({
  gameVersion: z.string().min(1),
  rules: z.array(modLoadRuleSchema),
});
const schemaVersionSchema = z.number().nonnegative().refine(Number.isInteger);
const vaultHeaderSchema = z.looseObject({ schemaVersion: schemaVersionSchema.optional() });

export const firebaseSyncSettingsSchema = z.looseObject({
  enabled: z.boolean(),
  apiKey: z.string(),
  authDomain: z.string(),
  projectId: z.string(),
  appId: z.string(),
  email: z.string(),
} satisfies Record<keyof FirebaseSyncSettings, z.ZodType>);

export const appSettingsSchema = z.looseObject({
  rimWorldConfigPath: z.string().optional(),
  workshopModsPath: z.string({ error: "Invalid Workshop mods folder setting" }).optional(),
  firebaseSync: firebaseSyncSettingsSchema.optional(),
} satisfies Record<(typeof appSettingKeys)[number], z.ZodType>);

export const storedModSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  author: z.string().optional(),
  summary: z.string().optional(),
  workshopId: z.string().optional(),
  packageId: z.string().optional(),
  url: z.string().optional(),
  downloadedAt: z.string().optional(),
  addedAt: z.string().optional(),
  thumbnail: z.string().optional(),
  notes: z.string().optional(),
  metadataUpdatedAt: z.string().optional(),
  steamCreatorId: z.string().optional(),
  steamPublishedAt: z.string().optional(),
  steamUpdatedAt: z.string().optional(),
  localPath: z.string().optional(),
  dependencies: z.array(modDependencySchema).optional(),
  dependenciesByVersion: z.array(modVersionedDependenciesSchema).optional(),
  loadAfter: z.array(modLoadRuleSchema).optional(),
  loadAfterByVersion: z.array(modVersionedLoadRulesSchema).optional(),
  forceLoadAfter: z.array(modLoadRuleSchema).optional(),
  loadBefore: z.array(modLoadRuleSchema).optional(),
  loadBeforeByVersion: z.array(modVersionedLoadRulesSchema).optional(),
  forceLoadBefore: z.array(modLoadRuleSchema).optional(),
  tags: stringsSchema.optional(),
  gameVersions: stringsSchema.optional(),
  screenshots: stringsSchema.optional(),
  userTagIds: stringsSchema.optional(),
  source: z.enum(modSources, { error: "Invalid mod source" }).optional(),
  fileSize: z.number().nonnegative().optional(),
} satisfies Record<Exclude<keyof Mod, "subscribed">, z.ZodType>);

export type StoredMod = Pick<Mod, "id" | "name"> & Partial<Omit<Mod, "id" | "name" | "subscribed">>;

const tagTextSchema = z
  .string({ error: "Invalid user tags" })
  .min(1, { error: "Invalid user tags" });
const tagSchema = z.looseObject({
  id: tagTextSchema,
  name: tagTextSchema.refine((name) => Boolean(name.trim()), { error: "Invalid user tags" }),
  color: tagTextSchema,
});
const storedWorkshopIdSchema = z
  .string()
  .regex(/^\d+$/, { error: "Invalid Steam subscription snapshot" });
const pendingSubscriptionsSchema = z.custom<Record<string, "subscribe" | "unsubscribe">>(
  (value) =>
    isRecord(value) &&
    Object.entries(value).every(
      ([id, command]) =>
        storedWorkshopIdSchema.safeParse(id).success &&
        Object.values(subscriptionCommands).includes(command as "subscribe" | "unsubscribe"),
    ),
  { error: "Invalid pending Workshop subscription changes" },
);
const pendingDraftTextSchema = z.string().min(1).max(maxIpcTextLength);
const pendingDraftPackageIdSchema = z
  .string()
  .max(modListLimits.maxPackageIdLength)
  .refine(isUsablePackageId, { error: "Invalid pending draft package ID" });
const pendingDraftOrderIdSchema = z
  .string()
  .regex(/^order-[1-9]\d*$/, { error: "Invalid pending draft operation ID" })
  .refine(
    (id) => {
      const value = Number(id.slice("order-".length));
      return (
        Number.isSafeInteger(value) &&
        value > 0 &&
        value <= Number.MAX_SAFE_INTEGER - modListLimits.maxEntries
      );
    },
    { error: "Invalid pending draft operation ID" },
  );
const pendingDraftPositionSchema = z.number().int().min(1).max(modListLimits.maxEntries);
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) {
      return true;
    }
  }
  return false;
}
const pendingDraftTargetSchema = z.looseObject({
  id: pendingDraftTextSchema,
  name: z.string().max(maxIpcTextLength),
  source: z.enum(modSources),
  packageId: pendingDraftPackageIdSchema.optional(),
  workshopId: storedWorkshopIdSchema.optional(),
  localPath: z.string().max(maxIpcTextLength).optional(),
});
const pendingDraftChangeSchema = z.looseObject({
  action: z.enum(["subscribe", "unsubscribe", "activate", "deactivate", "remove"]),
  target: pendingDraftTargetSchema,
});
const pendingDraftOrderMoveShape = {
  id: pendingDraftOrderIdSchema,
  packageId: pendingDraftPackageIdSchema,
  modId: pendingDraftTextSchema,
  modName: z.string().max(maxIpcTextLength),
  fromPosition: pendingDraftPositionSchema,
  toPosition: pendingDraftPositionSchema,
};
const pendingDraftOrderOperationSchema = z.discriminatedUnion("kind", [
  z.looseObject({ ...pendingDraftOrderMoveShape, kind: z.literal("auto-sort") }),
  z.looseObject({
    ...pendingDraftOrderMoveShape,
    kind: z.literal("import"),
    fileName: z
      .string()
      .min(1)
      .max(255)
      .refine((value) => !hasControlCharacter(value), {
        error: "Invalid pending draft import file name",
      }),
  }),
  z.looseObject({
    ...pendingDraftOrderMoveShape,
    kind: z.literal("manual"),
    method: z.enum(["drag", "position"]),
  }),
]);
const pendingDraftPackageOrderSchema = z
  .array(pendingDraftPackageIdSchema)
  .max(modListLimits.maxEntries);
const pendingDraftOperationMembershipSchema = z.looseObject({
  operationId: pendingDraftOrderIdSchema,
  packageIds: pendingDraftPackageOrderSchema.min(1),
});

function hasDuplicatePackages(packageIds: readonly string[]): boolean {
  const normalized = packageIds.map(normalizePackageId);
  return new Set(normalized).size !== normalized.length;
}

const pendingDraftSchema: z.ZodType<PendingDraft> = z
  .looseObject({
    version: z.literal(1),
    changes: z.array(pendingDraftChangeSchema).max(modListLimits.maxEntries),
    activeOrder: pendingDraftPackageOrderSchema.optional(),
    activeOrderOperations: z.array(pendingDraftOrderOperationSchema).max(modListLimits.maxEntries),
    activeBasePackageIds: pendingDraftPackageOrderSchema.min(1).optional(),
    activeBaseConfigTarget: pendingDraftTextSchema.optional(),
    operationMemberships: z
      .array(pendingDraftOperationMembershipSchema)
      .max(modListLimits.maxEntries),
  })
  .superRefine((draft, context) => {
    const activityActions = new Set(["activate", "deactivate"]);
    const subscriptionActions = new Set(["subscribe", "unsubscribe"]);
    const categories = new Set<string>();
    draft.changes.forEach((change, index) => {
      const category = activityActions.has(change.action)
        ? "activity"
        : subscriptionActions.has(change.action)
          ? "subscription"
          : "removal";
      const key = `${change.target.id}\0${category}`;
      if (categories.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["changes", index],
          message: "Duplicate pending draft change category",
        });
      }
      categories.add(key);
      if (activityActions.has(change.action) && !change.target.packageId) {
        context.addIssue({
          code: "custom",
          path: ["changes", index, "target", "packageId"],
          message: "Invalid pending draft activity target",
        });
      }
      if (subscriptionActions.has(change.action) && !change.target.workshopId) {
        context.addIssue({
          code: "custom",
          path: ["changes", index, "target", "workshopId"],
          message: "Invalid pending draft subscription target",
        });
      }
    });

    const operationIds = new Set<string>();
    draft.activeOrderOperations.forEach((operation, index) => {
      if (operationIds.has(operation.id)) {
        context.addIssue({
          code: "custom",
          path: ["activeOrderOperations", index, "id"],
          message: "Duplicate pending draft operation ID",
        });
      }
      operationIds.add(operation.id);
    });
    const membershipIds = new Set<string>();
    draft.operationMemberships.forEach((membership, index) => {
      if (membershipIds.has(membership.operationId)) {
        context.addIssue({
          code: "custom",
          path: ["operationMemberships", index, "operationId"],
          message: "Duplicate pending draft operation membership",
        });
      }
      membershipIds.add(membership.operationId);
      if (hasDuplicatePackages(membership.packageIds)) {
        context.addIssue({
          code: "custom",
          path: ["operationMemberships", index, "packageIds"],
          message: "Duplicate pending draft package ID",
        });
      }
      const operation = draft.activeOrderOperations.find(
        (candidate) => candidate.id === membership.operationId,
      );
      if (
        operation &&
        !membership.packageIds.some(
          (packageId) => normalizePackageId(packageId) === normalizePackageId(operation.packageId),
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["operationMemberships", index, "packageIds"],
          message: "Invalid pending draft operation membership",
        });
      }
    });
    if (
      operationIds.size !== membershipIds.size ||
      [...operationIds].some((id) => !membershipIds.has(id))
    ) {
      context.addIssue({
        code: "custom",
        path: ["operationMemberships"],
        message: "Invalid pending draft operation memberships",
      });
    }

    const hasActiveWork =
      draft.activeOrderOperations.length > 0 ||
      draft.changes.some((change) => activityActions.has(change.action));
    if (!draft.changes.length && !draft.activeOrderOperations.length) {
      context.addIssue({
        code: "custom",
        path: ["changes"],
        message: "Invalid empty pending draft",
      });
    }
    if (hasActiveWork && (!draft.activeBasePackageIds || !draft.activeBaseConfigTarget)) {
      context.addIssue({
        code: "custom",
        path: ["activeBasePackageIds"],
        message: "Invalid pending draft active baseline",
      });
    }
    if (draft.activeOrderOperations.length > 0 !== Boolean(draft.activeOrder)) {
      context.addIssue({
        code: "custom",
        path: ["activeOrder"],
        message: "Invalid pending draft active order",
      });
    }
    for (const [key, packageIds] of [
      ["activeOrder", draft.activeOrder],
      ["activeBasePackageIds", draft.activeBasePackageIds],
    ] as const) {
      if (packageIds && hasDuplicatePackages(packageIds)) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: "Duplicate pending draft package ID",
        });
      }
    }
  });
const storedVaultSchema = z.looseObject({
  schemaVersion: schemaVersionSchema,
  revision: z.string().optional(),
  library: z.looseObject({
    mods: z.array(storedModSchema),
    tags: z.array(tagSchema, { error: "Invalid user tags" }),
  }),
  settings: appSettingsSchema.optional(),
  deviceState: z.looseObject({
    steam: z.looseObject({
      source: z.enum(steamStatusSources, { error: "Invalid Steam status source" }).optional(),
      observedIds: z.array(storedWorkshopIdSchema),
      observedAt: z.string().optional(),
      pending: pendingSubscriptionsSchema,
    }),
    pendingDraft: pendingDraftSchema.optional(),
  }),
});

export interface StoredVault {
  [key: string]: unknown;
  schemaVersion: number;
  revision?: string;
  library: { [key: string]: unknown; mods: StoredMod[]; tags: ModTag[] };
  settings?: AppSettings;
  deviceState: {
    [key: string]: unknown;
    steam: LocalSteamState;
    pendingDraft?: PendingDraft;
  };
}

function invalidDatabase(error: z.ZodError): never {
  const issue = requireValue(error.issues[0]);
  const message = /^(Invalid|Duplicate) /.test(issue.message)
    ? issue.message
    : "Invalid mod database";
  const location = issue.path.length ? ` at ${issue.path.map(String).join(".")}` : "";
  throw new Error(`${message}${location}. Database writes have been blocked.`);
}

export function parseStoredVault(value: unknown): StoredVault {
  const header = vaultHeaderSchema.safeParse(value);
  if (!header.success) {
    invalidDatabase(header.error);
  }
  if ((header.data.schemaVersion ?? 0) > vaultSchemaVersion) {
    throw new Error(
      "This database was created by a newer app version. Update the app before editing it.",
    );
  }
  if (header.data.schemaVersion !== vaultSchemaVersion) {
    throw new Error(
      "Unsupported database schema. Run scripts/migrate-vault-v2-to-v3.mjs before opening this database.",
    );
  }
  const result = storedVaultSchema.safeParse(value);
  if (!result.success) {
    invalidDatabase(result.error);
  }
  // Preserve unknown fields rather than replacing the source with Zod's parsed clone.
  return value as StoredVault;
}
