import { requireValue } from "../../src/shared/validation";
import { sampleMods, sampleTags } from "./data";
import { expect, test } from "./fixtures";

test("creates, renames and deletes a tag without losing mods or assignments", async ({
  desktop,
}) => {
  await desktop.row(desktop.library, sampleMods.camera.name).locator(".mod-row-main").click();
  await desktop.info.getByRole("textbox", { name: "Search mod tags" }).fill("Star Wars");
  await desktop.info.getByRole("button", { name: "Create tag Star Wars" }).click();
  const editor = desktop.page.getByRole("dialog", { name: "New tag" });
  await expect(editor.getByRole("textbox", { name: "Tag name" })).toHaveValue("Star Wars");
  await editor.getByRole("radio").nth(2).click();
  await editor.getByRole("button", { name: "Save tag" }).click();
  await expect.poll(async () => (await desktop.vault()).userTags.length).toBe(3);
  const tag = requireValue(
    (await desktop.vault()).userTags.find((entry) => entry.name === "Star Wars"),
  );
  await expect
    .poll(async () => (await desktop.mod(sampleMods.camera.id)).userTagIds)
    .toContain(tag.id);
  await desktop.page.getByRole("button", { name: "Manage Tags", exact: true }).click();
  let manager = desktop.page.getByRole("dialog", { name: "Tags", exact: true });
  await manager.getByRole("textbox", { name: "Search tags", exact: true }).fill("star");
  await expect(manager.getByRole("listitem")).toHaveCount(1);
  await manager.getByRole("button", { name: "Edit Star Wars" }).click();
  const rename = desktop.page.getByRole("dialog", { name: "Edit tag" });
  await rename.getByRole("textbox", { name: "Tag name" }).fill("Galactic");
  await rename.getByRole("button", { name: "Save tag" }).click();
  await expect(manager.getByRole("button", { name: "Edit Galactic" })).toBeVisible();
  await desktop.reopen();
  expect((await desktop.vault()).userTags.find((entry) => entry.id === tag.id)?.name).toBe(
    "Galactic",
  );
  await desktop.page.getByRole("button", { name: "Manage Tags", exact: true }).click();
  manager = desktop.page.getByRole("dialog", { name: "Tags", exact: true });
  await manager.getByRole("button", { name: "Delete Galactic" }).click();
  const deletion = desktop.page.getByRole("dialog", { name: "Delete tag" });
  await deletion.getByRole("button", { name: "Cancel" }).click();
  expect((await desktop.vault()).userTags).toHaveLength(3);
  await manager.getByRole("button", { name: "Delete Galactic" }).click();
  await deletion.getByRole("button", { name: "Delete tag", exact: true }).click();
  await expect.poll(async () => (await desktop.vault()).userTags.length).toBe(2);
  expect((await desktop.mod(sampleMods.camera.id)).userTagIds).not.toContain(tag.id);
  expect((await desktop.vault()).mods).toHaveLength(8);
});

test("rejects empty and case-insensitive duplicate tag names", async ({ desktop }) => {
  await desktop.page.getByRole("button", { name: "Manage Tags", exact: true }).click();
  await desktop.page
    .getByRole("dialog", { name: "Tags", exact: true })
    .getByRole("button", { name: "Create tag" })
    .click();
  const dialog = desktop.page.getByRole("dialog", { name: "New tag" });
  const input = dialog.getByRole("textbox", { name: "Tag name" });
  await expect(dialog.getByRole("button", { name: "Save tag" })).toBeDisabled();
  await input.fill("  COMBAT  ");
  await expect(dialog.getByRole("alert")).toContainText("already exists");
  await expect(dialog.getByRole("button", { name: "Save tag" })).toBeDisabled();
  await dialog.locator(".app-modal-header").getByRole("button", { name: "Close" }).click();
  expect((await desktop.vault()).userTags).toHaveLength(2);
});

test("bulk tag dialogs preserve selection through create/cancel and remove from all selected mods", async ({
  desktop,
}) => {
  await desktop.row(desktop.library, sampleMods.camera.name).locator(".mod-row-main").click();
  await desktop
    .row(desktop.library, sampleMods.weapons.name)
    .locator(".mod-row-main")
    .click({ modifiers: ["Shift"] });
  await desktop.row(desktop.library, sampleMods.camera.name).click({ button: "right" });
  await desktop.page.getByRole("menuitem", { name: "Add tags", exact: true }).click();
  const bulk = desktop.page.getByRole("dialog", { name: "Add tags", exact: true });
  await bulk.getByRole("checkbox", { name: /Combat/ }).check();
  await bulk.getByRole("textbox", { name: "Search tags for selected mods" }).fill("New universe");
  await bulk.getByRole("button", { name: "Create tag New universe" }).click();
  await desktop.page
    .getByRole("dialog", { name: "New tag" })
    .locator(".app-modal-header")
    .getByRole("button", { name: "Close" })
    .click();
  await expect(bulk.getByRole("textbox")).toHaveValue("New universe");
  await expect(bulk.getByRole("textbox")).toBeFocused();
  await bulk.getByRole("button", { name: "Create tag New universe" }).click();
  await desktop.page
    .getByRole("dialog", { name: "New tag" })
    .getByRole("button", { name: "Save tag" })
    .click();
  await expect(bulk.getByRole("checkbox", { name: /Combat/ })).toBeChecked();
  await expect(bulk.getByRole("checkbox", { name: /New universe/ })).toBeChecked();
  await bulk.getByRole("button", { name: "Add tags", exact: true }).click();
  for (const id of [sampleMods.camera.id, sampleMods.weapons.id]) {
    await expect
      .poll(async () => (await desktop.mod(id)).userTagIds)
      .toContain(sampleTags.combat.id);
  }
  await desktop.row(desktop.library, sampleMods.weapons.name).click({ button: "right" });
  await desktop.page.getByRole("menuitem", { name: "Remove tags", exact: true }).click();
  const remove = desktop.page.getByRole("dialog", { name: "Remove tags", exact: true });
  await remove.getByRole("checkbox", { name: /Combat/ }).check();
  await remove.getByRole("button", { name: "Remove tags", exact: true }).click();
  for (const id of [sampleMods.camera.id, sampleMods.weapons.id]) {
    await expect
      .poll(async () => (await desktop.mod(id)).userTagIds)
      .not.toContain(sampleTags.combat.id);
  }
});
