import type { Mod } from "../../../shared/types";

export function createId(prefix: string): string {
  return `${prefix}-${window.crypto.randomUUID()}`;
}

export function formatDate(value: string): string {
  if (!Number.isFinite(Date.parse(value))) {
    return "Unknown";
  }
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

export function getModHue(mod: Mod): string {
  const palette = ["teal", "amber", "blue", "rose", "violet", "green"] as const;
  const sum = mod.name.split("").reduce((total, char) => total + char.charCodeAt(0), 0);
  return palette[sum % palette.length] ?? palette[0];
}
