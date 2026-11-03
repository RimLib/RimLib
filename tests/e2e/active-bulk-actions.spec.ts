import { readFile } from "node:fs/promises";

import { initialActivePackages, sampleMods } from "./data";
import { expect, test } from "./fixtures";

test("Add to Active stages every selected Library mod from its context menu", async ({
  desktop,
}) => {
  const configBefore = await readFile(desktop.config, "utf8");
  const selected = [sampleMods.weapons, sampleMods.colonists] as const;

  await desktop.row(desktop.library, selected[0].name).locator(".mod-row-main").click();
  await desktop
    .row(desktop.library, selected[1].name)
    .locator(".mod-row-main")
    .click({ modifiers: ["Shift"] });
  await expect(desktop.library.locator(".mod-row-main[aria-pressed=true]")).toHaveCount(2);

  const menu = await desktop.openContextMenu(desktop.row(desktop.library, selected[0].name));
  await expect(desktop.page.getByText("2 mods selected", { exact: true })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Add to Active", exact: true }).click();

  for (const mod of selected) {
    const staged = desktop.row(desktop.active, mod.name);
    await expect(staged).toHaveCount(1);
    await expect(staged).toContainText("Pending subscribe");
    await expect(staged).toContainText("Pending activation");
  }
  await expect(desktop.row(desktop.library, sampleMods.tribal.name)).toBeVisible();
  await expect(desktop.row(desktop.library, sampleMods.tribal.name)).not.toContainText(
    "Pending activation",
  );

  const draftBar = desktop.page.locator(".draft-bar");
  await expect(draftBar).toContainText("4 pending changes");
  await expect(draftBar).toContainText("2 subscribe");
  await expect(draftBar).toContainText("2 activate");
  expect(await readFile(desktop.config, "utf8")).toBe(configBefore);
  expect(await desktop.activePackageIds()).toEqual(initialActivePackages);
});

test("Remove from Active stages every selected non-Core mod from its context menu", async ({
  desktop,
}) => {
  const configBefore = await readFile(desktop.config, "utf8");
  const selected = [sampleMods.active, sampleMods.camera] as const;

  await desktop.row(desktop.active, selected[0].name).locator(".mod-row-main").click();
  await desktop
    .row(desktop.active, selected[1].name)
    .locator(".mod-row-main")
    .click({ modifiers: ["Shift"] });
  await expect(desktop.active.locator(".mod-row-main[aria-pressed=true]")).toHaveCount(2);

  const menu = await desktop.openContextMenu(desktop.row(desktop.active, selected[0].name));
  await expect(desktop.page.getByText("2 mods selected", { exact: true })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Remove from Active", exact: true }).click();

  for (const mod of selected) {
    const staged = desktop.row(desktop.library, mod.name);
    await expect(staged).toHaveCount(1);
    await expect(staged).toContainText("Pending deactivation");
  }
  await expect(desktop.row(desktop.active, sampleMods.harmony.name)).toBeVisible();
  await expect(desktop.row(desktop.active, "Core")).toBeVisible();

  const draftBar = desktop.page.locator(".draft-bar");
  await expect(draftBar).toContainText("2 pending changes");
  await expect(draftBar).toContainText("2 deactivate");
  expect(await readFile(desktop.config, "utf8")).toBe(configBefore);
  expect(await desktop.activePackageIds()).toEqual(initialActivePackages);
});

test("Remove from Active keeps RimWorld Core locked", async ({ desktop }) => {
  const menu = await desktop.openContextMenu(desktop.row(desktop.active, "Core"));
  const remove = menu.getByRole("menuitem", {
    name: "Remove from Active",
    exact: true,
  });
  await expect(remove).toBeDisabled();
  await expect(remove).toHaveAttribute("aria-description", "RimWorld Core must remain active");
});

test("Restore stages every community active mod and applies an official-only list", async ({
  desktop,
}) => {
  const configBefore = await readFile(desktop.config, "utf8");
  const communityActiveMods = [sampleMods.harmony, sampleMods.active, sampleMods.camera];

  await desktop.active.getByRole("button", { name: "Restore active mods", exact: true }).click();

  await expect(desktop.active.getByRole("listitem")).toHaveCount(1);
  await expect(desktop.active.locator(".mod-row-copy strong")).toHaveText(["Core"]);
  for (const mod of communityActiveMods) {
    const staged = desktop.row(desktop.inactive, mod.name);
    await expect(staged).toBeVisible();
    await expect(staged).toContainText("Pending deactivation");
  }
  const draftBar = desktop.page.locator(".draft-bar");
  await expect(draftBar).toContainText("3 pending changes");
  await expect(draftBar).toContainText("3 deactivate");
  expect(await readFile(desktop.config, "utf8")).toBe(configBefore);
  expect(await desktop.activePackageIds()).toEqual(initialActivePackages);

  await desktop.applyDraft();

  expect(await desktop.activePackageIds()).toEqual(["ludeon.rimworld"]);
  await expect(desktop.active.getByRole("listitem")).toHaveCount(1);
  await expect(desktop.active.locator(".mod-row-copy strong")).toHaveText(["Core"]);
});

test("Add to Active stages every inactive mod with the selected tag exactly once", async ({
  desktop,
}) => {
  const configBefore = await readFile(desktop.config, "utf8");
  const taggedInactiveMods = [sampleMods.weapons, sampleMods.tribal, sampleMods.other];

  await desktop.page.getByRole("button", { name: "Manage Tags", exact: true }).click();
  const manager = desktop.page.getByRole("dialog", { name: "Tags", exact: true });
  const combat = manager.getByRole("listitem").filter({ hasText: "Combat" });
  await expect(combat).toHaveCount(1);
  await combat.getByRole("button", { name: /add.*active/i }).click();

  for (const mod of taggedInactiveMods) {
    const staged = desktop.row(desktop.active, mod.name);
    await expect(staged).toHaveCount(1);
    await expect(staged).toContainText("Pending activation");
  }
  await expect(desktop.row(desktop.active, sampleMods.weapons.name)).toContainText(
    "Pending subscribe",
  );
  await expect(desktop.row(desktop.active, sampleMods.tribal.name)).toContainText(
    "Pending subscribe",
  );
  await expect(desktop.row(desktop.active, sampleMods.other.name)).not.toContainText(
    "Pending subscribe",
  );

  const alreadyActive = desktop.row(desktop.active, sampleMods.active.name);
  await expect(alreadyActive).toHaveCount(1);
  await expect(alreadyActive).not.toContainText("Pending activation");
  await expect(desktop.active.getByRole("listitem")).toHaveCount(7);

  const draftBar = desktop.page.locator(".draft-bar");
  await expect(draftBar).toContainText("5 pending changes");
  await expect(draftBar).toContainText("2 subscribe");
  await expect(draftBar).toContainText("3 activate");
  expect(await readFile(desktop.config, "utf8")).toBe(configBefore);
  expect(await desktop.activePackageIds()).toEqual(initialActivePackages);

  const review = await desktop.reviewDraft();
  await expect(review.getByRole("listitem")).toHaveCount(5);
  await expect(review).toContainText("Pending subscribe");
  await expect(review).toContainText("Pending activation");
});
