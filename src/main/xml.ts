import { XMLParser } from "fast-xml-parser";
import { SyntaxValidator } from "fast-xml-validator";

import { bytesPerMiB } from "../shared/limits";
import { isRecord } from "../shared/validation";

const maxXmlSize = 10 * bytesPerMiB;
const xmlNodeKeys = Object.freeze({ comment: "#comment", text: "#text", listItem: "li" });

export function parseXml(text: string): Record<string, unknown> {
  if (text.length > maxXmlSize || /<!DOCTYPE|<!ENTITY/i.test(text)) {
    throw new Error("Unsupported XML document.");
  }
  try {
    SyntaxValidator.validate(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid XML: ${message}`, { cause: error });
  }
  const parsed: unknown = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    parseAttributeValue: false,
    commentPropName: xmlNodeKeys.comment,
    isArray: (name) => name === xmlNodeKeys.listItem,
  }).parse(text);
  if (!isRecord(parsed)) {
    throw new Error("Invalid XML document root.");
  }
  return parsed;
}

export function xmlRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function xmlText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (isRecord(value)) {
    return xmlText(value[xmlNodeKeys.text]);
  }
  return undefined;
}

export function xmlList(value: unknown): string[] {
  const array = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return array.map(xmlText).filter((entry): entry is string => Boolean(entry));
}
