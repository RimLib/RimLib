export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireValue<T>(
  value: T | null | undefined,
  message = "Required value is missing",
): T {
  if (value === undefined || value === null) {
    throw new Error(message);
  }
  return value;
}

export function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === "string" ? error.code : undefined;
}
