import { execFile } from "node:child_process";
import { basename, win32 } from "node:path";
import { promisify } from "node:util";

import type { SteamStatus } from "../shared/types";
import { log } from "./logging";
import { platforms, processLimits } from "./platformConstants";

const execute = promisify(execFile);
type ProcessReader = (
  command: string,
  args: string[],
  options: { timeout: number; maxBuffer: number; windowsHide: boolean },
) => Promise<{ stdout: string }>;

export function hasSteamProcess(output: string, platform: NodeJS.Platform): boolean {
  const executable =
    platform === platforms.windows
      ? "steam.exe"
      : platform === platforms.macOS
        ? "steam_osx"
        : "steam";
  return output.split(/\r?\n/).some((line) => {
    const command =
      platform === platforms.windows ? line.trim().replace(/^"([^"\n]+)".*$/, "$1") : line.trim();
    return (
      (platform === platforms.windows
        ? win32.basename(command)
        : basename(command)
      ).toLowerCase() === executable
    );
  });
}

// Checking processes does not initialize the SDK, launch Steam, or touch the library.
export async function getSteamStatus(
  platform = process.platform,
  readProcesses: ProcessReader = execute,
): Promise<SteamStatus> {
  try {
    const { stdout } = await readProcesses(
      platform === platforms.windows ? "tasklist" : "ps",
      platform === platforms.windows
        ? ["/FI", "IMAGENAME eq steam.exe", "/FO", "CSV", "/NH"]
        : ["-A", "-o", "comm="],
      {
        timeout: processLimits.steamCheckTimeoutMs,
        maxBuffer: processLimits.maxOutputBytes,
        windowsHide: true,
      },
    );
    return hasSteamProcess(stdout, platform)
      ? { running: true }
      : { running: false, error: "Start Steam and sign in before changing mod subscriptions." };
  } catch (error) {
    log.warn("steam.availability.failed", { platform, error });
    return {
      running: false,
      error: "Cannot check whether Steam is running. Start Steam and try again.",
    };
  }
}

export async function assertSteamRunning(
  probe: () => Promise<SteamStatus> = getSteamStatus,
): Promise<void> {
  const status = await probe();
  if (!status.running) {
    throw new Error(status.error ?? "Start Steam before changing mod subscriptions.");
  }
}
