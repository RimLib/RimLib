import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { searchScopes } from "../../src/renderer/src/utils/uiConstants";
import { vaultBackupDirectory } from "../../src/shared/storage";
import { sampleMods, sampleTags } from "./data";
import { expect, test } from "./fixtures";

test("RimLib branding retains explicitly isolated desktop data and session paths", async ({
  desktop,
}) => {
  await expect(desktop.page).toHaveTitle("RimLib");
  await expect(desktop.page.locator(".app-topbar-title")).toHaveText("RimLib");
  const identity = await desktop.app.evaluate(({ app }) => ({
    name: app.getName(),
    userData: app.getPath("userData"),
    sessionData: app.getPath("sessionData"),
  }));
  expect(identity).toEqual({
    name: "RimLib",
    userData: join(desktop.root, "user-data"),
    sessionData: join(desktop.root, "session"),
  });
  expect((await desktop.vault()).mods).toHaveLength(8);
});

test("partitions saved mods, protects Active and respects game order", async ({ desktop }) => {
  await expect(desktop.library.getByRole("listitem")).toHaveCount(4);
  await expect(desktop.subscribed.getByRole("listitem")).toHaveCount(4);
  await expect(desktop.subscribed.locator(".mod-row-copy strong")).toHaveText([
    sampleMods.harmony.name,
    sampleMods.active.name,
    sampleMods.spare.name,
    sampleMods.other.name,
  ]);
  await expect(desktop.library.locator(".active-pill")).toHaveCount(0);
  await expect(desktop.subscribed.locator(".active-pill")).toHaveCount(2);
  const dependent = desktop.row(desktop.subscribed, sampleMods.active.name);
  await expect(dependent.locator(".dependency-warning-pill")).toHaveText("1 missing dependency");
  await dependent.locator(".mod-row-main").click();
  await expect(desktop.info.getByRole("alert")).toContainText("Missing active dependency");
  await expect(desktop.info.getByLabel("Mod requirements")).toContainText("Example Framework");
  const active = desktop.row(desktop.subscribed, sampleMods.harmony.name);
  await expect(active.locator(".mod-row-status > :first-child")).toHaveText("Active");
  await active.locator(".mod-row-main").click();
  await expect(desktop.infoName).toHaveText(sampleMods.harmony.name);
  await expect(
    desktop.info.getByRole("button", { name: "Remove from library", exact: true }),
  ).toHaveCount(0);
  await expect(desktop.info.getByText("Downloaded", { exact: true })).toBeVisible();
  await expect(desktop.subscribed.getByText("Installed", { exact: true })).toHaveCount(0);
});

test("searches all fields or a selected field and sorts by date", async ({ desktop }) => {
  const search = desktop.library.getByRole("textbox", { name: "Search library mods" });
  await search.fill("  ARIA  ");
  await expect(desktop.library.locator(".mod-row-copy strong")).toHaveText([
    sampleMods.camera.name,
  ]);
  await search.fill("guns");
  await expect(desktop.library.locator(".mod-row-copy strong")).toHaveText([
    sampleMods.weapons.name,
  ]);
  const scope = desktop.library.getByRole("combobox", { name: "Search library mods by" });
  await scope.selectOption(searchScopes.author);
  await expect(desktop.library.getByText("No matching mods", { exact: true })).toBeVisible();
  await scope.selectOption(searchScopes.description);
  await search.fill("description for Camera");
  await expect(desktop.library.locator(".mod-row-copy strong")).toHaveText([
    sampleMods.camera.name,
  ]);
  await scope.selectOption(searchScopes.tags);
  await search.fill(sampleTags.combat.name);
  await expect(desktop.library.locator(".mod-row-copy strong")).toHaveText([
    sampleMods.weapons.name,
    sampleMods.tribal.name,
  ]);
  await scope.selectOption(searchScopes.all);
  await search.fill("");
  await desktop.library.getByRole("combobox", { name: "Sort library mods" }).selectOption("oldest");
  await expect(desktop.library.locator(".mod-row-copy strong")).toHaveText([
    sampleMods.tribal.name,
    sampleMods.colonists.name,
    sampleMods.weapons.name,
    sampleMods.camera.name,
  ]);
  await expect(
    desktop.subscribed.getByRole("combobox", { name: "Filter workshop by tag" }),
  ).toHaveCount(0);
});

test("Shift selects the displayed range and info follows the last click", async ({ desktop }) => {
  await desktop.row(desktop.library, sampleMods.camera.name).locator(".mod-row-main").click();
  await desktop
    .row(desktop.library, sampleMods.colonists.name)
    .locator(".mod-row-main")
    .click({ modifiers: ["Shift"] });
  await expect(desktop.library.locator(".mod-row-main[aria-pressed=true]")).toHaveCount(3);
  await expect(desktop.infoName).toHaveText(sampleMods.colonists.name);
  await desktop.info.getByRole("checkbox", { name: sampleTags.qol.name }).check();
  for (const id of [sampleMods.camera.id, sampleMods.weapons.id, sampleMods.colonists.id]) {
    await expect.poll(async () => (await desktop.mod(id)).userTagIds).toContain(sampleTags.qol.id);
  }
  expect((await desktop.mod(sampleMods.tribal.id)).userTagIds).not.toContain(sampleTags.qol.id);
  await desktop
    .row(desktop.subscribed, sampleMods.spare.name)
    .locator(".mod-row-main")
    .click({ modifiers: ["Shift"] });
  await expect(desktop.library.locator(".mod-row-main[aria-pressed=true]")).toHaveCount(0);
  await expect(desktop.subscribed.locator(".mod-row-main[aria-pressed=true]")).toHaveCount(1);
});

test("selection removal uses confirmation, only removes selected library mods and makes backups", async ({
  desktop,
}) => {
  await desktop.row(desktop.library, sampleMods.camera.name).locator(".mod-row-main").click();
  await desktop
    .row(desktop.library, sampleMods.weapons.name)
    .locator(".mod-row-main")
    .click({ modifiers: ["Shift"] });
  await desktop.row(desktop.library, sampleMods.camera.name).click({ button: "right" });
  await desktop.page.getByRole("menuitem", { name: "Remove from library" }).click();
  const dialog = await desktop.reviewDraft();
  await expect(dialog.getByRole("button", { name: "Apply 2 changes" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await desktop.vault()).mods).toHaveLength(8);
  await expect(desktop.library.locator(".pending-remove")).toHaveCount(2);
  await desktop.applyDraft();
  await expect(dialog).toHaveCount(0);
  await expect(desktop.library.getByRole("listitem")).toHaveCount(2);
  expect((await desktop.vault()).mods).toHaveLength(6);
  expect(await desktop.calls("unsubscribe")).toEqual([]);
  expect(
    (await readdir(join(desktop.root, "user-data", vaultBackupDirectory))).length,
  ).toBeGreaterThan(0);
  await desktop.reopen();
  await expect(desktop.library.getByRole("listitem")).toHaveCount(2);
});

test("lists omit bulk-delete controls and expose non-active cleanup only in the header", async ({
  desktop,
}) => {
  await desktop.library.getByRole("textbox", { name: "Search library mods" }).fill("Camera");
  await expect(desktop.page.getByRole("button", { name: "Delete all library mods" })).toHaveCount(
    0,
  );
  await expect(
    desktop.subscribed.getByRole("button", { name: "Unsubscribe all non-active mods" }),
  ).toHaveCount(0);
  const cleanup = desktop.page
    .locator("header")
    .getByRole("button", { name: "Unsubscribe all non-active mods" });
  await expect(cleanup).toHaveCount(1);
  await expect(cleanup).toBeEnabled();
});

test("a subscribed record invalidates a pending selected removal without partial removal", async ({
  desktop,
}) => {
  await desktop.row(desktop.library, sampleMods.camera.name).locator(".mod-row-main").click();
  await desktop
    .row(desktop.library, sampleMods.weapons.name)
    .locator(".mod-row-main")
    .click({ modifiers: ["Shift"] });
  await desktop.row(desktop.library, sampleMods.camera.name).click({ button: "right" });
  await desktop.page.getByRole("menuitem", { name: "Remove from library", exact: true }).click();
  const dialog = await desktop.reviewDraft();
  await expect(dialog).toBeVisible();
  await desktop.page.evaluate(async (id) => {
    if (!window.modStore) {
      throw new Error("Desktop preload API is missing");
    }
    await window.modStore.setSubscription(id, true);
  }, `steam-${sampleMods.weapons.id}`);
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Apply 2 changes" }).click();
  await expect(desktop.page.getByRole("alert")).toContainText("Subscribed mods cannot be removed");
  expect((await desktop.vault()).mods).toHaveLength(8);
  const result = desktop.page.getByRole("dialog", { name: "Apply changes", exact: true });
  await expect(result).toBeVisible();
  await result
    .locator(".app-modal-actions")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(desktop.row(desktop.subscribed, sampleMods.weapons.name)).toBeVisible();
});

test.describe("Empty installation", () => {
  test.use({ scenario: "empty" });
  test("renders empty states and allows creating the first tag", async ({ desktop }) => {
    await expect(desktop.library.getByText("No uninstalled mods saved")).toBeVisible();
    await expect(desktop.subscribed.getByText("No installed Workshop mods")).toBeVisible();
    await expect(
      desktop.library.getByRole("button", { name: "Delete all library mods" }),
    ).toHaveCount(0);
    await expect(
      desktop.page
        .locator("header")
        .getByRole("button", { name: "Unsubscribe all non-active mods" }),
    ).toBeDisabled();
    await desktop.page.getByRole("button", { name: "Manage Tags", exact: true }).click();
    await desktop.page
      .getByRole("dialog", { name: "Tags", exact: true })
      .getByRole("button", { name: "Create tag" })
      .click();
    const editor = desktop.page.getByRole("dialog", { name: "New tag" });
    await editor.getByRole("textbox", { name: "Tag name" }).fill("First tag");
    await editor.getByRole("button", { name: "Save tag" }).click();
    await expect
      .poll(async () => (await desktop.vault()).userTags.map((tag) => tag.name))
      .toEqual(["First tag"]);
  });
});

test.describe("Large library", () => {
  test.use({ scenario: "large" });
  test("virtualizes thousands of mods while search and selection stay usable", async ({
    desktop,
  }) => {
    await expect(desktop.library.getByText("2004 mods", { exact: true })).toBeVisible();
    expect(await desktop.library.getByRole("listitem").count()).toBeLessThan(100);
    await desktop.library
      .getByRole("textbox", { name: "Search library mods" })
      .fill("Generated mod 1999");
    await expect(desktop.library.getByRole("listitem")).toHaveCount(1);
    await desktop.library.locator(".mod-row-main").click();
    await expect(desktop.infoName).toHaveText("Generated mod 1999");
  });
});
