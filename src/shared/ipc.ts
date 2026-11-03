import { z } from "zod";

import { subscriptionActions } from "./domainConstants";
import { maxIpcTextLength, modListLimits } from "./limits";
import { getOfficialContent } from "./officialContent";
import { isUsablePackageId, normalizePackageId, rimWorldPackages } from "./packages";
import type { ModStoreApi } from "./types";
import { normalizeVault } from "./vault";
import { appSettingsSchema } from "./vaultValidation";

type InvokeMethod = {
  [Method in keyof ModStoreApi]-?: ModStoreApi[Method] extends (
    ...args: never[]
  ) => Promise<unknown>
    ? Method
    : never;
}[keyof ModStoreApi];

export const ipcChannels = Object.freeze({
  openLogs: "diagnostics:open-logs",
  openDatabaseFolder: "mod-store:open-folder",
  launchRimWorld: "rimworld:launch",
  importModList: "mod-list:import",
  exportModList: "mod-list:export",
  revealModFolder: "mod:reveal-folder",
  openWorkshopInBrowser: "mod:open-workshop",
  load: "mod-store:load",
  save: "mod-store:save",
  deleteLibraryMods: "mod-store:delete-library-mods",
  refreshModMetadata: "mod:refresh-metadata",
  chooseRimWorldConfigPath: "settings:choose-config-path",
  chooseWorkshopModsPath: "settings:choose-workshop-path",
  detectWorkshopModsPath: "settings:detect-workshop-path",
  validateWorkshopModsPath: "settings:validate-workshop-path",
  getActiveModConfiguration: "rimworld:active-mod-configuration",
  getInstalledMods: "rimworld:installed-mods",
  getActiveMods: "rimworld:active-mods",
  setActiveMods: "rimworld:set-active-mods",
  syncSubscribedMods: "steam:sync",
  refreshSubscriptions: "steam:refresh-subscriptions",
  inspectWorkshopStatus: "steam:inspect-workshop-status",
  getSteamStatus: "steam:status",
  previewLibrarySubscriptions: "steam:preview-library-subscriptions",
  setSubscription: "steam:set-subscription",
} as const satisfies Record<InvokeMethod, string>);

export const ipcEvents = Object.freeze({
  steamProgress: "steam:progress",
  beforeClose: "app:before-close",
  closeReady: "app:close-ready",
  rendererError: "diagnostics:renderer-error",
} as const);

export const preloadApiNames = Object.freeze({
  modStore: "modStore",
  diagnostics: "appDiagnostics",
} as const);

type IpcCalls = {
  [Method in keyof typeof ipcChannels as (typeof ipcChannels)[Method]]: ModStoreApi[Method];
};
export type IpcChannel = keyof IpcCalls;
export type IpcArgs<Channel extends IpcChannel> = Parameters<IpcCalls[Channel]>;
export type IpcResult<Channel extends IpcChannel> = Awaited<ReturnType<IpcCalls[Channel]>>;

const requestTextSchema = z
  .string()
  .refine((value) => Boolean(value.trim()) && value.length <= maxIpcTextLength);
const identifiersSchema = z.array(z.string().min(1));
const noArgsSchema = z.tuple([]);
const textArgsSchema = z.tuple([requestTextSchema]);
const saveOptionsSchema = z.strictObject({ deletedTagIds: identifiersSchema.optional() });
const packageIdSchema = z.string().max(modListLimits.maxPackageIdLength).refine(isUsablePackageId);
const packageOrderSchema = z
  .array(packageIdSchema)
  .min(1)
  .max(modListLimits.maxEntries)
  .superRefine((packageIds, context) => {
    const normalized = packageIds.map(normalizePackageId);
    if (new Set(normalized).size !== normalized.length) {
      context.addIssue({ code: "custom", message: "Duplicate package identifiers." });
    }
    if (normalized.filter((packageId) => packageId === rimWorldPackages.core).length !== 1) {
      context.addIssue({ code: "custom", message: "RimWorld Core must occur exactly once." });
    }
    if (
      packageIds.some(
        (packageId) => /_steam$/i.test(packageId) && getOfficialContent(packageId) !== undefined,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Official RimWorld content cannot select a Workshop copy.",
      });
    }
  });
const modListExportSchema = z.strictObject({
  gameVersion: z.string().trim().min(1).max(modListLimits.maxVersionLength),
  packageIds: packageOrderSchema,
});

const requestSchemas = {
  [ipcChannels.openLogs]: noArgsSchema,
  [ipcChannels.openDatabaseFolder]: noArgsSchema,
  [ipcChannels.launchRimWorld]: noArgsSchema,
  [ipcChannels.importModList]: noArgsSchema,
  [ipcChannels.exportModList]: z.tuple([modListExportSchema]),
  [ipcChannels.revealModFolder]: textArgsSchema,
  [ipcChannels.openWorkshopInBrowser]: textArgsSchema,
  [ipcChannels.load]: noArgsSchema,
  [ipcChannels.save]: z.tuple([z.unknown(), saveOptionsSchema.optional()]),
  [ipcChannels.deleteLibraryMods]: z.tuple([identifiersSchema]),
  [ipcChannels.refreshModMetadata]: textArgsSchema,
  [ipcChannels.chooseRimWorldConfigPath]: noArgsSchema,
  [ipcChannels.chooseWorkshopModsPath]: z.tuple([requestTextSchema.optional()]),
  [ipcChannels.detectWorkshopModsPath]: noArgsSchema,
  [ipcChannels.validateWorkshopModsPath]: textArgsSchema,
  [ipcChannels.getActiveModConfiguration]: z.tuple([appSettingsSchema.optional()]),
  [ipcChannels.getInstalledMods]: z.tuple([appSettingsSchema.optional(), z.boolean().optional()]),
  [ipcChannels.getActiveMods]: z.tuple([appSettingsSchema.optional()]),
  [ipcChannels.setActiveMods]: z.tuple([
    appSettingsSchema.optional(),
    identifiersSchema,
    identifiersSchema,
  ]),
  [ipcChannels.syncSubscribedMods]: noArgsSchema,
  [ipcChannels.refreshSubscriptions]: noArgsSchema,
  [ipcChannels.inspectWorkshopStatus]: noArgsSchema,
  [ipcChannels.getSteamStatus]: noArgsSchema,
  [ipcChannels.previewLibrarySubscriptions]: z.tuple([
    z.enum(subscriptionActions),
    identifiersSchema,
  ]),
  [ipcChannels.setSubscription]: z.tuple([
    requestTextSchema,
    z.boolean(),
    requestTextSchema.optional(),
  ]),
} satisfies Record<IpcChannel, z.ZodType>;

export function validateIpcArgs<Channel extends IpcChannel>(
  channel: Channel,
  args: unknown[],
): asserts args is IpcArgs<Channel> {
  if (
    !Object.prototype.hasOwnProperty.call(requestSchemas, channel) ||
    !requestSchemas[channel].safeParse(args).success
  ) {
    throw new Error("Invalid application request. No changes were made.");
  }
  if (channel === ipcChannels.save) {
    normalizeVault(args[0]);
  }
}
