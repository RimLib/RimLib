import { z } from "zod";

import { modSources, steamStatusSources, subscriptionCommands } from "./domainConstants";
import type {
  appSettingKeys,
  AppSettings,
  FirebaseSyncSettings,
  LocalSteamState,
  Mod,
  ModTag,
} from "./types";
import { isRecord, requireValue } from "./validation";

export const vaultSchemaVersion = 3;

const stringsSchema = z.array(z.string());
const modDependencySchema = z.looseObject({
  packageId: z.string().min(1),
  displayName: z.string().optional(),
  gameVersions: stringsSchema.optional(),
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
  }),
});

export interface StoredVault {
  [key: string]: unknown;
  schemaVersion: number;
  revision?: string;
  library: { [key: string]: unknown; mods: StoredMod[]; tags: ModTag[] };
  settings?: AppSettings;
  deviceState: { [key: string]: unknown; steam: LocalSteamState };
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
