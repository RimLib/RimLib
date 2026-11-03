import { readdir, readFile, rename } from "node:fs/promises";
import { join } from "node:path";

import { parseRimWorldModListXml } from "../../src/main/modListFiles";
import { ipcChannels } from "../../src/shared/ipc";
import { createSteamWorkshopUrl } from "../../src/shared/steam";
import { initialActivePackages, sampleMods, sampleTags } from "./data";
import { expect, test } from "./fixtures";

test("Finder and browser actions use the correct target and recover from failures", async ({
  desktop,
}) => {
  await desktop.row(desktop.library, sampleMods.spare.name).locator(".mod-row-main").click();
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
  await desktop.row(desktop.subscribed, sampleMods.camera.name).locator(".mod-row-main").click();
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
  await expect
    .poll(async () => {
      const mod = await desktop.mod(sampleMods.other.id);
      return { gameVersions: mod.gameVersions, localPath: mod.localPath };
    })
    .toEqual({
      gameVersions: ["1.6"],
      localPath: join(desktop.workshop, sampleMods.other.id),
    });
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

test("partial Workshop metadata sync warns the user and writes actionable diagnostics", async ({
  desktop,
}) => {
  const before = await desktop.mod(sampleMods.active.id);
  await desktop.setControls({ metadataOmitIds: [sampleMods.active.id] });

  await desktop.page.getByRole("button", { name: "Sync Workshop", exact: true }).click();

  const warning = desktop.page.getByRole("alert");
  await expect(warning).toContainText("Sync completed with warnings");
  await expect(warning).toContainText(sampleMods.active.id);
  await expect(warning).toContainText("Existing metadata was preserved");
  await expect(desktop.page.getByText("Workshop unavailable", { exact: true })).toHaveCount(0);
  expect(await desktop.mod(sampleMods.active.id)).toMatchObject({
    name: before.name,
    summary: before.summary,
    packageId: before.packageId,
  });
  await expect
    .poll(async () => {
      const files = await readdir(join(desktop.root, "logs"));
      const logs = await Promise.all(
        files.map((name) => readFile(join(desktop.root, "logs", name), "utf8")),
      );
      return logs.join("\n");
    })
    .toContain("steam.metadata.mod.unavailable");
});

test("installed metadata failures stay idle until Sync Workshop retries them", async ({
  desktop,
}) => {
  await desktop.setControls({
    ipcErrors: { [ipcChannels.getInstalledMods]: "Simulated installed metadata failure" },
  });
  await desktop.reopen();

  const list = desktop.active.getByRole("list");
  const core = desktop.row(desktop.active, "Core");
  const exportModList = desktop.page.getByRole("button", {
    name: "Export mod list",
    exact: true,
  });
  const importModList = desktop.page.getByRole("button", {
    name: "Import mod list",
    exact: true,
  });
  await expect(desktop.row(desktop.active, sampleMods.camera.name)).toBeVisible();
  await expect(core).toBeVisible();
  await expect(list).toHaveAttribute("aria-busy", "false");
  await expect(desktop.active.getByText("Mod details unavailable", { exact: true })).toBeVisible();
  await expect(
    desktop.page.getByText("Auto-sort is unavailable until installed mod details can be read.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    desktop.page.locator("header").getByRole("button", { name: "Unsubscribe all non-active mods" }),
  ).toBeEnabled();
  await expect(desktop.active.locator("button.auto-sort-action")).toBeDisabled();
  await expect(importModList).toHaveAttribute("aria-disabled", "false");
  await expect(exportModList).toHaveAttribute("aria-disabled", "false");
  await expect(core.locator(".thumb")).not.toHaveClass(/has-image/);

  await importModList.click();
  const importPreview = desktop.page.getByRole("dialog", {
    name: "Load RimWorld mod list",
    exact: true,
  });
  await expect(importPreview).toBeVisible();
  await importPreview
    .getByRole("button", { name: "Stage 4 available mods only", exact: true })
    .click();
  await expect(desktop.page.locator(".draft-bar")).toContainText("4 pending changes");
  await desktop.page
    .locator(".draft-bar")
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await expect(desktop.page.locator(".draft-bar")).toContainText("0 pending changes");

  await exportModList.click();
  await expect(
    desktop.page.getByRole("status").filter({ hasText: "Exported 4 mods" }),
  ).toContainText("installed-copy hints were omitted");
  expect(parseRimWorldModListXml(await readFile(desktop.modListExport, "utf8")).activeMods).toEqual(
    initialActivePackages,
  );

  const failedReads = (await desktop.calls("ipc")).filter(
    (call) => call.value === ipcChannels.getInstalledMods,
  ).length;
  const configurationReads = (await desktop.calls("ipc")).filter(
    (call) => call.value === ipcChannels.getActiveModConfiguration,
  ).length;
  await desktop.setControls({
    ipcErrors: {},
    ipcDelays: {
      [ipcChannels.getActiveModConfiguration]: 1_000,
      [ipcChannels.getInstalledMods]: 1_000,
    },
  });
  await desktop.page.evaluate(() => window.dispatchEvent(new Event("focus")));

  let calls = await desktop.calls("ipc");
  expect(calls.filter((call) => call.value === ipcChannels.getActiveModConfiguration)).toHaveLength(
    configurationReads,
  );
  expect(calls.filter((call) => call.value === ipcChannels.getInstalledMods)).toHaveLength(
    failedReads,
  );
  await expect(list).toHaveAttribute("aria-busy", "false");

  // Cross the retired ten-second poll boundary to prove the failed read remains user-controlled.
  await desktop.page.waitForTimeout(10_500);
  calls = await desktop.calls("ipc");
  expect(calls.filter((call) => call.value === ipcChannels.getActiveModConfiguration)).toHaveLength(
    configurationReads,
  );
  expect(calls.filter((call) => call.value === ipcChannels.getInstalledMods)).toHaveLength(
    failedReads,
  );

  await desktop.page.getByRole("button", { name: "Sync Workshop", exact: true }).click();

  await expect
    .poll(
      async () =>
        (await desktop.calls("ipc")).filter((call) => call.value === ipcChannels.getInstalledMods)
          .length,
    )
    .toBeGreaterThan(failedReads);
  await expect
    .poll(
      async () =>
        (await desktop.calls("ipc")).filter(
          (call) => call.value === ipcChannels.getActiveModConfiguration,
        ).length,
    )
    .toBeGreaterThan(configurationReads);
  await expect(list).toHaveAttribute("aria-busy", "true");
  await expect(desktop.active.getByRole("status")).toContainText("Loading mod details…");
  await expect(exportModList).toHaveAttribute("aria-disabled", "true");
  await expect(desktop.row(desktop.active, sampleMods.camera.name)).toBeVisible();

  await expect(list).toHaveAttribute("aria-busy", "false", { timeout: 4_000 });
  await expect(
    desktop.page.getByText("Auto-sort is unavailable until installed mod details can be read.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(desktop.active.locator("button.auto-sort-action")).toBeEnabled();
  await expect(exportModList).toHaveAttribute("aria-disabled", "false");
  await expect(core.locator(".thumb img")).toHaveAttribute(
    "src",
    "rimlib-official-image://preview/ludeon.rimworld",
  );
});

test("import and export retain the last readable configuration after ModsConfig disconnects", async ({
  desktop,
}) => {
  const disconnectedConfig = `${desktop.config}-disconnected`;
  const configBefore = await readFile(desktop.config, "utf8");
  const activeList = desktop.active.getByRole("list");
  const importModList = desktop.page.getByRole("button", {
    name: "Import mod list",
    exact: true,
  });
  const exportModList = desktop.page.getByRole("button", {
    name: "Export mod list",
    exact: true,
  });

  await expect(desktop.row(desktop.active, sampleMods.camera.name)).toBeVisible();
  await expect(activeList).toHaveAttribute("aria-busy", "false");
  await expect(importModList).toHaveAttribute("aria-disabled", "false");
  await expect(exportModList).toHaveAttribute("aria-disabled", "false");

  await rename(desktop.config, disconnectedConfig);
  await desktop.page.getByRole("button", { name: "Sync Workshop", exact: true }).click();

  await expect(
    desktop.page.getByText("Active-list changes and auto-sort are unavailable.", { exact: true }),
  ).toBeVisible();
  await expect(activeList).toHaveAttribute("aria-busy", "false");
  await expect(importModList).toHaveAttribute("aria-disabled", "false");
  await expect(exportModList).toHaveAttribute("aria-disabled", "false");
  await expect(readFile(desktop.config, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

  await importModList.click();
  const importPreview = desktop.page.getByRole("dialog", {
    name: "Load RimWorld mod list",
    exact: true,
  });
  await expect(importPreview).toBeVisible();
  await importPreview
    .getByRole("button", { name: "Stage 4 available mods only", exact: true })
    .click();
  await expect(desktop.page.locator(".draft-bar")).toContainText("4 pending changes");
  await desktop.page
    .locator(".draft-bar")
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await expect(desktop.page.locator(".draft-bar")).toContainText("0 pending changes");

  await exportModList.click();
  await expect(
    desktop.page.getByRole("status").filter({ hasText: "Exported 4 mods" }),
  ).toContainText("used the last readable Active configuration");
  expect(parseRimWorldModListXml(await readFile(desktop.modListExport, "utf8")).activeMods).toEqual(
    initialActivePackages,
  );
  await expect(readFile(desktop.config, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  await expect(readFile(`${desktop.config}.rimlib.bak`, "utf8")).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await readFile(disconnectedConfig, "utf8")).toBe(configBefore);
});

test("Sync Workshop supersedes an in-flight metadata read when ModsConfig is unavailable", async ({
  desktop,
}) => {
  const metadataReadsBefore = (await desktop.calls("ipc")).filter(
    (call) => call.value === ipcChannels.getInstalledMods,
  ).length;
  await rename(desktop.config, `${desktop.config}-disconnected`);
  await desktop.setControls({
    ipcDelays: { [ipcChannels.getInstalledMods]: 1_500 },
  });
  await desktop.reopen();

  await expect
    .poll(
      async () =>
        (await desktop.calls("ipc")).filter((call) => call.value === ipcChannels.getInstalledMods)
          .length,
    )
    .toBeGreaterThan(metadataReadsBefore);
  const metadataReadsDuringStartup = (await desktop.calls("ipc")).filter(
    (call) => call.value === ipcChannels.getInstalledMods,
  ).length;

  await desktop.page.getByRole("button", { name: "Sync Workshop", exact: true }).click();

  await expect
    .poll(
      async () =>
        (await desktop.calls("ipc")).filter((call) => call.value === ipcChannels.getInstalledMods)
          .length,
    )
    .toBeGreaterThan(metadataReadsDuringStartup);
});

test.describe("Disconnected Workshop drive", () => {
  test.use({ scenario: "disconnected" });
  test("destructive drafts stage without Workshop metadata and fail safely at confirmation", async ({
    desktop,
  }) => {
    const vaultBefore = await desktop.vault();
    const configBefore = await readFile(desktop.config, "utf8");
    const expectedPendingChanges = [
      { action: "unsubscribe", workshopId: sampleMods.other.id },
      { action: "remove", workshopId: sampleMods.other.id },
      { action: "unsubscribe", workshopId: sampleMods.spare.id },
    ];
    const savedPendingChanges = async () =>
      (await desktop.vault()).pendingDraft?.changes.map(({ action, target }) => ({
        action,
        workshopId: target.workshopId,
      }));
    const expectLibraryUnchanged = async () => {
      const current = await desktop.vault();
      expect(current.mods).toEqual(vaultBefore.mods);
      expect(current.userTags).toEqual(vaultBefore.userTags);
      expect(current.localSteamState).toEqual(vaultBefore.localSteamState);
      expect(current.settings).toEqual(vaultBefore.settings);
    };
    await expect(desktop.page.getByText("Workshop unavailable", { exact: true })).toBeVisible();
    await expect(
      desktop.page.getByText("Auto-sort is unavailable until installed mod details can be read.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(desktop.library.getByRole("listitem")).toHaveCount(5);
    await expect(desktop.subscribed.getByRole("listitem")).toHaveCount(4);
    const cleanup = desktop.page
      .locator("header")
      .getByRole("button", { name: "Unsubscribe all non-active mods" });
    await expect(cleanup).toBeEnabled();
    await expect(desktop.subscribed.locator("button.auto-sort-action")).toBeDisabled();
    const inactiveRow = desktop
      .row(desktop.library, sampleMods.weapons.name)
      .locator(".mod-row-main");
    await expect(inactiveRow).toHaveAttribute("title", "Double-click to stage activation");

    const other = desktop.row(desktop.inactive, sampleMods.other.name);
    await other.locator(".mod-row-main").click();
    const unsubscribe = desktop.info.getByRole("button", {
      name: "Unsubscribe",
      exact: true,
    });
    const remove = desktop.info.getByRole("button", { name: "Removed", exact: true });
    await expect(unsubscribe).toBeEnabled();
    await expect(remove).toBeEnabled();
    await unsubscribe.click();
    await remove.click();
    await cleanup.click();

    const spare = desktop.row(desktop.inactive, sampleMods.spare.name);
    await expect(other).toContainText("Pending unsubscribe");
    await expect(other).toContainText("Pending removal");
    await expect(spare).toContainText("Pending unsubscribe");
    await expect(desktop.page.locator(".draft-bar")).toContainText("3 pending changes");
    expect(await desktop.calls("unsubscribe")).toEqual([]);
    expect(
      (await desktop.calls("ipc")).some((call) => call.value === ipcChannels.deleteLibraryMods),
    ).toBe(false);
    await expect.poll(savedPendingChanges).toEqual(expectedPendingChanges);
    await expectLibraryUnchanged();
    expect(await readFile(desktop.config, "utf8")).toBe(configBefore);

    const review = await desktop.reviewDraft();
    await review.getByRole("checkbox").check();
    await review.getByRole("button", { name: "Apply 3 changes", exact: true }).click();

    const result = desktop.page.getByRole("dialog", { name: "Apply changes", exact: true });
    await expect(desktop.page.getByRole("alert")).toContainText(
      "Active status could not be verified",
    );
    await expect(result).toContainText("3 changes remain in the draft");
    expect(await desktop.calls("unsubscribe")).toEqual([]);
    expect(
      (await desktop.calls("ipc")).some((call) => call.value === ipcChannels.deleteLibraryMods),
    ).toBe(false);
    await expect.poll(savedPendingChanges).toEqual(expectedPendingChanges);
    await expectLibraryUnchanged();
    expect(await readFile(desktop.config, "utf8")).toBe(configBefore);

    await result
      .locator(".app-modal-actions")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await expect(other).toContainText("Pending unsubscribe");
    await expect(other).toContainText("Pending removal");
    await expect(spare).toContainText("Pending unsubscribe");
    await desktop.page
      .locator(".draft-bar")
      .getByRole("button", { name: "Discard draft", exact: true })
      .click();
    await expect(desktop.page.locator(".draft-bar")).toContainText("0 pending changes");

    await rename(`${desktop.workshop}-disconnected`, desktop.workshop);
    await desktop.page.getByRole("button", { name: "Sync Workshop", exact: true }).click();
    await expect(
      desktop.page.getByText("Auto-sort is unavailable until installed mod details can be read.", {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(cleanup).toBeEnabled();
    await expect(desktop.subscribed.locator("button.auto-sort-action")).toBeEnabled();
    await expect(desktop.page.getByText("Workshop unavailable", { exact: true })).toHaveCount(0);
    expect((await desktop.vault()).mods).toHaveLength(8);
  });
});
