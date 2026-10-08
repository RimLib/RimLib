export function modImageUrl(value?: string, refreshedAt?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      return undefined;
    }
    const steamImage =
      url.hostname === "steamusercontent.com" ||
      url.hostname.endsWith(".steamusercontent.com") ||
      url.hostname === "steamuserimages-a.akamaihd.net";
    if (steamImage) {
      url.protocol = "https:";
      if (refreshedAt) {
        url.searchParams.set("modvault_refresh", refreshedAt);
      }
    }
    return url.href;
  } catch {
    return undefined;
  }
}
