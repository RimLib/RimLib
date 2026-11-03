import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { ipcChannels } from "../../src/shared/ipc";
import { sampleMods, sampleTags } from "./data";
import { expect, test } from "./fixtures";

test("Inactive Mod Info stages and applies a subscription without changing activity", async ({
  desktop,
}) => {
  const configBefore = await readFile(desktop.config, "utf8");
  const before = await desktop.mod(sampleMods.weapons.id);
  const row = desktop.row(desktop.inactive, sampleMods.weapons.name);

  await row.locator(".mod-row-main").click();
  await expect(desktop.infoName).toHaveText(sampleMods.weapons.name);
  await desktop.info.getByRole("button", { name: "Subscribe", exact: true }).click();

  await expect(row).toContainText("Pending subscribe");
  await expect(desktop.row(desktop.active, sampleMods.weapons.name)).toHaveCount(0);
  expect(await desktop.calls("subscribe")).toEqual([]);
  expect((await desktop.mod(sampleMods.weapons.id)).subscribed).toBe(false);

  await desktop.applyDraft();

  expect(await desktop.calls("subscribe")).toEqual([
    { kind: "subscribe", value: sampleMods.weapons.id },
  ]);
  expect(await desktop.mod(sampleMods.weapons.id)).toMatchObject({ ...before, subscribed: true });
  expect(await readFile(desktop.config, "utf8")).toBe(configBefore);
  await expect(desktop.row(desktop.inactive, sampleMods.weapons.name)).toBeVisible();
  await expect(
    desktop.info.getByRole("button", { name: "Unsubscribe", exact: true }),
  ).toBeVisible();

  await desktop.reopen();
  await expect(desktop.row(desktop.inactive, sampleMods.weapons.name)).toBeVisible();
});

test("Inactive Mod Info unsubscribe remains a draft when review is cancelled, then applies", async ({
  desktop,
}) => {
  const configBefore = await readFile(desktop.config, "utf8");
  const before = await desktop.mod(sampleMods.other.id);
  const row = desktop.row(desktop.inactive, sampleMods.other.name);

  await row.locator(".mod-row-main").click();
  await desktop.info.getByRole("button", { name: "Unsubscribe", exact: true }).click();
  await expect(row).toContainText("Pending unsubscribe");

  const dialog = await desktop.reviewDraft();
  await expect(dialog.getByRole("listitem")).toContainText("Pending unsubscribe");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

  expect(await desktop.calls("unsubscribe")).toEqual([]);
  expect((await desktop.mod(sampleMods.other.id)).subscribed).toBe(true);
  expect(await readFile(desktop.config, "utf8")).toBe(configBefore);
  await expect(row).toContainText("Pending unsubscribe");

  await desktop.applyDraft();

  const after = await desktop.mod(sampleMods.other.id);
  expect(after).toMatchObject({
    id: before.id,
    packageId: before.packageId,
    workshopId: before.workshopId,
    source: before.source,
    subscribed: false,
  });
  expect({ addedAt: after.addedAt, notes: after.notes, userTagIds: after.userTagIds }).toEqual({
    addedAt: before.addedAt,
    notes: before.notes,
    userTagIds: before.userTagIds,
  });
  expect(after.userTagIds).toContain(sampleTags.combat.id);
  expect((await desktop.vault()).mods).toHaveLength(8);
  expect(await readFile(desktop.config, "utf8")).toBe(configBefore);
  await expect(desktop.row(desktop.inactive, sampleMods.other.name)).toBeVisible();
});

test("inactive context-menu Subscribe and Unsubscribe apply to the selected mods only", async ({
  desktop,
}) => {
  const subscribeNames = [sampleMods.weapons.name, sampleMods.tribal.name] as const;
  const subscribeIds = [sampleMods.weapons.id, sampleMods.tribal.id].sort();
  const unsubscribeNames = [sampleMods.spare.name, sampleMods.other.name] as const;
  const unsubscribeIds = [sampleMods.spare.id, sampleMods.other.id].sort();
  const selectBoth = async (names: readonly [string, string]) => {
    await desktop.row(desktop.inactive, names[0]).locator(".mod-row-main").click();
    await desktop
      .row(desktop.inactive, names[1])
      .locator(".mod-row-main")
      .click({ modifiers: ["ControlOrMeta"] });
  };

  await selectBoth(subscribeNames);
  await desktop.row(desktop.inactive, subscribeNames[0]).click({ button: "right" });
  await expect(
    desktop.page.getByRole("menuitem", { name: "Subscribe", exact: true }),
  ).toBeEnabled();
  await expect(
    desktop.page.getByRole("menuitem", { name: "Unsubscribe", exact: true }),
  ).toBeDisabled();
  await desktop.page.getByRole("menuitem", { name: "Subscribe", exact: true }).click();
  await expect(desktop.page.locator(".draft-bar")).toContainText("2 pending changes");
  for (const name of subscribeNames) {
    await expect(desktop.row(desktop.inactive, name)).toContainText("Pending subscribe");
  }
  await desktop.applyDraft();
  expect((await desktop.calls("subscribe")).map((call) => call.value).sort()).toEqual(subscribeIds);

  // Use mods with existing local folders for the destructive half of the test. A newly
  // subscribed Workshop item has no readable About.xml until Steam finishes downloading it,
  // so RimLib correctly refuses to guess whether it is active.
  await selectBoth(unsubscribeNames);
  await desktop.row(desktop.inactive, unsubscribeNames[0]).click({ button: "right" });
  await expect(
    desktop.page.getByRole("menuitem", { name: "Unsubscribe", exact: true }),
  ).toBeEnabled();
  await desktop.page.getByRole("menuitem", { name: "Unsubscribe", exact: true }).click();
  await expect(desktop.page.locator(".draft-bar")).toContainText("2 pending changes");
  await desktop.applyDraft();

  expect((await desktop.calls("unsubscribe")).map((call) => call.value).sort()).toEqual(
    unsubscribeIds,
  );
  for (const name of unsubscribeNames) {
    await expect(desktop.row(desktop.inactive, name)).toBeVisible();
  }
});

test("bulk inactive unsubscribe includes hidden mods and preserves the active configuration", async ({
  desktop,
}) => {
  const configBefore = await readFile(desktop.config, "utf8");
  const cleanup = desktop.page
    .locator("header")
    .getByRole("button", { name: "Unsubscribe all non-active mods" });

  await desktop.library.getByRole("textbox", { name: "Search library mods" }).fill("Guns");
  await expect(desktop.library.getByRole("listitem")).toHaveCount(1);
  await cleanup.click();

  await expect(desktop.page.locator(".draft-bar")).toContainText("2 pending changes");
  expect(await desktop.calls("unsubscribe")).toEqual([]);
  const dialog = await desktop.reviewDraft();
  await expect(dialog.locator(".draft-review-list strong")).toHaveText([
    sampleMods.spare.name,
    sampleMods.other.name,
  ]);
  expect(await desktop.calls("unsubscribe")).toEqual([]);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

  await desktop.applyDraft();

  expect((await desktop.calls("unsubscribe")).map((call) => call.value)).toEqual([
    sampleMods.spare.id,
    sampleMods.other.id,
  ]);
  expect((await desktop.mod(sampleMods.spare.id)).subscribed).toBe(false);
  expect((await desktop.mod(sampleMods.other.id)).subscribed).toBe(false);
  expect(await readFile(desktop.config, "utf8")).toBe(configBefore);
  await expect(desktop.subscribed.getByRole("listitem")).toHaveCount(4);
});

test("active mods expose no context subscription action and remain protected by Mod Info and IPC", async ({
  desktop,
}) => {
  const active = desktop.row(desktop.active, sampleMods.harmony.name);
  await active.locator(".mod-row-main").click();
  const unsubscribe = desktop.info.getByRole("button", { name: "Unsubscribe", exact: true });
  await expect(unsubscribe).toBeDisabled();
  await expect(unsubscribe).toHaveAttribute("title", "Deactivate this mod before unsubscribing");

  await active.click({ button: "right" });
  await expect(desktop.page.getByRole("menuitem", { name: "Subscribe", exact: true })).toHaveCount(
    0,
  );
  await expect(
    desktop.page.getByRole("menuitem", { name: "Unsubscribe", exact: true }),
  ).toHaveCount(0);
  await expect(desktop.page.getByRole("menuitem", { name: "Remove", exact: true })).toBeDisabled();
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

test("a failed inactive subscription remains staged and keeps every saved record", async ({
  desktop,
}) => {
  const row = desktop.row(desktop.inactive, sampleMods.weapons.name);
  await row.locator(".mod-row-main").click();
  await desktop.info.getByRole("button", { name: "Subscribe", exact: true }).click();
  await desktop.setControls({ failSubscriptionIds: [sampleMods.weapons.id] });

  const review = await desktop.reviewDraft();
  await review.getByRole("button", { name: "Apply 1 change", exact: true }).click();
  const result = desktop.page.getByRole("dialog", { name: "Apply changes", exact: true });
  await expect(desktop.page.getByRole("alert")).toContainText(
    "Simulated Steam subscription failure",
  );
  await expect(result).toContainText("1 change remains in the draft");
  await result
    .locator(".app-modal-actions")
    .getByRole("button", { name: "Close", exact: true })
    .click();

  await expect(row).toContainText("Pending subscribe");
  expect((await desktop.mod(sampleMods.weapons.id)).subscribed).toBe(false);
  expect((await desktop.vault()).mods).toHaveLength(8);
  expect(await desktop.calls("subscribe")).toEqual([]);
});

test.describe("Offline Steam", () => {
  test.use({ scenario: "offline" });

  test("subscription changes stage offline and report Steam only when confirmation is attempted", async ({
    desktop,
  }) => {
    expect(
      (await desktop.calls("ipc")).filter((call) => call.value === ipcChannels.getSteamStatus),
    ).toEqual([]);
    const cleanup = desktop.page
      .locator("header")
      .getByRole("button", { name: "Unsubscribe all non-active mods" });
    await expect(cleanup).toBeEnabled();

    const unsubscribed = desktop.row(desktop.inactive, sampleMods.weapons.name);
    await unsubscribed.locator(".mod-row-main").click();
    const subscribe = desktop.info.getByRole("button", { name: "Subscribe", exact: true });
    await expect(subscribe).toBeEnabled();
    await unsubscribed.click({ button: "right" });
    await expect(
      desktop.page.getByRole("menuitem", { name: "Subscribe", exact: true }),
    ).toBeEnabled();
    await expect(
      desktop.page.getByRole("menuitem", { name: "Add tags", exact: true }),
    ).toBeEnabled();
    await desktop.page.keyboard.press("Escape");

    const subscribed = desktop.row(desktop.inactive, sampleMods.spare.name);
    await subscribed.locator(".mod-row-main").click();
    await expect(
      desktop.info.getByRole("button", { name: "Unsubscribe", exact: true }),
    ).toBeEnabled();
    await subscribed.click({ button: "right" });
    await expect(
      desktop.page.getByRole("menuitem", { name: "Unsubscribe", exact: true }),
    ).toBeEnabled();
    await desktop.page.keyboard.press("Escape");

    await unsubscribed.locator(".mod-row-main").click();
    await subscribe.click();
    await expect(unsubscribed).toContainText("Pending subscribe");
    expect(
      (await desktop.calls("ipc")).filter((call) => call.value === ipcChannels.getSteamStatus),
    ).toEqual([]);

    const review = await desktop.reviewDraft();
    const apply = review.getByRole("button", { name: "Apply 1 change", exact: true });
    await expect(apply).toBeEnabled();
    await apply.click();

    const result = desktop.page.getByRole("dialog", { name: "Apply changes", exact: true });
    await expect(desktop.page.getByRole("alert")).toContainText(
      "Start Steam and sign in before changing mod subscriptions",
    );
    await expect(result).toContainText("1 change remains in the draft");
    expect(
      (await desktop.calls("ipc")).filter((call) => call.value === ipcChannels.getSteamStatus),
    ).toHaveLength(1);
    expect(await desktop.calls("subscribe")).toEqual([]);
    await result
      .locator(".app-modal-actions")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await expect(unsubscribed).toContainText("Pending subscribe");
  });

  test("destructive library actions stage offline and fail atomically only at confirmation", async ({
    desktop,
  }) => {
    await expect
      .poll(async () => {
        const mod = await desktop.mod(sampleMods.other.id);
        return { gameVersions: mod.gameVersions, localPath: mod.localPath };
      })
      .toEqual({
        gameVersions: ["1.6"],
        localPath: join(desktop.workshop, sampleMods.other.id),
      });
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
    const steamStatusCalls = async () =>
      (await desktop.calls("ipc")).filter((call) => call.value === ipcChannels.getSteamStatus);
    const mutationCalls = async () =>
      (await desktop.calls("ipc"))
        .map((call) => call.value)
        .filter(
          (channel) =>
            channel === ipcChannels.setSubscription || channel === ipcChannels.deleteLibraryMods,
        );

    expect(await steamStatusCalls()).toEqual([]);

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
    await expect(other).toContainText("Pending unsubscribe");
    await remove.click();
    await expect(other).toContainText("Pending removal");

    const cleanup = desktop.page
      .locator("header")
      .getByRole("button", { name: "Unsubscribe all non-active mods" });
    await expect(cleanup).toBeEnabled();
    await cleanup.click();

    const spare = desktop.row(desktop.inactive, sampleMods.spare.name);
    await expect(spare).toContainText("Pending unsubscribe");
    await expect(desktop.page.locator(".draft-bar")).toContainText("3 pending changes");
    expect(await steamStatusCalls()).toEqual([]);
    expect(await mutationCalls()).toEqual([]);
    await expect.poll(savedPendingChanges).toEqual(expectedPendingChanges);
    await expectLibraryUnchanged();
    expect(await readFile(desktop.config, "utf8")).toBe(configBefore);

    const review = await desktop.reviewDraft();
    await review.getByRole("checkbox").check();
    await review.getByRole("button", { name: "Apply 3 changes", exact: true }).click();

    const result = desktop.page.getByRole("dialog", { name: "Apply changes", exact: true });
    await expect(desktop.page.getByRole("alert")).toContainText(
      "Start Steam and sign in before changing mod subscriptions",
    );
    await expect(result).toContainText("3 changes remain in the draft");
    expect(await steamStatusCalls()).toHaveLength(1);
    expect(await mutationCalls()).toEqual([]);
    expect(await desktop.calls("unsubscribe")).toEqual([]);
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
    await expect(desktop.page.locator(".draft-bar")).toContainText("3 pending changes");
  });
});

test("sync retains disappeared records and imports subscribed mods as inactive", async ({
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
  await expect(desktop.row(desktop.inactive, sampleMods.other.name)).toBeVisible();
  await expect(desktop.row(desktop.inactive, imported.name)).toBeVisible();
  await expect(desktop.row(desktop.active, imported.name)).toHaveCount(0);
  expect((await desktop.vault()).mods).toHaveLength(9);
  expect((await desktop.mod(sampleMods.other.id)).userTagIds).toContain(sampleTags.combat.id);
  expect((await desktop.mod("301")).packageId).toBe(imported.packageId);
  expect(await desktop.calls("subscribe")).toEqual([]);
  expect(await desktop.calls("unsubscribe")).toEqual([]);
});

test("IPC rejects malformed subscription mutations before they reach Steam", async ({
  desktop,
}) => {
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
