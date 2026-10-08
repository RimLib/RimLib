import type {
  ConstantValue,
  modActivities,
  modSources,
  steamStatusSources,
  subscriptionActions,
  subscriptionCommands,
} from "./domainConstants";

export type ModSource = ConstantValue<typeof modSources>;
export type SteamStatusSource = ConstantValue<typeof steamStatusSources>;
export type ModActivity = ConstantValue<typeof modActivities>;
export type SubscriptionCommand = ConstantValue<typeof subscriptionCommands>;

export interface ModDependency {
  packageId: string;
  displayName?: string;
  gameVersions?: string[];
}

export interface Mod {
  id: string;
  workshopId?: string;
  packageId?: string;
  name: string;
  author: string;
  url?: string;
  source: ModSource;
  summary: string;
  dependencies?: ModDependency[];
  gameVersions: string[];
  tags: string[];
  userTagIds?: string[];
  subscribed: boolean;
  downloadedAt: string;
  addedAt: string;
  thumbnail?: string;
  screenshots: string[];
  notes?: string;
  metadataUpdatedAt?: string;
  steamCreatorId?: string;
  steamPublishedAt?: string;
  steamUpdatedAt?: string;
  fileSize?: number;
  localPath?: string;
}

export interface AppSettings {
  rimWorldConfigPath?: string;
  workshopModsPath?: string;
  firebaseSync?: FirebaseSyncSettings;
}

export const appSettingKeys = [
  "rimWorldConfigPath",
  "workshopModsPath",
  "firebaseSync",
] as const satisfies readonly (keyof AppSettings)[];

export interface FirebaseSyncSettings {
  enabled: boolean;
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  email: string;
}

export interface LocalSteamState {
  source?: SteamStatusSource;
  observedIds: string[];
  observedAt?: string;
  // Confirmed Steam actions take precedence until the installed folders catch up.
  pending: Record<string, SubscriptionCommand>;
}

/** Normalized application state. The persisted v3 vault is produced by serializeVault. */
export interface ModVault {
  [key: string]: unknown;
  mods: Mod[];
  // Selection is deliberately runtime-only and is not written to the v3 vault.
  selectedModId?: string;
  // Opaque future library metadata survives without being treated as a mod or tag.
  libraryExtensions?: Record<string, unknown>;
  // Opaque future device sections survive a read/write cycle without entering domain logic.
  deviceStateExtensions?: Record<string, unknown>;
  settings?: AppSettings;
  schemaVersion: number;
  revision?: string;
  userTags: ModTag[];
  localSteamState: LocalSteamState;
}

export interface ModTag {
  id: string;
  name: string;
  color: string;
}

export type SubscriptionAction = ConstantValue<typeof subscriptionActions>;

export interface SubscriptionCheck {
  mods: Mod[];
  activeCount: number;
  activeError?: string;
  vault: ModVault;
}

export interface SteamImportResult {
  mods: Mod[];
  discoveredIds: string[];
  manifestPaths: string[];
  missingMetadataIds: string[];
  steamLibraryPaths: string[];
  subscribedIds: string[];
  warnings: string[];
}

export interface ActiveModsState {
  configPath?: string;
  gameVersion?: string;
  packageIds: string[];
  installedMods?: InstalledModMetadata[];
  error?: string;
  metadataError?: string;
}

export interface WorkshopStatusSnapshot {
  revision?: string;
  workshopModsPath?: string;
  observedIds: string[];
  observedAt: string;
  pending: Record<string, SubscriptionCommand>;
  warnings: string[];
}

export interface InstalledModMetadata {
  packageId: string;
  localPath: string;
  workshopId?: string;
  dependencies?: ModDependency[];
  name?: string;
  author?: string;
  summary?: string;
  gameVersions?: string[];
}

export interface SteamOperationProgress {
  message: string;
  completed: number;
  total: number;
  vault?: ModVault;
}

export interface SteamOperationResult {
  vault: ModVault;
  activeMods: ActiveModsState;
  subscribed: number;
  unsubscribed: number;
  failures: string[];
  warnings?: string[];
}

export interface SteamStatus {
  running: boolean;
  error?: string;
}

export interface VaultSaveOptions {
  deletedTagIds?: string[];
}

export interface ModStoreApi {
  openLogs: () => Promise<void>;
  openDatabaseFolder: () => Promise<void>;
  revealModFolder: (modId: string) => Promise<void>;
  openWorkshopInBrowser: (workshopId: string) => Promise<void>;
  load: () => Promise<ModVault>;
  save: (vault: ModVault, options?: VaultSaveOptions) => Promise<ModVault>;
  chooseRimWorldConfigPath: () => Promise<string | null>;
  chooseWorkshopModsPath: (defaultPath?: string) => Promise<string | null>;
  detectWorkshopModsPath: () => Promise<string | null>;
  validateWorkshopModsPath: (path: string) => Promise<string>;
  deleteLibraryMods: (modIds: string[]) => Promise<ModVault>;
  refreshModMetadata: (modId: string) => Promise<ModVault>;
  syncSubscribedMods: () => Promise<SteamOperationResult>;
  refreshSubscriptions: () => Promise<SteamOperationResult>;
  inspectWorkshopStatus: () => Promise<WorkshopStatusSnapshot>;
  getSteamStatus: () => Promise<SteamStatus>;
  getActiveMods: (settings?: AppSettings) => Promise<ActiveModsState>;
  previewLibrarySubscriptions: (
    action: SubscriptionAction,
    modIds: string[],
  ) => Promise<SubscriptionCheck>;
  setSubscription: (
    modId: string,
    subscribed: boolean,
    expectedWorkshopId?: string,
  ) => Promise<SteamOperationResult>;
  onSteamProgress?: (listener: (progress: SteamOperationProgress) => void) => () => void;
  onBeforeClose?: (listener: () => Promise<void>) => () => void;
}
