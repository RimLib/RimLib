import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";

import { ipcChannels } from "../../src/shared/ipc";
import { createSteamWorkshopUrl } from "../../src/shared/steam";
import { sampleMods, sampleTags } from "./data";
import { expect, test } from "./fixtures";

test("Finder and browser actions use the correct target and recover from failures", async ({
  desktop,
}) => {
  await desktop.row(desktop.subscribed, sampleMods.spare.name).locator(".mod-row-main").click();
  await desktop.info.getByRole("link", { name: "Open mod folder" }).click();
  await expect
    .poll(() => desktop.calls("reveal"))
    .toEqual([{ kind: "reveal", value: join(desktop.workshop, sampleMods.spare.id) }]);
  await desktop.info.getByRole("link", { name: "Steam Workshop" }).click();
  await expect
    .poll(() => desktop.calls("openExternal"))
    .toEqual([{ kind: "openExternal", value: createSteamWorkshopUrl(sampleMods.spare.id) }]);
  await desktop.setControls({ shellError: "Simulated operating system error" });
  await desktop.info.getByRole("link", { name: "Open mod folder" }).click();
  await expect(desktop.page.getByRole("alert")).toContainText("Simulated operating system error");
  await expect(desktop.info.getByRole("link", { name: "Open mod folder" })).toBeEnabled();
  await desktop.info.getByRole("link", { name: "Steam Workshop" }).click();
  await expect(desktop.page.getByRole("alert")).toContainText("Action failed");
  await desktop.library.getByRole("textbox", { name: "Search library mods" }).fill("Voice");
  await expect(desktop.library.getByRole("listitem")).toHaveCount(1);
});

test("a missing mod folder reports an error instead of breaking the info panel", async ({
  desktop,
}) => {
  await desktop.row(desktop.library, sampleMods.camera.name).locator(".mod-row-main").click();
  await desktop.info.getByRole("link", { name: "Open mod folder" }).click();
  await expect(desktop.page.getByRole("alert")).toContainText("mod folder was not found");
  await expect(desktop.info.getByRole("link", { name: "Open mod folder" })).toBeEnabled();
  expect(await desktop.calls("reveal")).toEqual([]);
  await desktop.info.getByRole("checkbox", { name: sampleTags.combat.name }).check();
  await expect
    .poll(async () => (await desktop.mod(sampleMods.camera.id)).userTagIds)
    .toContain(sampleTags.combat.id);
});

test("refreshes public metadata for an unsubscribed mod without Steam or local content", async ({
  desktop,
}) => {
  const before = await desktop.mod(sampleMods.weapons.id);
  await desktop.setControls({ steamRunning: false });
  await desktop.row(desktop.library, sampleMods.weapons.name).locator(".mod-row-main").click();
  await expect(desktop.info.locator(".mod-visual svg")).toBeVisible();
  await desktop.info.getByRole("button", { name: "Refresh mod metadata" }).click();
  await expect(desktop.infoName).toHaveText(`Workshop refreshed ${sampleMods.weapons.id}`);
  const refreshed = await desktop.mod(sampleMods.weapons.id);
  expect(refreshed).toMatchObject({
    packageId: before.packageId,
    author: before.author,
    notes: before.notes,
    userTagIds: before.userTagIds,
    subscribed: false,
    addedAt: before.addedAt,
    downloadedAt: before.downloadedAt,
    thumbnail: `https://e2e.invalid/previews/${sampleMods.weapons.id}.png`,
  });
  expect(refreshed.metadataUpdatedAt).toBeTruthy();
  expect((await desktop.calls("metadata")).at(-1)?.value).toContain(
    `publishedfileids%5B0%5D=${sampleMods.weapons.id}`,
  );
  expect(await desktop.calls("subscribe")).toEqual([]);
});

test("failed metadata refresh retains the previous data and can be retried", async ({
  desktop,
}) => {
  await desktop.row(desktop.library, sampleMods.weapons.name).locator(".mod-row-main").click();
  const before = await desktop.mod(sampleMods.weapons.id);
  await desktop.setControls({ metadataStatus: 503 });
  await desktop.info.getByRole("button", { name: "Refresh mod metadata" }).click();
  await expect(desktop.page.getByRole("alert")).toContainText("HTTP 503");
  expect(await desktop.mod(sampleMods.weapons.id)).toEqual(before);
  await expect(desktop.info.getByRole("button", { name: "Refresh mod metadata" })).toBeEnabled();
  await desktop.setControls({ metadataStatus: 200 });
  await desktop.info.getByRole("button", { name: "Refresh mod metadata" }).click();
  await expect(desktop.infoName).toHaveText(`Workshop refreshed ${sampleMods.weapons.id}`);
});

test("settings browse, auto-detect, access test and folder shortcuts use isolated paths", async ({
  desktop,
}) => {
  await desktop.page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = desktop.page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog.getByRole("textbox", { name: "Workshop mods folder path" })).toHaveValue(
    desktop.workshop,
  );
  await dialog.getByRole("button", { name: "Browse", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "RimWorld ModsConfig.xml path" })).toHaveValue(
    desktop.config,
  );
  await desktop.setControls({ cancelDialog: true });
  await dialog.getByRole("button", { name: "Browse Workshop folder", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Workshop mods folder path" })).toHaveValue(
    desktop.workshop,
  );
  await desktop.setControls({ cancelDialog: false });
  await dialog.getByRole("button", { name: "Auto-detect Workshop folder" }).click();
  await dialog.getByRole("button", { name: "Test Workshop folder access" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Folder is readable");
  await dialog.getByRole("button", { name: "Open database folder" }).click();
  await dialog.getByRole("button", { name: "Open logs", exact: true }).click();
  await expect
    .poll(async () => (await desktop.calls("openPath")).map((call) => call.value))
    .toEqual([join(desktop.root, "user-data"), join(desktop.root, "logs")]);
  await dialog.getByRole("button", { name: "Save settings" }).click();
  await expect(dialog).toHaveCount(0);
  expect((await desktop.vault()).settings).toMatchObject({
    workshopModsPath: desktop.workshop,
    rimWorldConfigPath: desktop.config,
  });
});

test("invalid settings paths report errors and allow correction", async ({ desktop }) => {
  await desktop.page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = desktop.page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog
    .getByRole("textbox", { name: "Workshop mods folder path" })
    .fill(join(desktop.root, "missing", "294100"));
  await dialog.getByRole("button", { name: "Test Workshop folder access" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Folder not found");
  await expect(dialog.getByRole("button", { name: "Save settings" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Save settings" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Folder not found");
  expect((await desktop.vault()).settings?.workshopModsPath).toBe(desktop.workshop);
  await dialog.getByRole("textbox", { name: "Workshop mods folder path" }).fill(desktop.workshop);
  await dialog.getByRole("button", { name: "Save settings" }).click();
  await expect(dialog).toHaveCount(0);
});

test("failed sync preserves all records and unlocks controls", async ({ desktop }) => {
  const before = await desktop.vault();
  await desktop.setControls({
    ipcErrors: { [ipcChannels.syncSubscribedMods]: "Simulated disconnected disk" },
  });
  await desktop.page.getByRole("button", { name: "Sync Workshop", exact: true }).click();
  await expect(desktop.page.getByRole("alert")).toContainText("Simulated disconnected disk");
  expect((await desktop.vault()).mods).toEqual(before.mods);
  await expect(
    desktop.page.getByRole("button", { name: "Sync Workshop", exact: true }),
  ).toBeEnabled();
  await desktop.page.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(desktop.page.getByRole("alert")).toHaveCount(0);
});

test.describe("Disconnected Workshop drive", () => {
  test.use({ scenario: "disconnected" });
  test("startup retains saved status, disables cleanup and recovers on reconnection", async ({
    desktop,
  }) => {
    const before = await readFile(desktop.database, "utf8");
    await expect(desktop.page.getByText("Workshop unavailable", { exact: true })).toBeVisible();
    await expect(
      desktop.page.getByText("Active status could not be fully verified. Cleanup is disabled.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(desktop.subscribed.getByRole("listitem")).toHaveCount(4);
    await expect(
      desktop.page
        .locator("header")
        .getByRole("button", { name: "Unsubscribe all non-active mods" }),
    ).toBeDisabled();
    await desktop.library.getByRole("textbox", { name: "Search library mods" }).fill("Camera");
    await expect(desktop.library.getByRole("listitem")).toHaveCount(1);
    expect(await readFile(desktop.database, "utf8")).toBe(before);
    await rename(`${desktop.workshop}-disconnected`, desktop.workshop);
    await desktop.page.getByRole("button", { name: "Sync Workshop", exact: true }).click();
    await expect(
      desktop.page
        .locator("header")
        .getByRole("button", { name: "Unsubscribe all non-active mods" }),
    ).toBeEnabled();
    expect((await desktop.vault()).mods).toHaveLength(8);
  });
});
