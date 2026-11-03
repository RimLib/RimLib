import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { searchScopes } from "../../src/renderer/src/utils/uiConstants";
import { ipcChannels } from "../../src/shared/ipc";
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

test("partitions all known mods by activity, protects Core and respects game order", async ({
  desktop,
}) => {
  await expect(desktop.library.getByRole("heading", { name: "Library" })).toBeVisible();
  await expect(desktop.subscribed.getByRole("heading", { name: "Active" })).toBeVisible();
  await expect(desktop.library.locator(".count-badge")).toHaveText("5 mods");
  await expect(desktop.subscribed.locator(".count-badge")).toHaveText("4 mods");
  await expect(desktop.library.getByRole("listitem")).toHaveCount(5);
  await expect(desktop.subscribed.getByRole("listitem")).toHaveCount(4);
  await expect(desktop.library.locator(".mod-row-copy strong")).toHaveText([
    sampleMods.weapons.name,
    sampleMods.colonists.name,
    sampleMods.tribal.name,
    sampleMods.spare.name,
    sampleMods.other.name,
  ]);
  await expect(desktop.subscribed.locator(".mod-row-copy strong")).toHaveText([
    sampleMods.harmony.name,
    "Core",
    sampleMods.active.name,
    sampleMods.camera.name,
  ]);
  await expect(desktop.library.locator(".mod-row-main[aria-pressed=true]")).toHaveCount(0);
  await expect(desktop.active.locator(".mod-row-main[aria-pressed=true]")).toHaveCount(1);
  await expect(
    desktop.row(desktop.active, sampleMods.harmony.name).locator(".mod-row-main"),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(desktop.infoName).toHaveText(sampleMods.harmony.name);
  const totalFilter = desktop.active.getByRole("button", {
    name: "Show all 4 active mods",
  });
  const invalidFilter = desktop.active.getByRole("button", {
    name: "Show 2 invalid active mods",
  });
  await expect(totalFilter).toHaveAttribute("aria-pressed", "true");
  await expect(invalidFilter).toHaveText("2 invalid");
  await invalidFilter.click();
  await expect(invalidFilter).toHaveAttribute("aria-pressed", "true");
  await expect(desktop.active.locator(".mod-row-copy strong")).toHaveText([
    sampleMods.active.name,
    sampleMods.camera.name,
  ]);
  await totalFilter.click();
  await expect(totalFilter).toHaveAttribute("aria-pressed", "true");
  await expect(desktop.subscribed.getByRole("listitem")).toHaveCount(4);
  await expect(desktop.library.locator(".load-order-number")).toHaveCount(0);
  await expect(desktop.subscribed.locator(".load-order-number")).toHaveText(["1", "2", "3", "4"]);
  const dependent = desktop.row(desktop.subscribed, sampleMods.active.name);
  await expect(dependent.locator(".dependency-warning-pill")).toHaveText("1 missing dependency");
  await dependent.locator(".mod-row-main").click();
  await expect(desktop.info.getByRole("status", { name: "Dependency status" })).toContainText(
    "Missing active dependency",
  );
  await expect(desktop.info.getByLabel("Mod requirements")).toContainText("Example Framework");
  const active = desktop.row(desktop.subscribed, sampleMods.harmony.name);
  await expect(active.locator(".load-order-number")).toHaveText("1");
  await active.locator(".mod-row-main").click();
  await expect(desktop.infoName).toHaveText(sampleMods.harmony.name);
  await expect(desktop.info.getByRole("button", { name: "Removed", exact: true })).toBeDisabled();
  await expect(desktop.info.getByText("Downloaded", { exact: true })).toBeVisible();

  const core = desktop.row(desktop.subscribed, "Core");
  await expect(core.locator(".official-marker")).toHaveText("Core");
  await expect(core.locator(".unsubscribed-pill")).toHaveCount(0);
  await expect(core.locator(".thumb img")).toHaveAttribute(
    "src",
    "rimlib-official-image://preview/ludeon.rimworld",
  );
  await expect
    .poll(() =>
      core
        .locator(".thumb img")
        .evaluate((image) =>
          image instanceof HTMLImageElement && image.complete ? image.naturalWidth : 0,
        ),
    )
    .toBeGreaterThan(0);
  await expect(core.locator(".mod-row-main")).toHaveAttribute(
    "title",
    "RimWorld Core must remain active",
  );
  await core.locator(".mod-row-main").dblclick();
  await expect(desktop.page.locator(".draft-bar").getByRole("status")).toContainText(
    "0 pending changes",
  );
  await expect(core).toBeVisible();

  await desktop.row(desktop.subscribed, sampleMods.camera.name).locator(".mod-row-main").click();
  const activeRemoval = desktop.info.getByRole("button", { name: "Removed", exact: true });
  await expect(activeRemoval).toBeDisabled();
  await expect(activeRemoval).toHaveAttribute(
    "title",
    "Only saved, inactive mods can be removed from the library",
  );
});

test("auto-fixes an available unsubscribed dependency as one compound draft", async ({
  desktop,
}) => {
  const dependent = desktop.row(desktop.active, sampleMods.camera.name);
  await expect(dependent.locator(".dependency-warning-pill")).toHaveText("2 validation errors");
  await dependent.locator(".mod-row-main").click();
  const activeSearch = desktop.active.getByRole("textbox", { name: "Search active mods" });
  await activeSearch.fill(sampleMods.camera.name);
  await desktop.info.getByRole("button", { name: "Auto-fix dependencies" }).click();

  const dependency = desktop.row(desktop.active, sampleMods.weapons.name);
  await expect(activeSearch).toHaveValue("");
  await expect(dependency.locator(".mod-row-main")).toHaveAttribute("aria-pressed", "true");
  await expect(dependency).toHaveAttribute("aria-current", "true");
  await expect(dependency).toBeInViewport();
  await expect(desktop.infoName).toHaveText(sampleMods.weapons.name);
  await expect(dependency).toContainText("Pending subscribe");
  await expect(dependency).toContainText("Pending activation");
  await expect(dependent.locator(".dependency-warning-pill")).toHaveText("2 validation errors");
  await expect(dependent.locator(".dependency-warning-pill")).not.toHaveAttribute(
    "title",
    /requires active dependency/,
  );
  await expect(desktop.page.locator(".draft-bar")).toContainText("2 pending changes");
  const headerStatus = desktop.page.locator("header p[role=status]");
  await expect(headerStatus).toContainText("1 dependency staged for activation");
  await desktop.page
    .locator(".draft-bar")
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await expect(headerStatus).not.toContainText("dependency staged for activation");
});

test("dependency auto-fix reports a missing Library target without staging partial work", async ({
  desktop,
}) => {
  const dependent = desktop.row(desktop.active, sampleMods.active.name);
  await dependent.locator(".mod-row-main").click();
  await desktop.info.getByRole("button", { name: "Auto-fix dependencies" }).click();

  const notification = desktop.page.locator(".error-notification");
  await expect(notification).toContainText(
    "Example Framework (example.framework) is not available in Library",
  );
  await expect(desktop.page.locator(".draft-bar")).toContainText("0 pending changes");
});

test("searches Library mods by field and sorts the Active list by load order", async ({
  desktop,
}) => {
  const search = desktop.library.getByRole("textbox", { name: "Search library mods" });
  await search.fill("  BLAKE  ");
  await expect(desktop.library.locator(".mod-row-copy strong")).toHaveText([
    sampleMods.weapons.name,
  ]);
  await search.fill("Voice");
  await expect(desktop.library.locator(".mod-row-copy strong")).toHaveText([
    sampleMods.colonists.name,
  ]);
  const scope = desktop.library.getByRole("combobox", { name: "Search library mods by" });
  await scope.selectOption(searchScopes.author);
  await expect(desktop.library.getByText("No matching mods", { exact: true })).toBeVisible();
  await scope.selectOption(searchScopes.description);
  await search.fill("description for Voice");
  await expect(desktop.library.locator(".mod-row-copy strong")).toHaveText([
    sampleMods.colonists.name,
  ]);
  await scope.selectOption(searchScopes.tags);
  await search.fill(sampleTags.combat.name);
  await expect(desktop.library.locator(".mod-row-copy strong")).toHaveText([
    sampleMods.weapons.name,
    sampleMods.tribal.name,
    sampleMods.other.name,
  ]);
  await scope.selectOption(searchScopes.all);
  await search.fill("");
  await desktop.library.getByRole("combobox", { name: "Sort library mods" }).selectOption("oldest");
  await expect(desktop.library.locator(".mod-row-copy strong")).toHaveText([
    sampleMods.other.name,
    sampleMods.spare.name,
    sampleMods.tribal.name,
    sampleMods.colonists.name,
    sampleMods.weapons.name,
  ]);
  const activeSort = desktop.subscribed.getByRole("combobox", { name: "Sort active mods" });
  await expect(activeSort).toHaveValue("load-order");
  await expect(activeSort.getByRole("option", { name: "Load order" })).toHaveCount(1);
  await expect(activeSort.getByRole("option", { name: "Active first" })).toHaveCount(0);
  await activeSort.selectOption("invalid-first");
  await expect(desktop.active.locator(".mod-row-copy strong")).toHaveText([
    sampleMods.active.name,
    sampleMods.camera.name,
    sampleMods.harmony.name,
    "Core",
  ]);
});

test("Shift selects the displayed range and info follows the last click", async ({ desktop }) => {
  await desktop.row(desktop.library, sampleMods.weapons.name).locator(".mod-row-main").click();
  await desktop
    .row(desktop.library, sampleMods.tribal.name)
    .locator(".mod-row-main")
    .click({ modifiers: ["Shift"] });
  await expect(desktop.library.locator(".mod-row-main[aria-pressed=true]")).toHaveCount(3);
  await expect(desktop.infoName).toHaveText(sampleMods.tribal.name);
  await desktop.info.getByRole("checkbox", { name: sampleTags.qol.name }).check();
  for (const id of [sampleMods.weapons.id, sampleMods.colonists.id, sampleMods.tribal.id]) {
    await expect.poll(async () => (await desktop.mod(id)).userTagIds).toContain(sampleTags.qol.id);
  }
  expect((await desktop.mod(sampleMods.other.id)).userTagIds).not.toContain(sampleTags.qol.id);
  await desktop
    .row(desktop.subscribed, sampleMods.active.name)
    .locator(".mod-row-main")
    .click({ modifiers: ["Shift"] });
  await expect(desktop.library.locator(".mod-row-main[aria-pressed=true]")).toHaveCount(0);
  await expect(desktop.subscribed.locator(".mod-row-main[aria-pressed=true]")).toHaveCount(1);
});

test("selection removal uses confirmation, only removes selected library mods and makes backups", async ({
  desktop,
}) => {
  await desktop.row(desktop.library, sampleMods.weapons.name).locator(".mod-row-main").click();
  await desktop
    .row(desktop.library, sampleMods.colonists.name)
    .locator(".mod-row-main")
    .click({ modifiers: ["Shift"] });
  await desktop.row(desktop.library, sampleMods.weapons.name).click({ button: "right" });
  await desktop.page.getByRole("menuitem", { name: "Remove", exact: true }).click();
  const dialog = await desktop.reviewDraft();
  await expect(dialog.getByRole("button", { name: "Apply 2 changes" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await desktop.vault()).mods).toHaveLength(8);
  await expect(desktop.library.locator(".pending-remove")).toHaveCount(2);
  await desktop.applyDraft();
  await expect(dialog).toHaveCount(0);
  await expect(desktop.library.getByRole("listitem")).toHaveCount(3);
  expect((await desktop.vault()).mods).toHaveLength(6);
  expect(await desktop.calls("unsubscribe")).toEqual([]);
  expect(
    (await readdir(join(desktop.root, "user-data", vaultBackupDirectory))).length,
  ).toBeGreaterThan(0);
  await desktop.reopen();
  await expect(desktop.library.getByRole("listitem")).toHaveCount(3);
});

test("Mod Info add-back cancels only pending removals and retains staged unsubscribes", async ({
  desktop,
}) => {
  const row = desktop.row(desktop.library, sampleMods.other.name);
  await row.locator(".mod-row-main").click();
  await desktop.info.getByRole("button", { name: "Removed", exact: true }).click();

  await expect(row).toHaveClass(/pending-remove/);
  await expect(row).toHaveClass(/pending-unsubscribe/);
  await expect(desktop.page.locator(".draft-bar")).toContainText("2 pending changes");

  await desktop.info.getByRole("button", { name: "Add back", exact: true }).click();

  await expect(row).not.toHaveClass(/pending-remove/);
  await expect(row).toHaveClass(/pending-unsubscribe/);
  await expect(desktop.page.locator(".draft-bar")).toContainText("1 pending change");
  await expect(desktop.page.locator(".draft-bar")).toContainText("1 unsubscribe");
  await expect(desktop.page.locator(".draft-bar")).not.toContainText("1 remove");
  await expect(desktop.info.getByRole("button", { name: "Add back", exact: true })).toHaveCount(0);
  await expect(desktop.info.getByRole("button", { name: "Removed", exact: true })).toBeEnabled();
});

test("removing an inactive subscribed mod stages unsubscribe and removal as one confirmed draft", async ({
  desktop,
}) => {
  const before = await desktop.vault();
  const row = desktop.row(desktop.inactive, sampleMods.other.name);
  await row.locator(".mod-row-main").click();
  await expect(
    desktop.info.getByRole("button", {
      name: "Removed",
      exact: true,
    }),
  ).toBeEnabled();

  await row.click({ button: "right" });
  const remove = desktop.page.getByRole("menuitem", {
    name: "Remove",
    exact: true,
  });
  await expect(remove).toBeEnabled();
  await remove.click();

  await expect(row).toContainText("Pending unsubscribe");
  await expect(row).toContainText("Pending removal");
  expect(await desktop.calls("unsubscribe")).toEqual([]);
  expect(await desktop.vault()).toEqual(before);

  const review = await desktop.reviewDraft();
  await expect(review.getByRole("listitem")).toHaveCount(2);
  await expect(review).toContainText("Pending unsubscribe");
  await expect(review).toContainText("Pending removal");
  await review.getByRole("button", { name: "Cancel", exact: true }).click();

  expect(await desktop.calls("unsubscribe")).toEqual([]);
  expect(await desktop.vault()).toEqual(before);
  await expect(row).toContainText("Pending unsubscribe");
  await expect(row).toContainText("Pending removal");

  await desktop.applyDraft();

  expect(await desktop.calls("unsubscribe")).toEqual([
    { kind: "unsubscribe", value: sampleMods.other.id },
  ]);
  expect((await desktop.vault()).mods.some((mod) => mod.workshopId === sampleMods.other.id)).toBe(
    false,
  );
  const mutations = (await desktop.calls("ipc"))
    .map((call) => call.value)
    .filter(
      (channel) =>
        channel === ipcChannels.setSubscription || channel === ipcChannels.deleteLibraryMods,
    );
  expect(mutations).toEqual([ipcChannels.setSubscription, ipcChannels.deleteLibraryMods]);
  expect(
    (await readdir(join(desktop.root, "user-data", vaultBackupDirectory))).length,
  ).toBeGreaterThan(0);
});

test("subscription actions live in inactive controls and bulk cleanup stays in the header", async ({
  desktop,
}) => {
  await desktop.library.getByRole("textbox", { name: "Search library mods" }).fill("Guns");
  await expect(desktop.page.getByRole("button", { name: "Delete all library mods" })).toHaveCount(
    0,
  );
  const cleanup = desktop.page
    .locator("header")
    .getByRole("button", { name: "Unsubscribe all non-active mods" });
  await expect(cleanup).toHaveCount(1);
  await expect(cleanup).toBeEnabled();
  await expect(desktop.library.locator(".mod-row .tooltip-action")).toHaveCount(0);
  await desktop.row(desktop.library, sampleMods.weapons.name).locator(".mod-row-main").click();
  await expect(desktop.info.getByRole("button", { name: "Subscribe", exact: true })).toBeEnabled();
  await desktop.row(desktop.library, sampleMods.weapons.name).click({ button: "right" });
  await expect(
    desktop.page.getByRole("menuitem", { name: "Subscribe", exact: true }),
  ).toBeEnabled();
  await desktop.page.keyboard.press("Escape");

  await desktop.row(desktop.subscribed, sampleMods.harmony.name).click({ button: "right" });
  await expect(desktop.page.getByRole("menuitem", { name: "Subscribe", exact: true })).toHaveCount(
    0,
  );
  await expect(
    desktop.page.getByRole("menuitem", { name: "Unsubscribe", exact: true }),
  ).toHaveCount(0);
});

test("a subscribed record invalidates a pending selected removal without partial removal", async ({
  desktop,
}) => {
  await desktop.row(desktop.library, sampleMods.weapons.name).locator(".mod-row-main").click();
  await desktop
    .row(desktop.library, sampleMods.colonists.name)
    .locator(".mod-row-main")
    .click({ modifiers: ["Shift"] });
  await desktop.row(desktop.library, sampleMods.weapons.name).click({ button: "right" });
  await desktop.page.getByRole("menuitem", { name: "Remove", exact: true }).click();
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
  await expect(desktop.row(desktop.library, sampleMods.weapons.name)).toBeVisible();
  await desktop.row(desktop.library, sampleMods.weapons.name).locator(".mod-row-main").click();
  await expect(
    desktop.info.getByRole("button", { name: "Unsubscribe", exact: true }),
  ).toBeVisible();
});

test.describe("Empty installation", () => {
  test.use({ scenario: "empty" });
  test("renders an empty Library state, keeps configured active packages and creates a tag", async ({
    desktop,
  }) => {
    await expect(desktop.library.getByText("No library mods", { exact: true })).toBeVisible();
    await expect(desktop.subscribed.getByRole("listitem")).toHaveCount(4);
    await expect(desktop.subscribed.locator(".mod-row-copy strong")).toHaveText([
      sampleMods.harmony.packageId,
      "Core",
      sampleMods.active.packageId,
      sampleMods.camera.packageId,
    ]);
    await expect(desktop.row(desktop.subscribed, "Core").locator(".mod-row-main")).toHaveAttribute(
      "title",
      "RimWorld Core must remain active",
    );
    await expect(
      desktop.library.getByRole("button", { name: "Delete all library mods" }),
    ).toHaveCount(0);
    await expect(
      desktop.page.getByRole("button", { name: "Unsubscribe all non-active mods" }),
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
  test("deactivation promotes a Library row without scrolling to it", async ({ desktop }) => {
    const list = desktop.library.getByRole("list");
    const scrollTop = 20 * 89;
    await list.evaluate((element, top) => {
      element.scrollTop = top;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    }, scrollTop);
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(scrollTop);

    await desktop.row(desktop.active, sampleMods.active.name).locator(".mod-row-main").dblclick();
    await expect(desktop.page.locator(".draft-bar")).toContainText("1 pending change");
    expect(await list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(desktop.row(desktop.library, sampleMods.active.name)).toHaveCount(0);

    await list.evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await expect(desktop.library.locator(".mod-row-copy strong").first()).toHaveText(
      sampleMods.active.name,
    );
  });

  test("virtualizes thousands of mods while search and selection stay usable", async ({
    desktop,
  }) => {
    await expect(desktop.library.getByText("2005 mods", { exact: true })).toBeVisible();
    await expect
      .poll(() => desktop.library.getByRole("list").evaluate((element) => element.scrollTop))
      .toBe(0);
    expect(await desktop.library.getByRole("listitem").count()).toBeLessThan(100);
    await desktop.library
      .getByRole("textbox", { name: "Search library mods" })
      .fill("Generated mod 1998");
    await expect(desktop.library.getByRole("listitem")).toHaveCount(1);
    await desktop.library.locator(".mod-row-main").click();
    await expect(desktop.infoName).toHaveText("Generated mod 1998");
  });
});
