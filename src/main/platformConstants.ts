import { bytesPerMiB } from "../shared/limits";

export const platforms = Object.freeze({
  macOS: "darwin",
  windows: "win32",
  linux: "linux",
} as const);
export const fileErrorCodes = Object.freeze({
  notFound: "ENOENT",
  notDirectory: "ENOTDIR",
  accessDenied: "EACCES",
  notPermitted: "EPERM",
} as const);
export const privateFileMode = 0o600;
export const privateDirectoryMode = 0o700;

export const processLimits = Object.freeze({
  steamCheckTimeoutMs: 5_000,
  gameCheckTimeoutMs: 10_000,
  maxOutputBytes: 4 * bytesPerMiB,
});
export const windowDefaults = Object.freeze({
  width: 1500,
  height: 930,
  minWidth: 1180,
  minHeight: 720,
});
