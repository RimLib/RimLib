import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ipcChannels } from "../../src/shared/ipc";
import { configXml, initialActivePackages, sampleMods, sampleTags } from "./data";
import { expect, test } from "./fixtures";

test("subscribes a saved mod without losing metadata or changing the game configuration", async ({
  desktop,
}) => {
  const game = await readFile(desktop.config, "utf8");
  const before = await desktop.mod(sampleMods.weapons.id);
  await desktop.library
    .getByRole("button", { name: `Subscribe to ${sampleMods.weapons.name}`, exact: true })
    .click();
  await expect(desktop.row(desktop.subscribed, sampleMods.weapons.name)).toBeVisible();
  await expect(desktop.row(desktop.library, sampleMods.weapons.name)).toHaveCount(0);
  await expect(desktop.row(desktop.subscribed, sampleMods.weapons.name)).toContainText(
    "Pending subscribe",
  );
  expect(await desktop.calls("subscribe")).toEqual([]);
  expect((await desktop.mod(sampleMods.weapons.id)).subscribed).toBe(false);
  await desktop.applyDraft();
  expect(await desktop.calls("subscribe")).toEqual([
    { kind: "subscribe", value: sampleMods.weapons.id },
  ]);
  expect(await desktop.mod(sampleMods.weapons.id)).toMatchObject({ ...before, subscribed: true });
  expect(await readFile(desktop.config, "utf8")).toBe(game);
  await desktop.reopen();
  await expect(desktop.row(desktop.subscribed, sampleMods.weapons.name)).toBeVisible();
});

test("unsubscribing requires confirmation and moves the mod to Library with tags retained", async ({
  desktop,
}) => {
  const game = await readFile(desktop.config, "utf8");
  const before = await desktop.mod(sampleMods.other.id);
  const button = desktop.subscribed.getByRole("button", {
    name: `Unsubscribe from ${sampleMods.other.name}`,
    exact: true,
  });
  await button.click();
  const dialog = await desktop.reviewDraft();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await desktop.calls("unsubscribe")).toEqual([]);
  await expect(desktop.row(desktop.library, sampleMods.other.name)).toContainText(
    "Pending unsubscribe",
  );
  expect((await desktop.mod(sampleMods.other.id)).subscribed).toBe(true);
  await desktop.applyDraft();
  await expect(desktop.row(desktop.library, sampleMods.other.name)).toBeVisible();
  expect(await desktop.mod(sampleMods.other.id)).toMatchObject({ ...before, subscribed: false });
  expect((await desktop.mod(sampleMods.other.id)).userTagIds).toContain(sampleTags.combat.id);
  expect(await readFile(desktop.config, "utf8")).toBe(game);
  await desktop.reopen();
  await expect(desktop.row(desktop.library, sampleMods.other.name)).toBeVisible();
});

test("Active unsubscribe is guarded in rows, context menus and the privileged IPC handler", async ({
  desktop,
}) => {
  const active = desktop.row(desktop.subscribed, sampleMods.harmony.name);
  await expect(
    active.getByRole("button", { name: `Unsubscribe from ${sampleMods.harmony.name}` }),
  ).toBeDisabled();
  await active.click({ button: "right" });
  await expect(
    desktop.page.getByRole("menuitem", { name: "Unsubscribe", exact: true }),
  ).toBeDisabled();
  await expect(desktop.page.getByRole("menuitem", { name: "Remove from library" })).toBeDisabled();
  await desktop.page.keyboard.press("Escape");
  const error = await desktop.page.evaluate(async (id) => {
    if (!window.modStore) {
      throw new Error("Desktop preload API is missing");
    }
    try {
      await window.modStore.setSubscription(id, false);
      return "unexpected success";
    } catch (failure) {
      return String(failure);
    }
  }, `steam-${sampleMods.harmony.id}`);
  expect(error).toContain("Active mods cannot be unsubscribed");
  expect(await desktop.calls("unsubscribe")).toEqual([]);
});

test("bulk cleanup includes hidden non-active mods and protects Active mods", async ({
  desktop,
}) => {
  const game = await readFile(desktop.config, "utf8");
  await desktop.subscribed.getByRole("textbox", { name: "Search workshop mods" }).fill("Harmony");
  await desktop.page
    .locator("header")
    .getByRole("button", { name: "Unsubscribe all non-active mods" })
    .click();
  const dialog = await desktop.reviewDraft();
  await expect(dialog.locator(".draft-review-list strong")).toHaveText([
    sampleMods.spare.name,
    sampleMods.other.name,
  ]);
  expect(await desktop.calls("unsubscribe")).toEqual([]);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await desktop.applyDraft();
  await expect
    .poll(async () => (await desktop.calls("unsubscribe")).map((call) => call.value))
    .toEqual([sampleMods.spare.id, sampleMods.other.id]);
  await expect(desktop.row(desktop.library, sampleMods.spare.name)).toBeVisible();
  expect((await desktop.vault()).mods).toHaveLength(8);
  expect(await readFile(desktop.config, "utf8")).toBe(game);
});

test("rechecks game configuration after preview and refuses newly active mods", async ({
  desktop,
}) => {
  await desktop.page
    .locator("header")
    .getByRole("button", { name: "Unsubscribe all non-active mods" })
    .click();
  const dialog = await desktop.reviewDraft();
  await expect(dialog).toBeVisible();
  await writeFile(
    desktop.config,
    configXml([...initialActivePackages, sampleMods.spare.packageId]),
  );
  await dialog.getByRole("button", { name: "Apply 2 changes" }).click();
  await expect(desktop.page.getByRole("alert")).toContainText("Active mods cannot be unsubscribed");
  expect(await desktop.calls("unsubscribe")).toEqual([]);
  await expect(
    desktop.page.getByRole("button", { name: "Manage Tags", exact: true }),
  ).toBeEnabled();
});

test("partial subscription failure preserves confirmed changes and every saved mod", async ({
  desktop,
}) => {
  await desktop.setControls({ failSubscriptionIds: [sampleMods.other.id] });
  await desktop.page
    .locator("header")
    .getByRole("button", { name: "Unsubscribe all non-active mods" })
    .click();
  const review = await desktop.reviewDraft();
  await review.getByRole("button", { name: "Apply 2 changes" }).click();
  await expect(desktop.page.getByRole("alert")).toContainText(
    "Simulated Steam subscription failure",
  );
  await expect(desktop.row(desktop.library, sampleMods.spare.name)).toBeVisible();
  await expect(desktop.row(desktop.library, sampleMods.other.name)).toContainText(
    "Pending unsubscribe",
  );
  expect((await desktop.mod(sampleMods.other.id)).subscribed).toBe(true);
  expect((await desktop.vault()).mods).toHaveLength(8);
  expect(await desktop.calls("unsubscribe")).toEqual([
    { kind: "unsubscribe", value: sampleMods.spare.id },
  ]);
});

test("Steam disappearing after startup reports an error and unlocks the UI", async ({
  desktop,
}) => {
  const subscribe = desktop.library.getByRole("button", {
    name: `Subscribe to ${sampleMods.weapons.name}`,
    exact: true,
  });
  await expect(subscribe).toBeEnabled();
  await desktop.setControls({ steamRunning: false });
  await subscribe.click();
  const review = await desktop.reviewDraft();
  await review.getByRole("button", { name: "Apply 1 change", exact: true }).click();
  await expect(desktop.page.getByRole("alert")).toContainText("Start Steam");
  const applying = desktop.page.getByRole("dialog", { name: "Apply changes", exact: true });
  await applying
    .locator(".app-modal-actions")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(desktop.row(desktop.subscribed, sampleMods.weapons.name)).toContainText(
    "Pending subscribe",
  );
  await desktop.library.getByRole("textbox", { name: "Search library mods" }).fill("Camera");
  await expect(desktop.library.getByRole("listitem")).toHaveCount(1);
  await desktop.page.getByRole("button", { name: "Manage Tags", exact: true }).click();
  await expect(desktop.page.getByRole("dialog", { name: "Tags", exact: true })).toBeVisible();
  expect(await desktop.calls("subscribe")).toEqual([]);
});

test("RimWorld running blocks unsubscribe without breaking tag editing", async ({ desktop }) => {
  await desktop.setControls({ gameRunning: true });
  await desktop.subscribed
    .getByRole("button", { name: `Unsubscribe from ${sampleMods.spare.name}`, exact: true })
    .click();
  const review = await desktop.reviewDraft();
  await review.getByRole("button", { name: "Apply 1 change", exact: true }).click();
  await expect(desktop.page.getByRole("alert")).toContainText("Close RimWorld");
  expect(await desktop.calls("unsubscribe")).toEqual([]);
  await desktop.page
    .getByRole("dialog", { name: "Apply changes", exact: true })
    .locator(".app-modal-actions")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await desktop.row(desktop.library, sampleMods.camera.name).locator(".mod-row-main").click();
  await desktop.info.getByRole("checkbox", { name: sampleTags.combat.name }).check();
  await expect
    .poll(async () => (await desktop.mod(sampleMods.camera.id)).userTagIds)
    .toContain(sampleTags.combat.id);
});

test("context menu subscriptions apply to all selected mods", async ({ desktop }) => {
  await desktop.row(desktop.library, sampleMods.weapons.name).locator(".mod-row-main").click();
  await desktop
    .row(desktop.library, sampleMods.tribal.name)
    .locator(".mod-row-main")
    .click({ modifiers: ["ControlOrMeta"] });
  await desktop.row(desktop.library, sampleMods.weapons.name).click({ button: "right" });
  await desktop.page.getByRole("menuitem", { name: "Subscribe", exact: true }).click();
  await expect(desktop.page.locator(".draft-bar")).toContainText("2 pending changes");
  expect(await desktop.calls("subscribe")).toEqual([]);
  await desktop.applyDraft();
  await expect(desktop.row(desktop.subscribed, sampleMods.weapons.name)).toBeVisible();
  await expect(desktop.row(desktop.subscribed, sampleMods.tribal.name)).toBeVisible();
  expect((await desktop.calls("subscribe")).map((call) => call.value).sort()).toEqual([
    sampleMods.weapons.id,
    sampleMods.tribal.id,
  ]);
});

test("sync imports discovered mods and retains records that disappeared from Workshop", async ({
  desktop,
}) => {
  await rm(join(desktop.workshop, sampleMods.other.id), { recursive: true });
  const imported = {
    ...(await desktop.mod(sampleMods.camera.id)),
    id: "steam-301",
    workshopId: "301",
    name: "New installed mod",
    packageId: "example.new",
    subscribed: true,
  };
  await desktop.install(imported);
  await desktop.page.getByRole("button", { name: "Sync Workshop", exact: true }).click();
  await expect(
    desktop.page
      .getByRole("status")
      .filter({ hasText: "Workshop folders synchronized; saved mods retained" }),
  ).toBeVisible();
  await expect(desktop.row(desktop.library, sampleMods.other.name)).toBeVisible();
  await expect(desktop.row(desktop.subscribed, imported.name)).toBeVisible();
  expect((await desktop.vault()).mods).toHaveLength(9);
  expect((await desktop.mod(sampleMods.other.id)).userTagIds).toContain(sampleTags.combat.id);
  expect((await desktop.mod("301")).packageId).toBe(imported.packageId);
  expect(await desktop.calls("subscribe")).toEqual([]);
  expect(await desktop.calls("unsubscribe")).toEqual([]);
});

test.describe("Offline Steam", () => {
  test.use({ scenario: "offline" });
  test("offline Steam disables subscription controls, preserves tags and reenables on reconnection", async ({
    desktop,
  }) => {
    await expect(
      desktop.library.getByRole("button", { name: `Subscribe to ${sampleMods.camera.name}` }),
    ).toBeDisabled();
    await expect(
      desktop.subscribed.getByRole("button", { name: `Unsubscribe from ${sampleMods.spare.name}` }),
    ).toBeDisabled();
    await expect(
      desktop.page
        .locator("header")
        .getByRole("button", { name: "Unsubscribe all non-active mods" }),
    ).toBeDisabled();
    await expect(
      desktop.page.getByRole("button", { name: "Sync Workshop", exact: true }),
    ).toBeEnabled();
    await desktop.row(desktop.library, sampleMods.camera.name).click({ button: "right" });
    await expect(
      desktop.page.getByRole("menuitem", { name: "Subscribe", exact: true }),
    ).toBeDisabled();
    await expect(
      desktop.page.getByRole("menuitem", { name: "Add tags", exact: true }),
    ).toBeEnabled();
    await desktop.page.keyboard.press("Escape");
    await desktop.row(desktop.subscribed, sampleMods.spare.name).click({ button: "right" });
    await expect(
      desktop.page.getByRole("menuitem", { name: "Unsubscribe", exact: true }),
    ).toBeDisabled();
    await expect(
      desktop.page.getByRole("menuitem", { name: "Add tags", exact: true }),
    ).toBeEnabled();
    await desktop.page.keyboard.press("Escape");
    await desktop.row(desktop.library, sampleMods.camera.name).locator(".mod-row-main").click();
    await desktop.info.getByRole("checkbox", { name: sampleTags.combat.name }).check();
    await expect
      .poll(async () => (await desktop.mod(sampleMods.camera.id)).userTagIds)
      .toContain(sampleTags.combat.id);
    expect(await desktop.calls("subscribe")).toEqual([]);
    expect(await desktop.calls("unsubscribe")).toEqual([]);
    await desktop.setControls({ steamRunning: true });
    await desktop.page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      desktop.library.getByRole("button", { name: `Subscribe to ${sampleMods.camera.name}` }),
    ).toBeEnabled();
    await expect(
      desktop.subscribed.getByRole("button", { name: `Unsubscribe from ${sampleMods.spare.name}` }),
    ).toBeEnabled();
    await expect(
      desktop.page
        .locator("header")
        .getByRole("button", { name: "Unsubscribe all non-active mods" }),
    ).toBeEnabled();
    await desktop.row(desktop.library, sampleMods.camera.name).click({ button: "right" });
    await expect(
      desktop.page.getByRole("menuitem", { name: "Subscribe", exact: true }),
    ).toBeEnabled();
  });
});

test("losing Steam disables new subscription drafts while keeping local Undo available", async ({
  desktop,
}) => {
  const camera = desktop.library.getByRole("button", {
    name: `Subscribe to ${sampleMods.camera.name}`,
  });
  await expect(camera).toBeEnabled();
  await desktop.subscribed
    .getByRole("button", { name: `Unsubscribe from ${sampleMods.spare.name}` })
    .click();
  const pending = desktop.row(desktop.library, sampleMods.spare.name);
  await expect(pending).toContainText("Pending unsubscribe");
  await desktop.setControls({ steamRunning: false });
  await desktop.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(camera).toBeDisabled();
  await expect(
    desktop.page.locator("header").getByRole("button", { name: "Unsubscribe all non-active mods" }),
  ).toBeDisabled();
  const undo = pending.getByRole("button", {
    name: `Undo pending change for ${sampleMods.spare.name}`,
  });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(desktop.row(desktop.subscribed, sampleMods.spare.name)).toBeVisible();
  await expect(desktop.page.locator(".draft-bar")).toContainText("0 pending changes");
  await expect(
    desktop.page
      .locator(".draft-bar")
      .getByRole("button", { name: "Confirm changes", exact: true }),
  ).toBeDisabled();
  expect(await desktop.calls("subscribe")).toEqual([]);
  expect(await desktop.calls("unsubscribe")).toEqual([]);
});

test("a readable empty Workshop scan moves mods to Library without deleting records", async ({
  desktop,
}) => {
  const game = await readFile(desktop.config, "utf8");
  for (const name of await readdir(desktop.workshop)) {
    await rm(join(desktop.workshop, name), { recursive: true });
  }
  await desktop.page.getByRole("button", { name: "Sync Workshop", exact: true }).click();
  await expect(desktop.subscribed.getByRole("listitem")).toHaveCount(0);
  await expect(desktop.library.getByRole("listitem")).toHaveCount(8);
  await expect(
    desktop.page.getByRole("button", { name: "Manage Tags", exact: true }),
  ).toBeEnabled();
  expect((await desktop.vault()).mods).toHaveLength(8);
  expect((await desktop.vault()).userTags).toEqual(Object.values(sampleTags));
  expect(await readFile(desktop.config, "utf8")).toBe(game);
  expect(await desktop.calls("unsubscribe")).toEqual([]);
});

test("IPC rejects malformed mutations before they reach Steam", async ({ desktop }) => {
  const error = await desktop.page.evaluate(async () => {
    if (!window.modStore) {
      throw new Error("Desktop preload API is missing");
    }
    try {
      await window.modStore.setSubscription("", true);
      return "unexpected success";
    } catch (failure) {
      return String(failure);
    }
  });
  expect(error).toContain("Invalid application request");
  expect(await desktop.calls("subscribe")).toEqual([]);
  expect(
    (await desktop.calls("ipc")).some((call) => call.value === ipcChannels.setSubscription),
  ).toBe(true);
});
