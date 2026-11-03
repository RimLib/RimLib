import { readFile, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { modSorts, searchScopes } from "../../src/renderer/src/utils/uiConstants";
import { modSources } from "../../src/shared/domainConstants";
import { ipcChannels } from "../../src/shared/ipc";
import { sampleMods, sampleTags } from "./data";
import { expect, test } from "./fixtures";

test("reopening resets workspace filters and initializes the first Active selection while retaining tags", async ({
  desktop,
}) => {
  await desktop.row(desktop.library, sampleMods.weapons.name).locator(".mod-row-main").click();
  await desktop
    .row(desktop.library, sampleMods.colonists.name)
    .locator(".mod-row-main")
    .click({ modifiers: ["Shift"] });
  await desktop.info.getByRole("checkbox", { name: sampleTags.qol.name }).check();
  await desktop.library.getByRole("textbox", { name: "Search library mods" }).fill("Blake");
  await desktop.library
    .getByRole("combobox", { name: "Sort library mods" })
    .selectOption(modSorts.oldest);
  await desktop.library
    .getByRole("combobox", { name: "Search library mods by" })
    .selectOption(searchScopes.author);
  await desktop.subscribed.getByRole("textbox", { name: "Search active mods" }).fill("Harmony");
  await desktop.subscribed
    .getByRole("combobox", { name: "Sort active mods" })
    .selectOption(modSorts.newest);
  await desktop.subscribed
    .getByRole("combobox", { name: "Search active mods by" })
    .selectOption(searchScopes.tags);
  await desktop.reopen();
  await expect(desktop.library.getByRole("textbox", { name: "Search library mods" })).toHaveValue(
    "",
  );
  await expect(desktop.subscribed.getByRole("textbox", { name: "Search active mods" })).toHaveValue(
    "",
  );
  await expect(desktop.library.getByRole("combobox", { name: "Sort library mods" })).toHaveValue(
    modSorts.newest,
  );
  await expect(desktop.subscribed.getByRole("combobox", { name: "Sort active mods" })).toHaveValue(
    modSorts.loadOrder,
  );
  await expect(
    desktop.library.getByRole("combobox", { name: "Search library mods by" }),
  ).toHaveValue(searchScopes.all);
  await expect(
    desktop.subscribed.getByRole("combobox", { name: "Search active mods by" }),
  ).toHaveValue(searchScopes.all);
  await expect(desktop.library.locator(".mod-row-main[aria-pressed=true]")).toHaveCount(0);
  await expect(desktop.subscribed.locator(".mod-row-main[aria-pressed=true]")).toHaveCount(1);
  await expect(
    desktop.row(desktop.active, sampleMods.harmony.name).locator(".mod-row-main"),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(desktop.infoName).toHaveText(sampleMods.harmony.name);
  await expect(desktop.info.getByRole("checkbox", { name: sampleTags.qol.name })).toBeChecked();
  await desktop.row(desktop.inactive, sampleMods.weapons.name).locator(".mod-row-main").click();
  await expect(desktop.info.getByRole("checkbox", { name: sampleTags.qol.name })).toBeChecked();
  expect((await desktop.mod(sampleMods.colonists.id)).userTagIds).toContain(sampleTags.qol.id);
});

test("reopening closes an open context menu", async ({ desktop }) => {
  await desktop.openContextMenu(
    desktop.row(desktop.library, sampleMods.weapons.name).locator(".mod-row-main"),
  );
  await desktop.reopen();
  await expect(desktop.page.getByRole("menu")).toHaveCount(0);
});

test("closing waits for pending autosaves and reopening restores tag edits", async ({
  desktop,
}) => {
  await desktop.setControls({ ipcDelays: { [ipcChannels.save]: 650 } });
  await desktop.row(desktop.library, sampleMods.weapons.name).locator(".mod-row-main").click();
  await desktop.info.getByRole("checkbox", { name: sampleTags.qol.name }).check();
  await desktop.close();
  expect((await desktop.mod(sampleMods.weapons.id)).userTagIds).toContain(sampleTags.qol.id);
  await desktop.setControls({ ipcDelays: {} });
  await desktop.launch();
  await expect(desktop.info.getByRole("checkbox", { name: sampleTags.qol.name })).toBeChecked();
});

test("installed discoveries and filesystem update times are checkpointed across restarts", async ({
  desktop,
}) => {
  const updatedAt = new Date("2031-01-02T03:04:05.000Z");
  const discoveredAt = new Date("2032-02-03T04:05:06.000Z");
  const discovered = {
    id: "steam-299",
    workshopId: "299",
    packageId: "example.restart-discovery",
    name: "Restart Discovery",
    author: "E2E",
    source: modSources.steam,
    summary: "Installed after the initial RimLib scan.",
    gameVersions: ["1.6"],
    tags: [],
    subscribed: false,
    downloadedAt: discoveredAt.toISOString(),
    addedAt: "2026-01-01T00:00:00.000Z",
    screenshots: [],
  };

  await utimes(join(desktop.workshop, sampleMods.other.id), updatedAt, updatedAt);
  await desktop.install(discovered);
  const metadataCallsBeforeDiscovery = (await desktop.calls("metadata")).length;

  await desktop.reopen();
  await expect
    .poll(async () => (await desktop.mod(sampleMods.other.id)).downloadedAt)
    .toBe(updatedAt.toISOString());
  await expect
    .poll(
      async () =>
        (await desktop.vault()).mods.find((mod) => mod.workshopId === discovered.workshopId)
          ?.downloadedAt,
    )
    .toBe(discoveredAt.toISOString());
  await expect(desktop.library.locator(".mod-row-copy strong").first()).toHaveText(discovered.name);
  await expect
    .poll(
      async () =>
        (await desktop.vault()).mods.find((mod) => mod.workshopId === discovered.workshopId)
          ?.thumbnail,
    )
    .toBe(`https://e2e.invalid/previews/${discovered.workshopId}.png`);
  const discoveryMetadataCalls = (await desktop.calls("metadata")).slice(
    metadataCallsBeforeDiscovery,
  );
  expect(discoveryMetadataCalls).toHaveLength(1);
  expect(discoveryMetadataCalls[0]?.value).toContain(
    `publishedfileids%5B0%5D=${discovered.workshopId}`,
  );

  const firstCheckpoint = (await desktop.vault()).mods.find(
    (mod) => mod.workshopId === discovered.workshopId,
  );
  expect(firstCheckpoint?.addedAt).toBeTruthy();

  const metadataCallsBeforeSecondOpen = (await desktop.calls("metadata")).length;
  await desktop.reopen();
  await expect
    .poll(async () => {
      const vault = await desktop.vault();
      const rediscovered = vault.mods.filter((mod) => mod.workshopId === discovered.workshopId);
      return {
        count: rediscovered.length,
        addedAt: rediscovered[0]?.addedAt,
        downloadedAt: rediscovered[0]?.downloadedAt,
        updatedDownloadedAt: vault.mods.find((mod) => mod.workshopId === sampleMods.other.id)
          ?.downloadedAt,
      };
    })
    .toEqual({
      count: 1,
      addedAt: firstCheckpoint?.addedAt,
      downloadedAt: discoveredAt.toISOString(),
      updatedDownloadedAt: updatedAt.toISOString(),
    });
  await expect(desktop.library.locator(".mod-row-copy strong").first()).toHaveText(discovered.name);
  expect(await desktop.calls("metadata")).toHaveLength(metadataCallsBeforeSecondOpen);
});

test("failed save prevents window close, preserves the database and permits retry", async ({
  desktop,
}) => {
  await desktop.setControls({ ipcErrors: { [ipcChannels.save]: "Simulated disk write failure" } });
  await desktop.row(desktop.library, sampleMods.weapons.name).locator(".mod-row-main").click();
  await desktop.info.getByRole("checkbox", { name: sampleTags.qol.name }).check();
  const before = await readFile(desktop.database, "utf8");
  await desktop.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await expect
    .poll(async () => (await desktop.calls("errorBox")).map((call) => call.value).join("\n"))
    .toContain("window was kept open because saving failed");
  await expect(desktop.page.getByRole("heading", { name: "RimLib", exact: true })).toBeVisible();
  expect(await readFile(desktop.database, "utf8")).toBe(before);
  await desktop.setControls({ ipcErrors: {} });
  await desktop.reopen();
  await expect(desktop.info.getByRole("checkbox", { name: sampleTags.qol.name })).toBeChecked();
});

test("an external database edit is not overwritten by a UI action", async ({ desktop }) => {
  await expect(desktop.library.getByRole("listitem")).toHaveCount(5);
  const before = await readFile(desktop.database, "utf8");
  const externallyChanged = `${before}\n `;
  try {
    await writeFile(desktop.database, externallyChanged);
    await desktop.row(desktop.library, sampleMods.weapons.name).locator(".mod-row-main").click();
    await desktop.info.getByRole("checkbox", { name: sampleTags.qol.name }).check();
    await expect(desktop.page.getByRole("alert")).toContainText("Saving failed");
    expect(await readFile(desktop.database, "utf8")).toBe(externallyChanged);
    await expect(
      desktop.page.getByRole("button", { name: "Manage Tags", exact: true }),
    ).toBeEnabled();
  } finally {
    // This is our disposable fixture; restore it so shutdown can retry the pending save.
    await writeFile(desktop.database, before);
  }
});

for (const scenario of ["corrupt", "future"] as const) {
  test.describe(`${scenario} database`, () => {
    test.use({ scenario });
    test("blocks editing without replacing the user's data with an empty vault", async ({
      desktop,
    }) => {
      const before = await readFile(desktop.database, "utf8");
      await expect(desktop.page.getByRole("alert")).toContainText(
        "Editing is blocked and your files were preserved",
      );
      await expect(
        desktop.page.getByRole("button", { name: "Manage Tags", exact: true }),
      ).toBeDisabled();
      await expect(
        desktop.page.getByRole("button", { name: "Sync Workshop", exact: true }),
      ).toBeDisabled();
      await expect(desktop.library).toHaveCount(0);
      await desktop.close();
      expect(await readFile(desktop.database, "utf8")).toBe(before);
    });
  });
}
