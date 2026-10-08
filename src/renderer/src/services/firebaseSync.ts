import { deleteApp, type FirebaseApp, getApps, initializeApp } from "firebase/app";
import {
  type Auth,
  browserLocalPersistence,
  getAuth,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  collection,
  doc,
  type Firestore,
  getDocs,
  getFirestore,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

import {
  mergePortableMod,
  parsePortableMod,
  parsePortableTag,
  toPortableMod,
} from "../../../shared/cloudVault";
import type { FirebaseSyncSettings, Mod, ModVault } from "../../../shared/types";
import { isRecord } from "../../../shared/validation";
import { effectiveSubscribedIds } from "../../../shared/vault";

const firebaseAppName = "rimlib-user-sync";
const syncStatePrefix = "rimlib:firebase-sync:v1";
const deviceIdKey = "rimlib:firebase-device-id";
const deletedHash = "deleted";

type EntityKind = "mods" | "tags";

interface RemoteEntity {
  entityId: string;
  payload?: string;
  deleted: boolean;
  version: string;
}

interface EntityState {
  localHash: string;
  remoteVersion?: string;
}

interface SyncState {
  mods: Record<string, EntityState>;
  tags: Record<string, EntityState>;
}

interface FirebaseSession {
  key: string;
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  uid: string;
}

interface EntityPlan<T> {
  merged: Map<string, T>;
  deletedIds: string[];
  writes: {
    entityId: string;
    expectedVersion?: string;
    payload?: string;
    deleted: boolean;
  }[];
  state: Record<string, EntityState>;
}

export interface FirebaseSyncResult {
  vault: ModVault;
  deletedModIds: string[];
  deletedTagIds: string[];
  uploaded: number;
  downloaded: number;
  commitState: () => void;
}

let session: FirebaseSession | undefined;

function normalizedSettings(settings: FirebaseSyncSettings): FirebaseSyncSettings {
  const next: FirebaseSyncSettings = {
    enabled: settings.enabled,
    apiKey: settings.apiKey.trim(),
    authDomain: settings.authDomain.trim(),
    projectId: settings.projectId.trim(),
    appId: settings.appId.trim(),
    email: settings.email.trim(),
  };
  if (
    next.enabled &&
    (!next.apiKey || !next.authDomain || !next.projectId || !next.appId || !next.email)
  ) {
    throw new Error("Complete every Firebase field before enabling sync.");
  }
  if (next.enabled && !/^\S+@\S+\.\S+$/.test(next.email)) {
    throw new Error("Enter a valid Firebase account email address.");
  }
  return next;
}

export function normalizeFirebaseSyncSettings(
  settings: FirebaseSyncSettings,
): FirebaseSyncSettings {
  return normalizedSettings(settings);
}

function configurationKey(settings: FirebaseSyncSettings) {
  return `${settings.projectId}\n${settings.apiKey}\n${settings.appId}\n${settings.authDomain}\n${settings.email.toLowerCase()}`;
}

async function closeSession() {
  if (!session) {
    return;
  }
  const previous = session;
  session = undefined;
  await deleteApp(previous.app);
}

function firebaseMessage(error: unknown): Error {
  const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
  const messages: Record<string, string> = {
    "auth/invalid-credential": "Firebase rejected the email or password.",
    "auth/invalid-email": "The Firebase account email is invalid.",
    "auth/network-request-failed": "Firebase could not be reached. The local vault is unchanged.",
    "auth/operation-not-allowed":
      "Enable Email/Password sign-in in the Firebase Authentication console.",
    "auth/too-many-requests": "Firebase temporarily blocked sign-in attempts. Try again later.",
    "permission-denied": "Firestore denied access. Check the RimLib security rules.",
    unavailable: "Firestore is unavailable. The local vault is unchanged.",
  };
  return new Error(messages[code] ?? `Firebase sync failed${code ? ` (${code})` : ""}.`);
}

function isFirebaseError(error: unknown) {
  return isRecord(error) && typeof error.code === "string";
}

export async function connectFirebase(
  rawSettings: FirebaseSyncSettings,
  password: string,
): Promise<string> {
  const settings = normalizedSettings(rawSettings);
  const key = configurationKey(settings);
  try {
    if (session?.key !== key) {
      await closeSession();
    }
    if (!session) {
      let existing = getApps().find((app) => app.name === firebaseAppName);
      if (
        existing &&
        (existing.options.projectId !== settings.projectId ||
          existing.options.apiKey !== settings.apiKey ||
          existing.options.appId !== settings.appId)
      ) {
        await deleteApp(existing);
        existing = undefined;
      }
      const app =
        existing ??
        initializeApp(
          {
            apiKey: settings.apiKey,
            authDomain: settings.authDomain,
            projectId: settings.projectId,
            appId: settings.appId,
          },
          firebaseAppName,
        );
      const auth = getAuth(app);
      await setPersistence(auth, browserLocalPersistence);
      await auth.authStateReady();
      const emailMatches = auth.currentUser?.email?.toLowerCase() === settings.email.toLowerCase();
      if (!emailMatches) {
        if (!password) {
          await deleteApp(app);
          throw new Error("Enter the Firebase account password to connect this device.");
        }
        await signInWithEmailAndPassword(auth, settings.email, password);
      }
      const uid = auth.currentUser?.uid;
      if (!uid) {
        await deleteApp(app);
        throw new Error("Firebase sign-in did not produce an authenticated user.");
      }
      session = { key, app, auth, db: getFirestore(app), uid };
    }
    return session.auth.currentUser?.email ?? settings.email;
  } catch (error) {
    if (error instanceof Error && !isFirebaseError(error)) {
      throw error;
    }
    throw firebaseMessage(error);
  }
}

export async function disconnectFirebase(): Promise<void> {
  if (session) {
    await signOut(session.auth);
  }
  await closeSession();
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stateKey(active: FirebaseSession) {
  return `${syncStatePrefix}:${active.key}:${active.uid}`;
}

function loadState(active: FirebaseSession): SyncState {
  const empty: SyncState = { mods: {}, tags: {} };
  const raw = localStorage.getItem(stateKey(active));
  if (!raw) {
    return empty;
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || !isRecord(value.mods) || !isRecord(value.tags)) {
      return empty;
    }
    return value as unknown as SyncState;
  } catch {
    return empty;
  }
}

function saveState(active: FirebaseSession, state: SyncState) {
  localStorage.setItem(stateKey(active), JSON.stringify(state));
}

function localDeviceId() {
  const saved = localStorage.getItem(deviceIdKey);
  if (saved) {
    return saved;
  }
  const id = crypto.randomUUID();
  localStorage.setItem(deviceIdKey, id);
  return id;
}

function parseRemote(value: unknown): RemoteEntity {
  if (
    !isRecord(value) ||
    typeof value.entityId !== "string" ||
    !value.entityId ||
    typeof value.deleted !== "boolean" ||
    typeof value.version !== "string" ||
    (!value.deleted && typeof value.payload !== "string")
  ) {
    throw new Error("Firestore contains an invalid RimLib sync record.");
  }
  return {
    entityId: value.entityId,
    deleted: value.deleted,
    version: value.version,
    ...(typeof value.payload === "string" ? { payload: value.payload } : {}),
  };
}

async function readRemote(active: FirebaseSession, kind: EntityKind) {
  const result = new Map<string, RemoteEntity>();
  const snapshot = await getDocs(collection(active.db, "users", active.uid, kind));
  for (const item of snapshot.docs) {
    const entity = parseRemote(item.data());
    if (result.has(entity.entityId)) {
      throw new Error(`Firestore contains duplicate ${kind} records.`);
    }
    result.set(entity.entityId, entity);
  }
  return result;
}

async function planEntities<T>(
  kind: EntityKind,
  local: Map<string, T>,
  remote: Map<string, RemoteEntity>,
  previous: Record<string, EntityState>,
  parse: (value: unknown) => T,
): Promise<EntityPlan<T> & { downloaded: number }> {
  const merged = new Map(local);
  const deletedIds: string[] = [];
  const writes: EntityPlan<T>["writes"] = [];
  const state: Record<string, EntityState> = {};
  const conflicts: string[] = [];
  let downloaded = 0;
  const ids = new Set([...local.keys(), ...remote.keys(), ...Object.keys(previous)]);

  for (const id of ids) {
    const localValue = local.get(id);
    const localPayload = localValue === undefined ? undefined : canonical(localValue);
    const localHash = localPayload === undefined ? deletedHash : await digest(localPayload);
    const cloud = remote.get(id);
    const cloudHash = cloud?.deleted
      ? deletedHash
      : cloud?.payload === undefined
        ? undefined
        : await digest(cloud.payload);
    const old = previous[id];
    const equivalent = cloud !== undefined && cloudHash === localHash;

    if (!old) {
      if (!cloud && localValue !== undefined) {
        writes.push({ entityId: id, payload: localPayload, deleted: false });
      } else if (cloud && localValue === undefined && !cloud.deleted) {
        merged.set(id, parse(JSON.parse(cloud.payload ?? "null")));
        downloaded++;
      } else if (cloud && localValue !== undefined && !equivalent) {
        conflicts.push(id);
      }
    } else if (!equivalent) {
      const localChanged = localHash !== old.localHash;
      const remoteChanged = cloud?.version !== old.remoteVersion;
      if (localChanged && remoteChanged) {
        conflicts.push(id);
      } else if (remoteChanged) {
        if (!cloud) {
          conflicts.push(id);
        } else if (cloud.deleted) {
          merged.delete(id);
          deletedIds.push(id);
          downloaded++;
        } else {
          merged.set(id, parse(JSON.parse(cloud.payload ?? "null")));
          downloaded++;
        }
      } else if (localChanged) {
        writes.push({
          entityId: id,
          expectedVersion: cloud?.version,
          payload: localPayload,
          deleted: localValue === undefined,
        });
      } else {
        conflicts.push(id);
      }
    }

    const finalCloud = remote.get(id);
    const finalLocal = merged.get(id);
    const finalPayload = finalLocal === undefined ? undefined : canonical(finalLocal);
    state[id] = {
      localHash: finalPayload === undefined ? deletedHash : await digest(finalPayload),
      remoteVersion: finalCloud?.version,
    };
  }

  if (conflicts.length) {
    const examples = conflicts.slice(0, 3).join(", ");
    throw new Error(
      `Firebase found conflicting ${kind} changes (${examples}${conflicts.length > 3 ? ", …" : ""}). No cloud records were overwritten.`,
    );
  }
  return { merged, deletedIds, writes, state, downloaded };
}

async function documentId(entityId: string) {
  return digest(entityId);
}

async function applyWrites(
  active: FirebaseSession,
  kind: EntityKind,
  writes: EntityPlan<unknown>["writes"],
  state: Record<string, EntityState>,
) {
  for (const write of writes) {
    const reference = doc(active.db, "users", active.uid, kind, await documentId(write.entityId));
    const version = crypto.randomUUID();
    await runTransaction(active.db, async (transaction) => {
      const current = await transaction.get(reference);
      const actualVersion = current.exists() ? parseRemote(current.data()).version : undefined;
      if (actualVersion !== write.expectedVersion) {
        throw new Error(`A ${kind} record changed in Firebase during sync. Sync again.`);
      }
      transaction.set(reference, {
        entityId: write.entityId,
        deleted: write.deleted,
        version,
        deviceId: localDeviceId(),
        updatedAt: serverTimestamp(),
        ...(write.payload === undefined ? {} : { payload: write.payload }),
      });
    });
    const entry = state[write.entityId];
    if (entry) {
      entry.remoteVersion = version;
    }
  }
}

export async function syncFirebaseVault(vault: ModVault): Promise<FirebaseSyncResult> {
  const active = session;
  if (!active) {
    throw new Error("Connect Firebase before syncing.");
  }
  try {
    const previous = loadState(active);
    const [remoteTags, remoteMods] = await Promise.all([
      readRemote(active, "tags"),
      readRemote(active, "mods"),
    ]);
    const localTags = new Map(vault.userTags.map((tag) => [tag.id, tag]));
    const tagPlan = await planEntities(
      "tags",
      localTags,
      remoteTags,
      previous.tags,
      parsePortableTag,
    );

    const localMods = new Map(vault.mods.map((mod) => [mod.id, toPortableMod(mod)]));
    const modPlan = await planEntities(
      "mods",
      localMods,
      remoteMods,
      previous.mods,
      parsePortableMod,
    );
    for (const id of modPlan.deletedIds) {
      const mod = vault.mods.find((entry) => entry.id === id);
      const subscribedSnapshot = effectiveSubscribedIds(vault.localSteamState);
      if (mod?.subscribed || (mod?.workshopId && subscribedSnapshot.has(mod.workshopId))) {
        throw new Error(
          `Firebase wants to delete subscribed mod “${mod.name}”. Unsubscribe it first; nothing was deleted.`,
        );
      }
    }

    await applyWrites(active, "tags", tagPlan.writes, tagPlan.state);
    await applyWrites(active, "mods", modPlan.writes, modPlan.state);

    const localById = new Map(vault.mods.map((mod) => [mod.id, mod]));
    const tags = [...tagPlan.merged.values()];
    const tagIds = new Set(tags.map((tag) => tag.id));
    const mods: Mod[] = [...modPlan.merged.values()].map((portable) => {
      const merged = mergePortableMod(localById.get(portable.id), portable);
      return { ...merged, userTagIds: merged.userTagIds?.filter((id) => tagIds.has(id)) };
    });
    const nextState: SyncState = { tags: tagPlan.state, mods: modPlan.state };
    return {
      vault: { ...vault, userTags: tags, mods },
      deletedModIds: modPlan.deletedIds,
      deletedTagIds: tagPlan.deletedIds,
      uploaded: tagPlan.writes.length + modPlan.writes.length,
      downloaded: tagPlan.downloaded + modPlan.downloaded,
      commitState: () => {
        saveState(active, nextState);
      },
    };
  } catch (error) {
    if (error instanceof Error && !isFirebaseError(error)) {
      throw error;
    }
    throw firebaseMessage(error);
  }
}
