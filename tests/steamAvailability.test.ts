import assert from "node:assert/strict";
import { test } from "node:test";

import { assertSteamRunning, getSteamStatus, hasSteamProcess } from "../src/main/steamAvailability";
import { requireValue } from "../src/shared/validation";

void test("Steam detection recognizes the client executable on macOS, Linux and Windows", () => {
  assert.equal(
    hasSteamProcess("/sbin/launchd\n/Applications/Steam.app/Contents/MacOS/steam_osx\n", "darwin"),
    true,
  );
  assert.equal(hasSteamProcess("/usr/bin/steam\n", "linux"), true);
  assert.equal(hasSteamProcess('"Steam.exe","5432","Console","1","20,000 K"\r\n', "win32"), true);
});

void test("helpers, SteamCMD, paths containing Steam and unrelated processes cannot report Steam as running", () => {
  assert.equal(
    hasSteamProcess(
      "steamwebhelper\nsteamcmd\n/Applications/Steam.app/helper\nsteam_osx_helper",
      "darwin",
    ),
    false,
  );
  assert.equal(
    hasSteamProcess("steamwebhelper\nsteamcmd\n/home/steam/game\nnot-steam", "linux"),
    false,
  );
  assert.equal(
    hasSteamProcess(
      '"steamwebhelper.exe","1"\n"steamcmd.exe","2"\nINFO: No tasks are running which match the specified criteria.',
      "win32",
    ),
    false,
  );
  assert.equal(hasSteamProcess("", "darwin"), false);
});

void test("the availability check is a bounded, read-only process query independent of mod folders", async () => {
  const status = await getSteamStatus("darwin", async (command, args, options) => {
    assert.equal(command, "ps");
    assert.deepEqual(args, ["-A", "-o", "comm="]);
    assert.equal(options.timeout, 5000);
    assert.equal(options.maxBuffer, 4 * 1024 * 1024);
    return { stdout: "/Applications/Steam.app/Contents/MacOS/steam_osx" };
  });
  assert.deepEqual(status, { running: true });
  assert.deepEqual(
    await getSteamStatus("win32", async (command, args, options) => {
      assert.equal(command, "tasklist");
      assert.deepEqual(args, ["/FI", "IMAGENAME eq steam.exe", "/FO", "CSV", "/NH"]);
      assert.equal(options.windowsHide, true);
      return { stdout: '"steam.exe","1","Console","1","1 K"' };
    }),
    { running: true },
  );
});

void test("closed Steam and process query errors produce usable status rather than rejected background work", async () => {
  const closed = await getSteamStatus("linux", async () => ({ stdout: "node\nsteamwebhelper" }));
  assert.equal(closed.running, false);
  assert.match(requireValue(closed.error), /Start Steam and sign in/);
  const failed = await getSteamStatus("darwin", async () => {
    throw new Error("process query timed out");
  });
  assert.equal(failed.running, false);
  assert.match(requireValue(failed.error), /Cannot check whether Steam is running/);
});

void test("the native guard rejects closed Steam before running an action and allows retry when it starts", async () => {
  let running = false;
  let invoked = false;
  const action = async () => {
    await assertSteamRunning(async () => ({
      running,
      error: running ? undefined : "Start Steam first",
    }));
    invoked = true;
  };
  await assert.rejects(action(), /Start Steam first/);
  assert.equal(invoked, false);
  running = true;
  await action();
  assert.equal(invoked, true);
  await assert.rejects(
    assertSteamRunning(async () => ({ running: false })),
    /Start Steam/,
  );
});
