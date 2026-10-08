import { ipcChannels } from "../../src/shared/ipc";
import { sampleMods, sampleTags } from "./data";
import { expect, test } from "./fixtures";

test("mixed drafts are immediate, reversible, session-only and do not delay tag edits", async ({
  desktop,
}) => {
  await desktop.library
    .getByRole("button", { name: `Subscribe to ${sampleMods.weapons.name}`, exact: true })
    .click();
  await desktop.subscribed
    .getByRole("button", { name: `Unsubscribe from ${sampleMods.spare.name}`, exact: true })
    .click();
  await desktop.row(desktop.library, sampleMods.camera.name).locator(".mod-row-main").click();
  await desktop.info.getByRole("button", { name: "Remove from library", exact: true }).click();
  await expect(desktop.page.locator(".draft-bar")).toContainText("3 pending changes");
  await expect(desktop.row(desktop.library, sampleMods.camera.name)).toContainText(
    "Pending removal",
  );
  expect(await desktop.calls("subscribe")).toEqual([]);
  expect(await desktop.calls("unsubscribe")).toEqual([]);
  expect(
    (await desktop.calls("ipc")).filter(
      (call) =>
        call.value === ipcChannels.setSubscription ||
        call.value === ipcChannels.deleteLibraryMods ||
        call.value === ipcChannels.previewLibrarySubscriptions,
    ),
  ).toEqual([]);
  expect((await desktop.vault()).mods).toHaveLength(8);
  await desktop.info.getByRole("checkbox", { name: sampleTags.combat.name }).check();
  await expect
    .poll(async () => (await desktop.mod(sampleMods.camera.id)).userTagIds)
    .toContain(sampleTags.combat.id);
  await desktop
    .row(desktop.subscribed, sampleMods.weapons.name)
    .getByRole("button", { name: `Undo pending change for ${sampleMods.weapons.name}` })
    .click();
  await expect(desktop.row(desktop.library, sampleMods.weapons.name)).toBeVisible();
  await expect(desktop.page.locator(".draft-bar")).toContainText("2 pending changes");
  await desktop.reopen();
  await expect(desktop.page.locator(".draft-bar")).toContainText("0 pending changes");
  await expect(desktop.row(desktop.subscribed, sampleMods.spare.name)).toBeVisible();
  await expect(desktop.row(desktop.library, sampleMods.camera.name)).not.toContainText(
    "Pending removal",
  );
  expect((await desktop.mod(sampleMods.camera.id)).userTagIds).toContain(sampleTags.combat.id);
});

test("a mixed confirmed draft reports progress, preserves tags and removes only acknowledged records", async ({
  desktop,
}) => {
  await desktop.setControls({ ipcDelays: { [ipcChannels.setSubscription]: 500 } });
  await desktop.library
    .getByRole("button", { name: `Subscribe to ${sampleMods.weapons.name}`, exact: true })
    .click();
  await desktop.subscribed
    .getByRole("button", { name: `Unsubscribe from ${sampleMods.spare.name}`, exact: true })
    .click();
  await desktop.row(desktop.library, sampleMods.camera.name).locator(".mod-row-main").click();
  await desktop.info.getByRole("button", { name: "Remove from library", exact: true }).click();
  const review = await desktop.reviewDraft();
  await expect(review.getByRole("listitem")).toHaveCount(3);
  const apply = review.getByRole("button", { name: "Apply 3 changes" });
  await expect(apply).toBeDisabled();
  await review.getByRole("checkbox").check();
  await apply.click();
  const executing = desktop.page.getByRole("dialog", { name: "Apply changes", exact: true });
  await expect(executing.getByText("Unsubscribe Workshop mods", { exact: true })).toBeVisible();
  await expect(executing.getByText("Subscribe Workshop mods", { exact: true })).toBeVisible();
  await expect(
    executing.getByText("Back up and remove library records", { exact: true }),
  ).toBeVisible();
  await expect(executing.getByRole("progressbar", { name: "Current step progress" })).toBeVisible();
  await expect(
    executing.locator(".app-modal-actions").getByRole("button", { name: "Cancel", exact: true }),
  ).toBeDisabled();
  await expect(
    executing.getByText("Changes applied; RimWorld configuration unchanged", { exact: true }),
  ).toBeVisible();
  await executing
    .locator(".app-modal-actions")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(desktop.page.locator(".draft-bar")).toContainText("0 pending changes");
  expect((await desktop.vault()).mods).toHaveLength(7);
  expect((await desktop.mod(sampleMods.weapons.id)).subscribed).toBe(true);
  expect((await desktop.mod(sampleMods.spare.id)).subscribed).toBe(false);
  expect((await desktop.mod(sampleMods.weapons.id)).userTagIds).toContain(sampleTags.combat.id);
});

test("failed drafts retain unresolved work and retry without repeating completed actions", async ({
  desktop,
}) => {
  await desktop.setControls({ failSubscriptionIds: [sampleMods.other.id] });
  await desktop.page
    .locator("header")
    .getByRole("button", { name: "Unsubscribe all non-active mods" })
    .click();
  const review = await desktop.reviewDraft();
  await review.getByRole("button", { name: "Apply 2 changes" }).click();
  const result = desktop.page.getByRole("dialog", { name: "Apply changes", exact: true });
  await expect(result).toContainText("1 change remains in the draft");
  await result
    .locator(".app-modal-actions")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(desktop.page.locator(".draft-bar")).toContainText("1 pending change");
  await desktop.setControls({ failSubscriptionIds: [] });
  await desktop.applyDraft();
  expect(await desktop.calls("unsubscribe")).toEqual([
    { kind: "unsubscribe", value: sampleMods.spare.id },
    { kind: "unsubscribe", value: sampleMods.other.id },
  ]);
});

test("metadata refresh stays immediate and does not replace a pending intention or personal tags", async ({
  desktop,
}) => {
  await desktop.library
    .getByRole("button", { name: `Subscribe to ${sampleMods.weapons.name}`, exact: true })
    .click();
  await desktop.row(desktop.subscribed, sampleMods.weapons.name).locator(".mod-row-main").click();
  await desktop.info.getByRole("checkbox", { name: sampleTags.qol.name }).check();
  await desktop.info.getByRole("button", { name: "Refresh mod metadata" }).click();
  const name = `Workshop refreshed ${sampleMods.weapons.id}`;
  await expect(desktop.infoName).toHaveText(name);
  await expect(desktop.row(desktop.subscribed, name)).toContainText("Pending subscribe");
  await expect(desktop.page.locator(".draft-bar")).toContainText("1 pending change");
  const refreshed = await desktop.mod(sampleMods.weapons.id);
  expect(refreshed.subscribed).toBe(false);
  expect(refreshed.userTagIds).toContain(sampleTags.qol.id);
  expect(await desktop.calls("subscribe")).toEqual([]);
  await desktop.applyDraft();
  expect(await desktop.mod(sampleMods.weapons.id)).toMatchObject({
    ...refreshed,
    subscribed: true,
  });
});

test.describe("Offline draft removals", () => {
  test.use({ scenario: "offline" });
  test("applies acknowledged library removals without Steam and keeps the subscribed library", async ({
    desktop,
  }) => {
    await desktop.row(desktop.library, sampleMods.camera.name).locator(".mod-row-main").click();
    await desktop.info.getByRole("button", { name: "Remove from library", exact: true }).click();
    expect((await desktop.vault()).mods).toHaveLength(8);
    await desktop.applyDraft();
    const mods = (await desktop.vault()).mods;
    expect(mods).toHaveLength(7);
    expect(mods.map((mod) => mod.workshopId)).not.toContain(sampleMods.camera.id);
    expect(
      mods
        .filter((mod) => mod.subscribed)
        .map((mod) => mod.workshopId)
        .sort(),
    ).toEqual(["201", "202", "203", "204"]);
    expect((await desktop.vault()).userTags).toEqual(Object.values(sampleTags));
    expect(await desktop.calls("subscribe")).toEqual([]);
    expect(await desktop.calls("unsubscribe")).toEqual([]);
  });
});
