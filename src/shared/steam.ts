export const RIMWORLD_APP_ID = 294100;
export const maxSteamAccountId = 0xffffffff;
export const steamResultCodes = Object.freeze({ ok: 1 });
export const publishedFileDetailsUrl =
  "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";

export function isSteamWorkshopId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,19}$/.test(value);
}

export function createSteamWorkshopUrl(workshopId: string): string {
  if (!isSteamWorkshopId(workshopId)) {
    throw new Error("Invalid Steam Workshop ID.");
  }
  return `https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`;
}

export function getModWorkshopId(mod: { workshopId?: string; url?: string }): string | undefined {
  if (isSteamWorkshopId(mod.workshopId)) {
    return mod.workshopId;
  }
  if (!mod.url) {
    return undefined;
  }
  try {
    const url = new URL(mod.url);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.hostname !== "steamcommunity.com" ||
      !/^\/sharedfiles\/filedetails\/?$/.test(url.pathname) ||
      url.username ||
      url.password ||
      url.port
    ) {
      return undefined;
    }
    const id = url.searchParams.get("id");
    return isSteamWorkshopId(id) ? id : undefined;
  } catch {
    return undefined;
  }
}
