import { z } from "zod";

import { subscriptionActions } from "./domainConstants";
import { maxIpcTextLength } from "./limits";
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
  getActiveMods: "rimworld:active-mods",
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

const requestSchemas = {
  [ipcChannels.openLogs]: noArgsSchema,
  [ipcChannels.openDatabaseFolder]: noArgsSchema,
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
  [ipcChannels.getActiveMods]: z.tuple([appSettingsSchema.optional()]),
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
