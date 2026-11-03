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

export interface ModVersionedDependencies {
  gameVersion: string;
  dependencies: ModDependency[];
}

export interface ModLoadRule {
  packageId: string;
  gameVersions?: string[];
}

export interface ModVersionedLoadRules {
  gameVersion: string;
  rules: ModLoadRule[];
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
  dependenciesByVersion?: ModVersionedDependencies[];
  loadAfter?: ModLoadRule[];
  loadAfterByVersion?: ModVersionedLoadRules[];
  forceLoadAfter?: ModLoadRule[];
  loadBefore?: ModLoadRule[];
  loadBeforeByVersion?: ModVersionedLoadRules[];
  forceLoadBefore?: ModLoadRule[];
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

/**
 * Device-local, unapplied work. These records intentionally contain only the identity and display
 * fields needed to recover a draft; library notes, descriptions and images are never duplicated.
 */
export type PendingDraftAction = "subscribe" | "unsubscribe" | "activate" | "deactivate" | "remove";

export interface PendingDraftTarget {
  id: string;
  name: string;
  source: ModSource;
  packageId?: string;
  workshopId?: string;
  localPath?: string;
}

export interface PendingDraftChange {
  action: PendingDraftAction;
  target: PendingDraftTarget;
}

interface PendingDraftOrderMove {
  id: string;
  packageId: string;
  modId: string;
  modName: string;
  fromPosition: number;
  toPosition: number;
}

export type PendingDraftOrderOperation = PendingDraftOrderMove &
  (
    | { kind: "auto-sort" }
    | { kind: "import"; fileName: string }
    | { kind: "manual"; method: "drag" | "position" }
  );

export interface PendingDraftOperationMembership {
  operationId: string;
  packageIds: string[];
}

export interface PendingDraft {
  version: 1;
  changes: PendingDraftChange[];
  activeOrder?: string[];
  activeOrderOperations: PendingDraftOrderOperation[];
  activeBasePackageIds?: string[];
  activeBaseConfigTarget?: string;
  operationMemberships: PendingDraftOperationMembership[];
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
  /** Unapplied device-bound operations; excluded from portable Firebase records. */
  pendingDraft?: PendingDraft;
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
  /** Last modification time of the installed mod folder, when the filesystem exposes it. */
  downloadedAt?: string;
  /** Set only by the main-process scanner for exact packages in their matching game Data folder. */
  officialContent?: boolean;
  workshopId?: string;
  thumbnail?: string;
  dependencies?: ModDependency[];
  dependenciesByVersion?: ModVersionedDependencies[];
  loadAfter?: ModLoadRule[];
  loadAfterByVersion?: ModVersionedLoadRules[];
  forceLoadAfter?: ModLoadRule[];
  loadBefore?: ModLoadRule[];
  loadBeforeByVersion?: ModVersionedLoadRules[];
  forceLoadBefore?: ModLoadRule[];
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
  /** Folder-access warnings that should remain visible as Workshop availability status. */
  folderWarnings?: string[];
}

export interface SteamStatus {
  running: boolean;
  error?: string;
}

export interface VaultSaveOptions {
  deletedTagIds?: string[];
}

export interface ImportedModList {
  fileName: string;
  gameVersion?: string;
  packageIds: string[];
  knownExpansions: string[];
}

export interface ModListExportRequest {
  gameVersion: string;
  packageIds: string[];
}

export interface ModListExportResult {
  fileName: string;
  packageCount: number;
}

export interface ModStoreApi {
  openLogs: () => Promise<void>;
  openDatabaseFolder: () => Promise<void>;
  launchRimWorld: () => Promise<void>;
  importModList: () => Promise<ImportedModList | null>;
  exportModList: (request: ModListExportRequest) => Promise<ModListExportResult | null>;
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
  getActiveModConfiguration: (settings?: AppSettings) => Promise<ActiveModsState>;
  getInstalledMods: (
    settings?: AppSettings,
    forceRefresh?: boolean,
  ) => Promise<InstalledModMetadata[]>;
  getActiveMods: (settings?: AppSettings) => Promise<ActiveModsState>;
  setActiveMods: (
    settings: AppSettings | undefined,
    packageIds: string[],
    expectedPackageIds: string[],
  ) => Promise<ActiveModsState>;
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
