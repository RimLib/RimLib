export function errorMessage(error: unknown): string {
  const fallback = "The action could not be completed. Please try again.";
  try {
    const message =
      error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
    return (
      message
        .replace(/^(?:Error:\s*)?Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "")
        .trim() || fallback
    );
  } catch {
    return fallback;
  }
}
