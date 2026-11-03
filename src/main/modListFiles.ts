import { realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { withReadTimeout } from "../shared/async";
import { modListLimits } from "../shared/limits";
import { getOfficialContent, rimWorldOfficialContent } from "../shared/officialContent";
import { isUsablePackageId, normalizePackageId, rimWorldPackages } from "../shared/packages";
import { errorCode, isRecord } from "../shared/validation";
import { readBoundedUtf8File } from "./fileReads";
import { atomicWrite } from "./vaultStore";
import { parseXml } from "./xml";

export interface RimWorldModList {
  version: string;
  activeMods: string[];
  knownExpansions: string[];
}

export interface RimWorldModListInput {
  version: string;
  activeMods: readonly string[];
  knownExpansions?: readonly string[];
}

interface ModListFileDependencies {
  readText: (path: string, maxBytes: number) => Promise<string>;
  writeText: typeof atomicWrite;
  realpath: typeof realpath;
  stat: typeof stat;
}

export interface ExportModListFileOptions extends Partial<
  Pick<ModListFileDependencies, "readText" | "writeText" | "realpath" | "stat">
> {
  /** Live ModsConfig.xml paths, none of which may ever be used as an export target. */
  liveConfigPaths?: readonly string[];
  readTimeoutMs?: number;
  /** Test seam; production defaults to conservative platform filesystem semantics. */
  caseInsensitivePaths?: boolean;
}

export interface ImportModListFileOptions extends Partial<
  Pick<ModListFileDependencies, "readText">
> {
  readTimeoutMs?: number;
}

export const maxModListFileBytes = modListLimits.maxFileBytes;
export const maxModListEntries = modListLimits.maxEntries;

const maxKnownExpansions = 128;
const xmlKeys = Object.freeze({ comment: "#comment", text: "#text" });
const gameVersionPattern = /^\d+(?:\.\d+){1,3}(?:\s+[a-z0-9][a-z0-9._+-]*)*$/i;
const defaultKnownExpansions = Object.freeze(
  rimWorldOfficialContent
    .filter((content) => content.kind === "dlc")
    .map((content) => content.packageId),
);

function invalidDocument(message: string): Error {
  return new Error(`Invalid RimWorld mod list: ${message}`);
}

function assertOnlyKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedKeys = new Set([...allowed, xmlKeys.comment]);
  const unexpected = Object.keys(record).find((key) => !allowedKeys.has(key));
  if (unexpected !== undefined) {
    throw invalidDocument(`${label} contains an unsupported element or attribute (${unexpected}).`);
  }
}

function requireSingleElement(record: Record<string, unknown>, key: string): unknown {
  if (!Object.hasOwn(record, key)) {
    throw invalidDocument(`${key} is missing.`);
  }
  const value = record[key];
  if (Array.isArray(value)) {
    throw invalidDocument(`${key} must occur exactly once.`);
  }
  return value;
}

function requireLeafText(value: unknown, label: string): string {
  if (typeof value === "string") {
    const text = value.trim();
    if (text) {
      return text;
    }
  }
  if (isRecord(value)) {
    assertOnlyKeys(value, [xmlKeys.text], label);
    const text = value[xmlKeys.text];
    if (typeof text === "string" && text.trim()) {
      return text.trim();
    }
  }
  throw invalidDocument(`${label} must contain plain, non-empty text.`);
}

function strictList(value: unknown, label: string, maximum: number): string[] {
  if (value === "") {
    return [];
  }
  if (!isRecord(value)) {
    throw invalidDocument(`${label} must be a list element.`);
  }
  assertOnlyKeys(value, ["li"], label);
  if (!Object.hasOwn(value, "li")) {
    return [];
  }
  const items = value.li;
  if (!Array.isArray(items)) {
    // parseXml deliberately represents every <li> as an array. Requiring that
    // representation prevents a malformed scalar from being silently accepted.
    throw invalidDocument(`${label} contains an unreadable list item.`);
  }
  if (items.length > maximum) {
    throw invalidDocument(`${label} contains too many entries (maximum ${maximum}).`);
  }
  return items.map((item, index) => requireLeafText(item, `${label} item ${index + 1}`));
}

function validateVersion(value: unknown): string {
  const version = requireLeafText(value, "version");
  if (version.length > modListLimits.maxVersionLength || !gameVersionPattern.test(version)) {
    throw invalidDocument("version is not a valid RimWorld version.");
  }
  return version;
}

function validatePackageIds(
  values: readonly string[],
  label: string,
  options: { requireCore?: boolean; expansions?: boolean } = {},
): string[] {
  const packageIds = values.map((value) => value.trim());
  if (
    packageIds.some(
      (packageId) =>
        packageId.length > modListLimits.maxPackageIdLength || !isUsablePackageId(packageId),
    )
  ) {
    throw invalidDocument(`${label} contains an invalid package identifier.`);
  }

  const normalized = packageIds.map(normalizePackageId);
  if (
    packageIds.some(
      (packageId) => /_steam$/i.test(packageId) && getOfficialContent(packageId) !== undefined,
    )
  ) {
    throw invalidDocument(`${label} cannot select a Workshop copy of official RimWorld content.`);
  }
  const coreCount = normalized.filter((packageId) => packageId === rimWorldPackages.core).length;
  if (options.requireCore && coreCount !== 1) {
    throw invalidDocument("activeMods must contain the RimWorld Core package exactly once.");
  }
  if (new Set(normalized).size !== normalized.length) {
    throw invalidDocument(`${label} contains duplicate package identifiers.`);
  }
  if (
    options.expansions &&
    normalized.some(
      (packageId) =>
        packageId === rimWorldPackages.core || !packageId.startsWith(`${rimWorldPackages.core}.`),
    )
  ) {
    throw invalidDocument("knownExpansions contains a non-expansion package identifier.");
  }
  return packageIds;
}

function validateModList(input: RimWorldModListInput): RimWorldModList {
  const version = validateVersion(input.version);
  if (input.activeMods.length > maxModListEntries) {
    throw invalidDocument(`activeMods contains too many entries (maximum ${maxModListEntries}).`);
  }
  const suppliedExpansions = input.knownExpansions ?? defaultKnownExpansions;
  if (suppliedExpansions.length > maxKnownExpansions) {
    throw invalidDocument(
      `knownExpansions contains too many entries (maximum ${maxKnownExpansions}).`,
    );
  }
  const activeMods = validatePackageIds(input.activeMods, "activeMods", { requireCore: true });
  const knownExpansions = validatePackageIds(suppliedExpansions, "knownExpansions", {
    expansions: true,
  });
  return { version, activeMods, knownExpansions };
}

function validateXmlDeclaration(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw invalidDocument("the XML declaration is malformed.");
  }
  assertOnlyKeys(value, ["@_version", "@_encoding", "@_standalone"], "the XML declaration");
  if (value["@_version"] !== "1.0") {
    throw invalidDocument("only XML version 1.0 is supported.");
  }
  const encoding = value["@_encoding"];
  if (encoding !== undefined && (typeof encoding !== "string" || !/^utf-?8$/i.test(encoding))) {
    throw invalidDocument("only UTF-8 XML is supported.");
  }
}

export function parseRimWorldModListXml(xml: string): RimWorldModList {
  const withoutBom = xml.startsWith("\uFEFF") ? xml.slice(1) : xml;
  if (Buffer.byteLength(withoutBom, "utf8") > maxModListFileBytes) {
    throw invalidDocument(`the file is too large (maximum ${maxModListFileBytes} bytes).`);
  }

  const document = parseXml(withoutBom);
  assertOnlyKeys(document, ["?xml", "ModsConfigData"], "the document");
  validateXmlDeclaration(document["?xml"]);
  const root = requireSingleElement(document, "ModsConfigData");
  if (!isRecord(root)) {
    throw invalidDocument("ModsConfigData must be the document root.");
  }
  assertOnlyKeys(root, ["version", "activeMods", "knownExpansions"], "ModsConfigData");

  const version = validateVersion(requireSingleElement(root, "version"));
  const activeMods = strictList(
    requireSingleElement(root, "activeMods"),
    "activeMods",
    maxModListEntries,
  );
  const knownExpansions = strictList(
    requireSingleElement(root, "knownExpansions"),
    "knownExpansions",
    maxKnownExpansions,
  );
  return validateModList({ version, activeMods, knownExpansions });
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function renderList(name: string, entries: readonly string[]): string[] {
  if (entries.length === 0) {
    return [`  <${name}>`, `  </${name}>`];
  }
  return [
    `  <${name}>`,
    ...entries.map((entry) => `    <li>${escapeXmlText(entry)}</li>`),
    `  </${name}>`,
  ];
}

export function renderRimWorldModListXml(input: RimWorldModListInput): string {
  const modList = validateModList(input);
  const activeMods = modList.activeMods.map((packageId) => packageId.toLowerCase());
  const knownExpansions = modList.knownExpansions.map((packageId) => packageId.toLowerCase());
  const xml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<ModsConfigData>",
    `  <version>${escapeXmlText(modList.version)}</version>`,
    ...renderList("activeMods", activeMods),
    ...renderList("knownExpansions", knownExpansions),
    "</ModsConfigData>",
    "",
  ].join("\n");
  if (Buffer.byteLength(xml, "utf8") > maxModListFileBytes) {
    throw invalidDocument(`the rendered file is too large (maximum ${maxModListFileBytes} bytes).`);
  }
  return xml;
}

const readBoundedModList = (path: string, maxBytes: number) =>
  readBoundedUtf8File(path, maxBytes, "The selected mod list");

function requireAbsolutePath(path: string): void {
  if (!path.trim() || !isAbsolute(path)) {
    throw new Error("A valid absolute mod-list file path is required.");
  }
}

export function requireXmlExtension(path: string): string {
  requireAbsolutePath(path);
  if (!/\.xml$/i.test(path)) {
    throw new Error("Choose an export file name ending in .xml.");
  }
  return path;
}

async function canonicalPotentialPath(
  path: string,
  resolveRealpath: typeof realpath,
): Promise<string> {
  try {
    return await resolveRealpath(path);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
    let parent = resolve(dirname(path));
    try {
      parent = await resolveRealpath(parent);
    } catch (parentError) {
      if (errorCode(parentError) !== "ENOENT") {
        throw parentError;
      }
    }
    return join(parent, basename(path));
  }
}

async function optionalIdentity(path: string, getStat: typeof stat) {
  try {
    const metadata = await getStat(path);
    return { device: metadata.dev, inode: metadata.ino };
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

/**
 * Prevents a standalone export from bypassing the guarded ModsConfig.xml writer.
 * Real paths catch symlink aliases and device/inode identity catches hard links.
 */
export async function assertSafeModListExportTarget(
  targetPath: string,
  liveConfigPath: string,
  dependencies: Partial<Pick<ModListFileDependencies, "realpath" | "stat">> & {
    readTimeoutMs?: number;
    caseInsensitivePaths?: boolean;
  } = {},
): Promise<void> {
  requireAbsolutePath(targetPath);
  requireAbsolutePath(liveConfigPath);
  const resolveRealpath = dependencies.realpath ?? realpath;
  const getStat = dependencies.stat ?? stat;
  const [targetCanonical, configCanonical, targetIdentity, configIdentity] = await withReadTimeout(
    Promise.all([
      canonicalPotentialPath(targetPath, resolveRealpath),
      canonicalPotentialPath(liveConfigPath, resolveRealpath),
      optionalIdentity(targetPath, getStat),
      optionalIdentity(liveConfigPath, getStat),
    ]),
    "Checking the export destination timed out. Choose a connected local filesystem location and try again.",
    dependencies.readTimeoutMs,
  );
  const caseInsensitivePaths =
    dependencies.caseInsensitivePaths ?? ["darwin", "win32"].includes(process.platform);
  const sameCanonicalPath = caseInsensitivePaths
    ? targetCanonical.toLowerCase() === configCanonical.toLowerCase()
    : targetCanonical === configCanonical;
  let sameIdentity = false;
  if (targetIdentity !== undefined && configIdentity !== undefined) {
    sameIdentity =
      targetIdentity.device === configIdentity.device &&
      targetIdentity.inode === configIdentity.inode;
  }
  if (sameCanonicalPath || sameIdentity) {
    throw new Error(
      "Choose a standalone export file. RimLib will not overwrite the live ModsConfig.xml through the export workflow.",
    );
  }
}

export async function importRimWorldModListFile(
  path: string,
  options: ImportModListFileOptions = {},
): Promise<RimWorldModList> {
  requireAbsolutePath(path);
  const xml = await withReadTimeout(
    (options.readText ?? readBoundedModList)(path, maxModListFileBytes),
    "Reading the selected mod-list XML timed out. Choose a local file or wait for cloud storage to finish downloading it.",
    options.readTimeoutMs,
  );
  return parseRimWorldModListXml(xml);
}

export async function exportRimWorldModListFile(
  path: string,
  input: RimWorldModListInput,
  options: ExportModListFileOptions = {},
): Promise<string> {
  const outputPath = requireXmlExtension(path);
  const liveConfigPaths = options.liveConfigPaths ?? [];
  for (const liveConfigPath of liveConfigPaths) {
    await assertSafeModListExportTarget(outputPath, liveConfigPath, options);
  }
  const xml = renderRimWorldModListXml(input);
  const readText = options.readText ?? readBoundedModList;
  let expected: string | undefined;
  try {
    expected = await withReadTimeout(
      readText(outputPath, maxModListFileBytes),
      "Reading the existing export timed out. Choose a connected local filesystem location and try again.",
      options.readTimeoutMs,
    );
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  }
  try {
    await (options.writeText ?? atomicWrite)(outputPath, xml, {
      expected,
      // Re-resolve at the atomic writer's commit boundary. This catches a parent-directory symlink
      // swap after the dialog and initial check; the guarded writer restores a claimed target
      // before surfacing the error.
      beforePublish: async (claimedPath) => {
        for (const liveConfigPath of liveConfigPaths) {
          await assertSafeModListExportTarget(claimedPath ?? outputPath, liveConfigPath, options);
        }
      },
    });
  } catch (error) {
    if (["ENOTSUP", "EOPNOTSUPP", "EXDEV"].includes(errorCode(error) ?? "")) {
      throw new Error(
        "This destination does not support RimLib's safe atomic XML export. Choose a local filesystem location and try again.",
        { cause: error },
      );
    }
    throw error;
  }
  return outputPath;
}
