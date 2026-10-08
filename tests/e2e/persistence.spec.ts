import { readFile, writeFile } from "node:fs/promises";

import { modSorts, searchScopes } from "../../src/renderer/src/utils/uiConstants";
import { ipcChannels } from "../../src/shared/ipc";
import { sampleMods, sampleTags } from "./data";
import { expect, test } from "./fixtures";

test("reopening resets workspace filters, focus, selection and menus while retaining tags", async ({
  desktop,
}) => {
  await desktop.row(desktop.library, sampleMods.camera.name).locator(".mod-row-main").click();
  await desktop
    .row(desktop.library, sampleMods.weapons.name)
    .locator(".mod-row-main")
    .click({ modifiers: ["Shift"] });
  await desktop.info.getByRole("checkbox", { name: sampleTags.qol.name }).check();
  await desktop.library.getByRole("textbox", { name: "Search library mods" }).fill("Aria");
  await desktop.library
    .getByRole("combobox", { name: "Sort library mods" })
    .selectOption(modSorts.oldest);
  await desktop.library
    .getByRole("combobox", { name: "Search library mods by" })
    .selectOption(searchScopes.author);
  await desktop.subscribed.getByRole("textbox", { name: "Search workshop mods" }).fill("Harmony");
  await desktop.subscribed
    .getByRole("combobox", { name: "Sort workshop mods" })
    .selectOption(modSorts.newest);
  await desktop.subscribed
    .getByRole("combobox", { name: "Search workshop mods by" })
    .selectOption(searchScopes.tags);
  await desktop.row(desktop.library, sampleMods.camera.name).click({ button: "right" });
  await expect(desktop.page.getByRole("menu")).toBeVisible();
  await desktop.reopen();
  await expect(desktop.library.getByRole("textbox", { name: "Search library mods" })).toHaveValue(
    "",
  );
  await expect(
    desktop.subscribed.getByRole("textbox", { name: "Search workshop mods" }),
  ).toHaveValue("");
  await expect(desktop.library.getByRole("combobox", { name: "Sort library mods" })).toHaveValue(
    modSorts.newest,
  );
  await expect(
    desktop.subscribed.getByRole("combobox", { name: "Sort workshop mods" }),
  ).toHaveValue(modSorts.active);
  await expect(
    desktop.library.getByRole("combobox", { name: "Search library mods by" }),
  ).toHaveValue(searchScopes.all);
  await expect(
    desktop.subscribed.getByRole("combobox", { name: "Search workshop mods by" }),
  ).toHaveValue(searchScopes.all);
  await expect(desktop.library.locator(".mod-row-main[aria-pressed=true]")).toHaveCount(0);
  await expect(desktop.subscribed.locator(".mod-row-main[aria-pressed=true]")).toHaveCount(0);
  await expect(desktop.page.getByRole("menu")).toHaveCount(0);
  await expect(desktop.infoName).toHaveText(sampleMods.camera.name);
  await expect(desktop.info.getByRole("checkbox", { name: sampleTags.qol.name })).toBeChecked();
  expect((await desktop.mod(sampleMods.weapons.id)).userTagIds).toContain(sampleTags.qol.id);
});

test("closing waits for pending autosaves and reopening restores tag edits", async ({
  desktop,
}) => {
  await desktop.setControls({ ipcDelays: { [ipcChannels.save]: 650 } });
  await desktop.row(desktop.library, sampleMods.camera.name).locator(".mod-row-main").click();
  await desktop.info.getByRole("checkbox", { name: sampleTags.combat.name }).check();
  await desktop.close();
  expect((await desktop.mod(sampleMods.camera.id)).userTagIds).toContain(sampleTags.combat.id);
  await desktop.setControls({ ipcDelays: {} });
  await desktop.launch();
  await expect(desktop.info.getByRole("checkbox", { name: sampleTags.combat.name })).toBeChecked();
});

test("failed save prevents window close, preserves the database and permits retry", async ({
  desktop,
}) => {
  await desktop.setControls({ ipcErrors: { [ipcChannels.save]: "Simulated disk write failure" } });
  await desktop.row(desktop.library, sampleMods.camera.name).locator(".mod-row-main").click();
  await desktop.info.getByRole("checkbox", { name: sampleTags.combat.name }).check();
  const before = await readFile(desktop.database, "utf8");
  await desktop.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await expect
    .poll(async () => (await desktop.calls("errorBox")).map((call) => call.value).join("\n"))
    .toContain("window was kept open because saving failed");
  await expect(desktop.page.getByRole("heading", { name: "RimLib", exact: true })).toBeVisible();
  expect(await readFile(desktop.database, "utf8")).toBe(before);
  await desktop.setControls({ ipcErrors: {} });
  await desktop.reopen();
  await expect(desktop.info.getByRole("checkbox", { name: sampleTags.combat.name })).toBeChecked();
});

test("an external database edit is not overwritten by a UI action", async ({ desktop }) => {
  await expect(desktop.library.getByRole("listitem")).toHaveCount(4);
  const before = await readFile(desktop.database, "utf8");
  const externallyChanged = `${before}\n `;
  try {
    await writeFile(desktop.database, externallyChanged);
    await desktop.row(desktop.library, sampleMods.camera.name).locator(".mod-row-main").click();
    await desktop.info.getByRole("checkbox", { name: sampleTags.combat.name }).check();
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
