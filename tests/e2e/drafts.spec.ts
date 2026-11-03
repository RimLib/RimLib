import { readFile, writeFile } from "node:fs/promises";

import { ipcChannels } from "../../src/shared/ipc";
import { RIMWORLD_APP_ID } from "../../src/shared/steam";
import { configXml, initialActivePackages, sampleMods } from "./data";
import { expect, test } from "./fixtures";

test("Run RimWorld is available only when the current configuration has no pending draft", async ({
  desktop,
}) => {
  const run = desktop.page.getByRole("button", { name: "Run RimWorld", exact: true });
  const launchUri = `steam://rungameid/${RIMWORLD_APP_ID}`;

  await expect(run).toBeVisible();
  await expect(run).toBeEnabled();
  await run.click();
  await expect
    .poll(() => desktop.calls("openExternal"))
    .toEqual([{ kind: "openExternal", value: launchUri }]);

  await desktop.row(desktop.inactive, sampleMods.weapons.name).locator(".mod-row-main").dblclick();
  await expect(desktop.page.locator(".draft-bar")).toContainText("2 pending changes");
  await expect(run).toHaveCount(0);

  await desktop.page
    .locator(".draft-bar")
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await expect(desktop.page.locator(".draft-bar")).toContainText("0 pending changes");
  await expect(run).toBeVisible();
  await expect(run).toBeEnabled();

  await desktop.row(desktop.active, sampleMods.active.name).click({ button: "right" });
  await desktop.page.getByRole("menuitem", { name: "Move to position…", exact: true }).click();
  const move = desktop.page.getByRole("dialog", { name: "Move active mod", exact: true });
  await move.getByLabel(/^Position/).fill("1");
  await move.getByRole("button", { name: "Stage move", exact: true }).click();
  await expect(desktop.page.locator(".draft-bar")).toContainText("1 pending change");
  await expect(desktop.page.locator(".draft-bar")).toContainText("load order");
  await expect(run).toHaveCount(0);

  await desktop.applyDraft();
  await expect(desktop.page.locator(".draft-bar")).toContainText("0 pending changes");
  await expect(run).toBeVisible();
  await expect(run).toBeEnabled();
  await run.click();
  await expect
    .poll(() => desktop.calls("openExternal"))
    .toEqual([
      { kind: "openExternal", value: launchUri },
      { kind: "openExternal", value: launchUri },
    ]);
});

test("compound activation review can be cancelled without writing, then applied and persisted", async ({
  desktop,
}) => {
  const configBefore = await readFile(desktop.config, "utf8");
  const activeSearch = desktop.active.getByRole("textbox", { name: "Search active mods" });
  await activeSearch.fill(sampleMods.camera.name);

  await desktop.row(desktop.inactive, sampleMods.weapons.name).locator(".mod-row-main").dblclick();
  await expect(desktop.row(desktop.inactive, sampleMods.weapons.name)).toHaveCount(0);
  const projected = desktop.row(desktop.active, sampleMods.weapons.name);
  await expect(activeSearch).toHaveValue("");
  await expect(projected).toHaveAttribute("aria-current", "true");
  await expect(projected).toBeInViewport();
  await expect(projected).toContainText("Pending subscribe");
  await expect(projected).toContainText("Pending activation");
  expect(await readFile(desktop.config, "utf8")).toBe(configBefore);

  const review = await desktop.reviewDraft();
  await expect(review.getByRole("listitem")).toHaveCount(2);
  await expect(review).toContainText("Pending subscribe");
  await expect(review).toContainText("Pending activation");
  await review.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(desktop.page.locator(".draft-bar")).toContainText("2 pending changes");
  expect(await readFile(desktop.config, "utf8")).toBe(configBefore);
  expect(
    (await desktop.calls("ipc")).filter(
      (call) =>
        call.value === ipcChannels.setSubscription || call.value === ipcChannels.setActiveMods,
    ),
  ).toEqual([]);

  const newFilter = desktop.active.getByRole("button", { name: "Show 1 new active mod" });
  await newFilter.click();
  await expect(newFilter).toHaveAttribute("aria-pressed", "true");
  await expect(desktop.active.locator(".mod-row-copy strong")).toHaveText([
    sampleMods.weapons.name,
  ]);
  await desktop.applyDraft();

  expect(await desktop.activePackageIds()).toEqual([
    ...initialActivePackages,
    sampleMods.weapons.packageId,
  ]);
  expect(await readFile(`${desktop.config}.rimlib.bak`, "utf8")).toBe(configBefore);
  expect((await desktop.mod(sampleMods.weapons.id)).subscribed).toBe(true);
  expect(
    (await desktop.calls("ipc")).some((call) => call.value === ipcChannels.setActiveMods),
  ).toBe(true);
  await expect(
    desktop.active.getByRole("button", { name: "Show all 5 active mods" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(desktop.active.getByRole("button", { name: "Show 0 new active mods" })).toHaveText(
    "0 new",
  );
  await expect(desktop.active.getByRole("listitem")).toHaveCount(5);
  await expect(desktop.row(desktop.active, sampleMods.weapons.name)).toBeVisible();

  await desktop.reopen();
  await expect(desktop.row(desktop.active, sampleMods.weapons.name)).toBeVisible();
});

test("unapplied membership and load-order changes survive restart until Apply", async ({
  desktop,
}) => {
  const configBefore = await readFile(desktop.config, "utf8");
  const activeNames = () => desktop.active.locator(".mod-row-copy strong");
  const expectedProjection = [
    sampleMods.camera.name,
    sampleMods.harmony.name,
    "Core",
    sampleMods.active.name,
    sampleMods.weapons.name,
  ];
  const expectedPackages = [
    sampleMods.camera.packageId,
    sampleMods.harmony.packageId,
    "ludeon.rimworld",
    sampleMods.active.packageId,
    sampleMods.weapons.packageId,
  ];

  await desktop.row(desktop.inactive, sampleMods.weapons.name).locator(".mod-row-main").dblclick();
  await expect(desktop.row(desktop.active, sampleMods.weapons.name)).toContainText(
    "Pending activation",
  );
  await desktop.row(desktop.active, sampleMods.camera.name).click({ button: "right" });
  await desktop.page.getByRole("menuitem", { name: "Move to position…", exact: true }).click();
  const move = desktop.page.getByRole("dialog", { name: "Move active mod", exact: true });
  await move.getByLabel(/^Position/).fill("1");
  await move.getByRole("button", { name: "Stage move", exact: true }).click();

  await expect(activeNames()).toHaveText(expectedProjection);
  await expect(desktop.page.locator(".draft-bar")).toContainText("3 pending changes");
  expect(await readFile(desktop.config, "utf8")).toBe(configBefore);

  await desktop.reopen();
  await expect(desktop.page.locator(".draft-bar")).toContainText("3 pending changes");
  await expect(activeNames()).toHaveText(expectedProjection);
  await expect(desktop.row(desktop.active, sampleMods.weapons.name)).toContainText(
    "Pending subscribe",
  );
  await expect(desktop.row(desktop.active, sampleMods.weapons.name)).toContainText(
    "Pending activation",
  );
  expect(await readFile(desktop.config, "utf8")).toBe(configBefore);
  expect(await desktop.activePackageIds()).toEqual(initialActivePackages);

  const review = await desktop.reviewDraft();
  await expect(review.getByRole("listitem")).toHaveCount(3);
  await expect(review).toContainText("Pending subscribe");
  await expect(review).toContainText("Pending activation");
  await expect(review).toContainText("Move from position 4 to position 1");
  await review.getByRole("button", { name: "Cancel", exact: true }).click();

  await desktop.applyDraft();
  await expect(desktop.page.locator(".draft-bar")).toContainText("0 pending changes");
  expect(await desktop.activePackageIds()).toEqual(expectedPackages);
  await expect.poll(async () => (await desktop.vault()).pendingDraft).toBeUndefined();

  await desktop.reopen();
  await expect(desktop.page.locator(".draft-bar")).toContainText("0 pending changes");
  await expect(activeNames()).toHaveText(expectedProjection);
  expect(await desktop.activePackageIds()).toEqual(expectedPackages);
  expect((await desktop.vault()).pendingDraft).toBeUndefined();
});

test("Core is locked and a cancelled deactivation can be discarded without touching config", async ({
  desktop,
}) => {
  const configBefore = await readFile(desktop.config, "utf8");
  const core = desktop.row(desktop.active, "Core");
  await expect(core.locator(".mod-row-main")).toHaveAttribute(
    "title",
    "RimWorld Core must remain active",
  );
  await core.locator(".mod-row-main").dblclick();
  await expect(desktop.page.locator(".draft-bar")).toContainText("0 pending changes");

  await desktop.row(desktop.active, sampleMods.active.name).locator(".mod-row-main").dblclick();
  await expect(desktop.row(desktop.inactive, sampleMods.active.name)).toContainText(
    "Pending deactivation",
  );
  const review = await desktop.reviewDraft();
  await expect(review.getByRole("listitem")).toContainText("Pending deactivation");
  await review.getByRole("button", { name: "Cancel", exact: true }).click();
  await desktop.page
    .locator(".draft-bar")
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();

  await expect(desktop.row(desktop.active, sampleMods.active.name)).toBeVisible();
  await expect(desktop.page.locator(".draft-bar")).toContainText("0 pending changes");
  expect(await readFile(desktop.config, "utf8")).toBe(configBefore);
  expect(
    (await desktop.calls("ipc")).filter((call) => call.value === ipcChannels.setActiveMods),
  ).toEqual([]);
});

test("draft status chips filter projected membership and toggle back to Total", async ({
  desktop,
}) => {
  const activeNames = desktop.active.locator(".mod-row-copy strong");
  const libraryNames = desktop.library.locator(".mod-row-copy strong");
  const totalFilter = desktop.active.getByRole("button", {
    name: "Show all 4 active mods",
  });
  const invalidFilter = desktop.active.getByRole("button", {
    name: "Show 2 invalid active mods",
  });

  await desktop.row(desktop.inactive, sampleMods.spare.name).locator(".mod-row-main").dblclick();
  await expect(desktop.row(desktop.active, sampleMods.spare.name)).toContainText(
    "Pending activation",
  );
  await desktop.row(desktop.active, sampleMods.harmony.name).locator(".mod-row-main").dblclick();
  await expect(desktop.row(desktop.library, sampleMods.harmony.name)).toContainText(
    "Pending deactivation",
  );

  const newFilter = desktop.active.getByRole("button", {
    name: "Show 1 new active mod",
  });
  const removedFilter = desktop.active.getByRole("button", {
    name: "Show 1 removed mod in Library",
  });
  await expect(newFilter).toHaveText("1 new");
  await expect(removedFilter).toHaveText("1 removed");

  await invalidFilter.click();
  await expect(invalidFilter).toHaveAttribute("aria-pressed", "true");
  await expect(activeNames).toHaveText([sampleMods.active.name, sampleMods.camera.name]);
  await invalidFilter.click();
  await expect(totalFilter).toHaveAttribute("aria-pressed", "true");
  await expect(activeNames).toHaveText([
    "Core",
    sampleMods.active.name,
    sampleMods.camera.name,
    sampleMods.spare.name,
  ]);

  await newFilter.click();
  await expect(newFilter).toHaveAttribute("aria-pressed", "true");
  await expect(activeNames).toHaveText([sampleMods.spare.name]);
  await expect(desktop.library.getByRole("listitem")).toHaveCount(5);
  await newFilter.click();
  await expect(totalFilter).toHaveAttribute("aria-pressed", "true");
  await expect(desktop.active.getByRole("listitem")).toHaveCount(4);

  await removedFilter.click();
  await expect(removedFilter).toHaveAttribute("aria-pressed", "true");
  await expect(libraryNames).toHaveText([sampleMods.harmony.name]);
  await expect(desktop.active.getByRole("listitem")).toHaveCount(4);
  await removedFilter.click();
  await expect(totalFilter).toHaveAttribute("aria-pressed", "true");
  await expect(desktop.library.getByRole("listitem")).toHaveCount(5);

  await removedFilter.click();
  await desktop.page
    .locator(".draft-bar")
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();

  await expect(desktop.page.locator(".draft-bar")).toContainText("0 pending changes");
  await expect(totalFilter).toHaveAttribute("aria-pressed", "true");
  await expect(desktop.active.getByRole("button", { name: "Show 0 new active mods" })).toHaveText(
    "0 new",
  );
  await expect(
    desktop.active.getByRole("button", { name: "Show 0 removed mods in Library" }),
  ).toHaveText("0 removed");
  await expect(activeNames).toHaveText([
    sampleMods.harmony.name,
    "Core",
    sampleMods.active.name,
    sampleMods.camera.name,
  ]);
  await expect(desktop.library.getByRole("listitem")).toHaveCount(5);
  await expect(desktop.row(desktop.library, sampleMods.spare.name)).toBeVisible();
});

test("a newly deactivated mod stays at the top of Library until its view controls change", async ({
  desktop,
}) => {
  const libraryNames = desktop.library.locator(".mod-row-copy strong");
  const librarySort = desktop.library.getByRole("combobox", { name: "Sort library mods" });
  const librarySearch = desktop.library.getByRole("textbox", { name: "Search library mods" });
  await librarySort.selectOption("oldest");
  await expect(libraryNames).toHaveText([
    sampleMods.other.name,
    sampleMods.spare.name,
    sampleMods.tribal.name,
    sampleMods.colonists.name,
    sampleMods.weapons.name,
  ]);

  await desktop.row(desktop.active, sampleMods.active.name).locator(".mod-row-main").dblclick();
  await expect(desktop.row(desktop.library, sampleMods.active.name)).toContainText(
    "Pending deactivation",
  );
  await expect(libraryNames).toHaveText([
    sampleMods.active.name,
    sampleMods.other.name,
    sampleMods.spare.name,
    sampleMods.tribal.name,
    sampleMods.colonists.name,
    sampleMods.weapons.name,
  ]);

  await desktop.row(desktop.library, sampleMods.active.name).locator(".mod-row-main").dblclick();
  await expect(desktop.row(desktop.active, sampleMods.active.name)).toBeVisible();
  await expect(desktop.page.locator(".draft-bar")).toContainText("0 pending changes");
  await desktop.row(desktop.active, sampleMods.active.name).locator(".mod-row-main").dblclick();
  await expect(libraryNames.first()).toHaveText(sampleMods.active.name);

  await librarySearch.fill("Zeta");
  await expect(libraryNames).toHaveText([sampleMods.active.name]);
  await librarySearch.fill("");
  await expect(libraryNames).toHaveText([
    sampleMods.other.name,
    sampleMods.spare.name,
    sampleMods.active.name,
    sampleMods.tribal.name,
    sampleMods.colonists.name,
    sampleMods.weapons.name,
  ]);

  await desktop.row(desktop.library, sampleMods.active.name).locator(".mod-row-main").dblclick();
  await expect(desktop.row(desktop.active, sampleMods.active.name)).toBeVisible();
  await expect(desktop.page.locator(".draft-bar")).toContainText("0 pending changes");
  await desktop.row(desktop.active, sampleMods.active.name).locator(".mod-row-main").dblclick();
  await expect(libraryNames.first()).toHaveText(sampleMods.active.name);

  await librarySort.selectOption("newest");
  await expect(libraryNames).toHaveText([
    sampleMods.weapons.name,
    sampleMods.colonists.name,
    sampleMods.tribal.name,
    sampleMods.active.name,
    sampleMods.spare.name,
    sampleMods.other.name,
  ]);
});

test("double-clicking an unsubscribed mod stages subscribe and applies it before activation", async ({
  desktop,
}) => {
  const row = desktop.row(desktop.inactive, sampleMods.weapons.name);
  await row.locator(".mod-row-main").dblclick();

  const projected = desktop.row(desktop.active, sampleMods.weapons.name);
  await expect(projected).toContainText("Pending subscribe");
  await expect(projected).toContainText("Pending activation");
  const review = await desktop.reviewDraft();
  await expect(review.getByRole("listitem")).toHaveCount(2);
  await expect(review).toContainText("Pending subscribe");
  await expect(review).toContainText("Pending activation");
  await review.getByRole("button", { name: "Apply 2 changes", exact: true }).click();

  const applying = desktop.page.getByRole("dialog", { name: "Apply changes", exact: true });
  await expect(applying.getByText("Subscribe Workshop mods", { exact: true })).toBeVisible();
  await expect(
    applying.getByText("Update RimWorld active mods and load order", { exact: true }),
  ).toBeVisible();
  await expect(
    applying.getByText("Changes applied; RimWorld active configuration updated", { exact: true }),
  ).toBeVisible();
  await applying
    .locator(".app-modal-actions")
    .getByRole("button", { name: "Close", exact: true })
    .click();

  expect((await desktop.mod(sampleMods.weapons.id)).subscribed).toBe(true);
  expect(await desktop.activePackageIds()).toEqual([
    ...initialActivePackages,
    sampleMods.weapons.packageId,
  ]);
  expect(await desktop.calls("subscribe")).toEqual([
    { kind: "subscribe", value: sampleMods.weapons.id },
  ]);
  const mutationCalls = (await desktop.calls("ipc"))
    .map((call) => call.value)
    .filter(
      (channel) => channel === ipcChannels.setSubscription || channel === ipcChannels.setActiveMods,
    );
  expect(mutationCalls).toEqual([ipcChannels.setSubscription, ipcChannels.setActiveMods]);
});

test("deactivate plus unsubscribe writes config first and keeps the compound draft atomic", async ({
  desktop,
}) => {
  const configBefore = await readFile(desktop.config, "utf8");
  await desktop.row(desktop.active, sampleMods.harmony.name).locator(".mod-row-main").dblclick();
  const projected = desktop.row(desktop.inactive, sampleMods.harmony.name);
  await expect(projected).toContainText("Pending deactivation");
  await projected.click({ button: "right" });
  const unsubscribe = desktop.page.getByRole("menuitem", { name: "Unsubscribe", exact: true });
  await expect(unsubscribe).toBeEnabled();
  await unsubscribe.click();
  await expect(projected).toContainText("Pending unsubscribe");
  expect(await readFile(desktop.config, "utf8")).toBe(configBefore);

  const review = await desktop.reviewDraft();
  await expect(review.getByRole("listitem")).toHaveCount(2);
  await expect(review).toContainText("Pending deactivation");
  await expect(review).toContainText("Pending unsubscribe");
  await review.getByRole("button", { name: "Apply 2 changes", exact: true }).click();
  const applying = desktop.page.getByRole("dialog", { name: "Apply changes", exact: true });
  await expect(
    applying.getByText("Changes applied; RimWorld active configuration updated", { exact: true }),
  ).toBeVisible();
  await applying
    .locator(".app-modal-actions")
    .getByRole("button", { name: "Close", exact: true })
    .click();

  expect(await desktop.activePackageIds()).toEqual(
    initialActivePackages.filter((packageId) => packageId !== sampleMods.harmony.packageId),
  );
  expect(await readFile(`${desktop.config}.rimlib.bak`, "utf8")).toBe(configBefore);
  expect((await desktop.mod(sampleMods.harmony.id)).subscribed).toBe(false);
  await expect(desktop.row(desktop.inactive, sampleMods.harmony.name)).toBeVisible();
  const mutationCalls = (await desktop.calls("ipc"))
    .map((call) => call.value)
    .filter(
      (channel) => channel === ipcChannels.setSubscription || channel === ipcChannels.setActiveMods,
    );
  expect(mutationCalls).toEqual([ipcChannels.setActiveMods, ipcChannels.setSubscription]);

  await desktop.reopen();
  await expect(desktop.row(desktop.inactive, sampleMods.harmony.name)).toBeVisible();
});

test("Auto-sort stages concrete load-order moves and persists the RimSort-inspired order", async ({
  desktop,
}) => {
  const configBefore = await readFile(desktop.config, "utf8");
  const sort = desktop.active.getByRole("combobox", { name: "Sort active mods" });
  await expect(sort.getByRole("option", { name: "Load order" })).toHaveCount(1);
  await expect(sort.getByRole("option", { name: "Active first" })).toHaveCount(0);

  await desktop.active.getByRole("button", { name: "Auto-sort active mods" }).click();
  const dependencies = desktop.page.getByRole("dialog", { name: "Missing dependencies" });
  await expect(dependencies).toBeVisible();
  await expect(dependencies).toContainText("2 missing dependencies");
  const available = dependencies.getByRole("listitem").filter({ hasText: sampleMods.weapons.name });
  await expect(available).toContainText(sampleMods.weapons.packageId);
  await expect(available).toContainText("Available in Library");
  const unavailable = dependencies.getByRole("listitem").filter({ hasText: "Example Framework" });
  await expect(unavailable).toContainText("example.framework");
  await expect(unavailable).toContainText("Not available in Library");
  await expect(dependencies.getByRole("button", { name: "Add 1 & sort" })).toBeEnabled();
  await expect(desktop.page.locator(".draft-bar")).toContainText("0 pending changes");
  expect(await readFile(desktop.config, "utf8")).toBe(configBefore);

  await dependencies.getByRole("button", { name: "Sort current list", exact: true }).click();
  await expect(dependencies).toHaveCount(0);
  await expect(desktop.page.locator(".draft-bar")).toContainText("1 pending change");
  await expect(desktop.page.locator(".draft-bar")).toContainText("load order");
  expect(await readFile(desktop.config, "utf8")).toBe(configBefore);

  const review = await desktop.reviewDraft();
  const orderRow = review.getByRole("listitem").filter({ hasText: "Pending order" });
  await expect(orderRow).toContainText(sampleMods.camera.name);
  await expect(orderRow).toContainText("Auto-sort: move from position 4 to position 3");
  await expect(
    orderRow.getByRole("button", {
      name: `Undo pending load order change for ${sampleMods.camera.name}`,
    }),
  ).toBeVisible();
  await expect(review).toContainText("Pending order");
  await review.getByRole("button", { name: "Apply 1 change", exact: true }).click();
  const applying = desktop.page.getByRole("dialog", { name: "Apply changes", exact: true });
  await expect(
    applying.getByText("Changes applied; RimWorld active configuration updated", { exact: true }),
  ).toBeVisible();
  await applying
    .locator(".app-modal-actions")
    .getByRole("button", { name: "Close", exact: true })
    .click();

  expect(await desktop.activePackageIds()).toEqual([
    sampleMods.harmony.packageId,
    "ludeon.rimworld",
    sampleMods.camera.packageId,
    sampleMods.active.packageId,
  ]);
  expect(await readFile(`${desktop.config}.rimlib.bak`, "utf8")).toBe(configBefore);

  await desktop.reopen();
  expect(await desktop.activePackageIds()).toEqual([
    sampleMods.harmony.packageId,
    "ludeon.rimworld",
    sampleMods.camera.packageId,
    sampleMods.active.packageId,
  ]);
});

test("dragging an Active mod stages its projected load order and discard restores it", async ({
  desktop,
}) => {
  const configBefore = await readFile(desktop.config, "utf8");
  const names = desktop.active.locator(".mod-row-copy strong");
  const positions = desktop.active.locator(".load-order-number");
  const camera = desktop.row(desktop.active, sampleMods.camera.name);
  const harmony = desktop.row(desktop.active, sampleMods.harmony.name);

  await expect(
    desktop.active.getByRole("button", { name: "Show 2 invalid active mods" }),
  ).toBeVisible();
  await expect(names).toHaveText([
    sampleMods.harmony.name,
    "Core",
    sampleMods.active.name,
    sampleMods.camera.name,
  ]);
  await expect(positions).toHaveText(["1", "2", "3", "4"]);
  await camera.locator(".drag-handle").dragTo(harmony, {
    sourcePosition: { x: 12, y: 16 },
    targetPosition: { x: 80, y: 2 },
  });

  await expect(names).toHaveText([
    sampleMods.camera.name,
    sampleMods.harmony.name,
    "Core",
    sampleMods.active.name,
  ]);
  await expect(positions).toHaveText(["1", "2", "3", "4"]);
  await expect(desktop.page.locator(".draft-bar")).toContainText("1 pending change");
  await expect(desktop.page.locator(".draft-bar")).toContainText("load order");
  await expect(
    desktop.active.getByRole("button", { name: "Show 4 invalid active mods" }),
  ).toBeVisible();
  await expect(harmony.locator(".dependency-warning-pill")).toHaveText("1 validation error");
  expect(await readFile(desktop.config, "utf8")).toBe(configBefore);
  expect(
    (await desktop.calls("ipc")).filter((call) => call.value === ipcChannels.setActiveMods),
  ).toEqual([]);

  const review = await desktop.reviewDraft();
  await expect(review.getByText(sampleMods.camera.name, { exact: true })).toBeVisible();
  await expect(review).toContainText("Move from position 4 to position 1");
  await expect(review).toContainText("Pending order");
  await review
    .getByRole("button", {
      name: `Undo pending load order change for ${sampleMods.camera.name}`,
      exact: true,
    })
    .click();
  await review.getByRole("button", { name: "Cancel", exact: true }).click();

  await expect(names).toHaveText([
    sampleMods.harmony.name,
    "Core",
    sampleMods.active.name,
    sampleMods.camera.name,
  ]);
  await expect(positions).toHaveText(["1", "2", "3", "4"]);
  await expect(desktop.page.locator(".draft-bar")).toContainText("0 pending changes");
  await expect(
    desktop.active.getByRole("button", { name: "Show 2 invalid active mods" }),
  ).toBeVisible();
  expect(await readFile(desktop.config, "utf8")).toBe(configBefore);
  expect(
    (await desktop.calls("ipc")).filter((call) => call.value === ipcChannels.setActiveMods),
  ).toEqual([]);
});

test("a manual order draft survives deactivation and applies the combined projection", async ({
  desktop,
}) => {
  await desktop.row(desktop.active, sampleMods.camera.name).click({ button: "right" });
  await desktop.page.getByRole("menuitem", { name: "Move to position…", exact: true }).click();
  const move = desktop.page.getByRole("dialog", { name: "Move active mod", exact: true });
  await move.getByLabel(/^Position/).fill("1");
  await move.getByRole("button", { name: "Stage move", exact: true }).click();

  await desktop.row(desktop.active, sampleMods.active.name).locator(".mod-row-main").dblclick();
  await expect(desktop.active.locator(".mod-row-copy strong")).toHaveText([
    sampleMods.camera.name,
    sampleMods.harmony.name,
    "Core",
  ]);
  await expect(desktop.page.locator(".draft-bar")).toContainText("2 pending changes");

  const review = await desktop.reviewDraft();
  await expect(review.getByRole("listitem")).toHaveCount(2);
  const orderRow = review.getByRole("listitem").filter({ hasText: sampleMods.camera.name });
  await expect(orderRow).toContainText("Move from position 4 to position 1");
  await expect(
    orderRow.getByRole("button", {
      name: `Undo pending load order change for ${sampleMods.camera.name}`,
    }),
  ).toBeVisible();
  await expect(
    review.getByRole("listitem").filter({ hasText: sampleMods.active.name }),
  ).toContainText("Pending deactivation");

  await review.getByRole("button", { name: "Apply 2 changes", exact: true }).click();
  const applying = desktop.page.getByRole("dialog", { name: "Apply changes", exact: true });
  await expect(
    applying.getByText("Changes applied; RimWorld active configuration updated", { exact: true }),
  ).toBeVisible();
  await applying
    .locator(".app-modal-actions")
    .getByRole("button", { name: "Close", exact: true })
    .click();

  expect(await desktop.activePackageIds()).toEqual([
    sampleMods.camera.packageId,
    sampleMods.harmony.packageId,
    "ludeon.rimworld",
  ]);
  expect(
    (await desktop.calls("ipc")).filter((call) => call.value === ipcChannels.setActiveMods),
  ).toHaveLength(1);
});

test("Move to position stages an Active order change and applies it only on confirmation", async ({
  desktop,
}) => {
  const configBefore = await readFile(desktop.config, "utf8");
  const names = desktop.active.locator(".mod-row-copy strong");
  const positions = desktop.active.locator(".load-order-number");

  await desktop.row(desktop.active, sampleMods.active.name).click({ button: "right" });
  await desktop.page.getByRole("menuitem", { name: "Move to position…", exact: true }).click();
  const move = desktop.page.getByRole("dialog", { name: "Move active mod", exact: true });
  await expect(move).toContainText(sampleMods.active.name);
  await expect(move.getByLabel(/^Position/)).toHaveValue("3");
  await move.getByLabel(/^Position/).fill("1");
  await move.getByRole("button", { name: "Stage move", exact: true }).click();

  await expect(move).toHaveCount(0);
  await expect(names).toHaveText([
    sampleMods.active.name,
    sampleMods.harmony.name,
    "Core",
    sampleMods.camera.name,
  ]);
  await expect(positions).toHaveText(["1", "2", "3", "4"]);
  await expect(desktop.page.locator(".draft-bar")).toContainText("1 pending change");
  await expect(desktop.page.locator(".draft-bar")).toContainText("load order");
  expect(await readFile(desktop.config, "utf8")).toBe(configBefore);
  expect(
    (await desktop.calls("ipc")).filter((call) => call.value === ipcChannels.setActiveMods),
  ).toEqual([]);

  await desktop.applyDraft();
  expect(await desktop.activePackageIds()).toEqual([
    sampleMods.active.packageId,
    sampleMods.harmony.packageId,
    "ludeon.rimworld",
    sampleMods.camera.packageId,
  ]);
  expect(await readFile(`${desktop.config}.rimlib.bak`, "utf8")).toBe(configBefore);
  expect(
    (await desktop.calls("ipc")).filter((call) => call.value === ipcChannels.setActiveMods),
  ).toHaveLength(1);

  await desktop.reopen();
  await expect(desktop.active.locator(".mod-row-copy strong")).toHaveText([
    sampleMods.active.name,
    sampleMods.harmony.name,
    "Core",
    sampleMods.camera.name,
  ]);
  await expect(desktop.active.locator(".load-order-number")).toHaveText(["1", "2", "3", "4"]);
});

test("manual order drafts stay separate while Auto-sort replaces only the earlier order history", async ({
  desktop,
}) => {
  const names = desktop.active.locator(".mod-row-copy strong");

  async function stageMove(name: string, initialPosition: number, destination: number) {
    await desktop.row(desktop.active, name).click({ button: "right" });
    await desktop.page.getByRole("menuitem", { name: "Move to position…", exact: true }).click();
    const move = desktop.page.getByRole("dialog", { name: "Move active mod", exact: true });
    await expect(move).toContainText(name);
    await expect(move.getByLabel(/^Position/)).toHaveValue(String(initialPosition));
    await move.getByLabel(/^Position/).fill(String(destination));
    await move.getByRole("button", { name: "Stage move", exact: true }).click();
    await expect(move).toHaveCount(0);
  }

  await stageMove(sampleMods.harmony.name, 1, 2);
  await expect(names).toHaveText([
    "Core",
    sampleMods.harmony.name,
    sampleMods.active.name,
    sampleMods.camera.name,
  ]);
  await stageMove(sampleMods.camera.name, 4, 3);
  await expect(names).toHaveText([
    "Core",
    sampleMods.harmony.name,
    sampleMods.camera.name,
    sampleMods.active.name,
  ]);
  await expect(desktop.page.locator(".draft-bar")).toContainText("2 pending changes");
  await expect(desktop.page.locator(".draft-bar")).toContainText("2 load order changes");

  const manualReview = await desktop.reviewDraft();
  const manualRows = manualReview.locator(".draft-review-list > li");
  await expect(manualRows).toHaveCount(2);
  await expect(manualRows.nth(0)).toContainText(sampleMods.harmony.name);
  await expect(manualRows.nth(0)).toContainText("Move from position 1 to position 2");
  await expect(manualRows.nth(1)).toContainText(sampleMods.camera.name);
  await expect(manualRows.nth(1)).toContainText("Move from position 4 to position 3");
  await manualReview.getByRole("button", { name: "Cancel", exact: true }).click();

  await desktop.active.getByRole("button", { name: "Auto-sort active mods" }).click();
  const dependencies = desktop.page.getByRole("dialog", { name: "Missing dependencies" });
  await expect(dependencies).toBeVisible();
  await dependencies.getByRole("button", { name: "Sort current list", exact: true }).click();
  await expect(dependencies).toHaveCount(0);
  await expect(names).toHaveText([
    sampleMods.harmony.name,
    "Core",
    sampleMods.camera.name,
    sampleMods.active.name,
  ]);
  await expect(desktop.page.locator(".draft-bar")).toContainText("1 pending change");

  const autoReview = await desktop.reviewDraft();
  const autoRows = autoReview.locator(".draft-review-list > li");
  await expect(autoRows).toHaveCount(1);
  await expect(autoRows.nth(0)).toContainText(sampleMods.camera.name);
  await expect(autoRows.nth(0)).toContainText("Auto-sort: move from position 4 to position 3");
  await expect(autoRows.nth(0)).toContainText("Pending order");
  await autoReview.getByRole("button", { name: "Cancel", exact: true }).click();

  await stageMove(sampleMods.active.name, 4, 1);
  await expect(names).toHaveText([
    sampleMods.active.name,
    sampleMods.harmony.name,
    "Core",
    sampleMods.camera.name,
  ]);
  await expect(desktop.page.locator(".draft-bar")).toContainText("2 pending changes");
  await expect(desktop.page.locator(".draft-bar")).toContainText("2 load order changes");

  const combinedReview = await desktop.reviewDraft();
  const combinedRows = combinedReview.locator(".draft-review-list > li");
  await expect(combinedRows).toHaveCount(2);
  await expect(combinedRows.nth(0)).toContainText(sampleMods.camera.name);
  await expect(combinedRows.nth(0)).toContainText("Auto-sort: move from position 4 to position 3");
  await expect(combinedRows.nth(1)).toContainText(sampleMods.active.name);
  await expect(combinedRows.nth(1)).toContainText("Move from position 4 to position 1");
  expect(
    (await desktop.calls("ipc")).filter((call) => call.value === ipcChannels.setActiveMods),
  ).toEqual([]);

  await combinedReview.getByRole("button", { name: "Apply 2 changes", exact: true }).click();
  const applying = desktop.page.getByRole("dialog", { name: "Apply changes", exact: true });
  await expect(
    applying.getByText("Changes applied; RimWorld active configuration updated", { exact: true }),
  ).toBeVisible();
  await applying
    .locator(".app-modal-actions")
    .getByRole("button", { name: "Close", exact: true })
    .click();

  expect(await desktop.activePackageIds()).toEqual([
    sampleMods.active.packageId,
    sampleMods.harmony.packageId,
    "ludeon.rimworld",
    sampleMods.camera.packageId,
  ]);
  expect(
    (await desktop.calls("ipc")).filter((call) => call.value === ipcChannels.setActiveMods),
  ).toHaveLength(1);
});

test("Auto-sort can stage an available dependency, subscription and load order together", async ({
  desktop,
}) => {
  const configBefore = await readFile(desktop.config, "utf8");
  await expect
    .poll(async () => (await desktop.mod(sampleMods.other.id)).gameVersions)
    .toEqual(["1.6"]);
  const vaultBefore = await desktop.vault();

  await desktop.active.getByRole("button", { name: "Auto-sort active mods" }).click();
  const dependencies = desktop.page.getByRole("dialog", { name: "Missing dependencies" });
  await expect(dependencies).toBeVisible();
  await dependencies.getByRole("button", { name: "Add 1 & sort", exact: true }).click();

  const dependency = desktop.row(desktop.active, sampleMods.weapons.name);
  await expect(dependencies).toHaveCount(0);
  await expect(dependency).toContainText("Pending subscribe");
  await expect(dependency).toContainText("Pending activation");
  await expect(desktop.page.locator(".draft-bar")).toContainText("3 pending changes");
  await expect(desktop.page.locator(".draft-bar")).toContainText("1 subscribe");
  await expect(desktop.page.locator(".draft-bar")).toContainText("1 activate");
  await expect(desktop.page.locator(".draft-bar")).toContainText("load order");
  expect(await readFile(desktop.config, "utf8")).toBe(configBefore);
  await expect.poll(async () => (await desktop.vault()).pendingDraft?.changes.length).toBe(2);
  await expect
    .poll(async () => (await desktop.vault()).pendingDraft?.activeOrderOperations.length)
    .toBe(1);
  const stagedVault = await desktop.vault();
  expect(stagedVault.mods).toEqual(vaultBefore.mods);
  expect(stagedVault.userTags).toEqual(vaultBefore.userTags);
  expect(stagedVault.settings).toEqual(vaultBefore.settings);
  expect(stagedVault.localSteamState).toEqual(vaultBefore.localSteamState);
  expect(await desktop.calls("subscribe")).toEqual([]);

  const review = await desktop.reviewDraft();
  await expect(review.getByRole("listitem")).toHaveCount(3);
  await expect(review).toContainText("Pending subscribe");
  await expect(review).toContainText("Pending activation");
  await expect(review).toContainText(sampleMods.weapons.name);
  await expect(review).toContainText("Auto-sort: move from position 5 to position 3");
  await expect(review).toContainText("Pending order");
  expect(await readFile(desktop.config, "utf8")).toBe(configBefore);
  expect(await desktop.calls("subscribe")).toEqual([]);

  await review.getByRole("button", { name: "Apply 3 changes", exact: true }).click();
  const applying = desktop.page.getByRole("dialog", { name: "Apply changes", exact: true });
  await expect(
    applying.getByText("Changes applied; RimWorld active configuration updated", { exact: true }),
  ).toBeVisible();
  await applying
    .locator(".app-modal-actions")
    .getByRole("button", { name: "Close", exact: true })
    .click();

  expect(await desktop.activePackageIds()).toEqual([
    sampleMods.harmony.packageId,
    "ludeon.rimworld",
    sampleMods.weapons.packageId,
    sampleMods.active.packageId,
    sampleMods.camera.packageId,
  ]);
  expect((await desktop.mod(sampleMods.weapons.id)).subscribed).toBe(true);
  expect(await desktop.calls("subscribe")).toEqual([
    { kind: "subscribe", value: sampleMods.weapons.id },
  ]);
  const mutationCalls = (await desktop.calls("ipc"))
    .map((call) => call.value)
    .filter(
      (channel) => channel === ipcChannels.setSubscription || channel === ipcChannels.setActiveMods,
    );
  expect(mutationCalls).toEqual([ipcChannels.setSubscription, ipcChannels.setActiveMods]);
});

test("Auto-sort rejects a dependency decision made stale by a manual Workshop sync", async ({
  desktop,
}) => {
  await desktop.active.getByRole("button", { name: "Auto-sort active mods" }).click();
  const dependencies = desktop.page.getByRole("dialog", { name: "Missing dependencies" });
  const sortCurrent = dependencies.getByRole("button", {
    name: "Sort current list",
    exact: true,
  });
  const addAndSort = dependencies.getByRole("button", { name: "Add 1 & sort", exact: true });
  const cancel = dependencies.getByRole("button", { name: "Cancel", exact: true });
  await expect(dependencies).toContainText("2 missing dependencies");

  await desktop.setControls({
    ipcDelays: { [ipcChannels.getActiveModConfiguration]: 1_000 },
  });
  await writeFile(
    desktop.config,
    configXml(
      initialActivePackages.filter((packageId) => packageId !== sampleMods.camera.packageId),
    ),
  );
  await desktop.page
    .getByRole("button", { name: "Sync Workshop", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
    });

  await expect(dependencies).toContainText("Checking active mods...", { timeout: 800 });
  await expect(sortCurrent).toBeDisabled();
  await expect(addAndSort).toBeDisabled();
  await expect(cancel).toBeEnabled();

  await expect(sortCurrent).toBeEnabled({ timeout: 3_000 });
  await expect(desktop.row(desktop.inactive, sampleMods.camera.name)).toBeVisible();
  await expect(dependencies).toContainText("2 missing dependencies");
  await sortCurrent.click();

  await expect(desktop.page.getByRole("alert")).toContainText(
    "Active mods or dependency metadata changed. Review the refreshed dependencies before sorting.",
  );
  await expect(dependencies).toContainText("1 missing dependency");
  await expect(dependencies).toContainText("Example Framework");
  await expect(dependencies).not.toContainText(sampleMods.weapons.name);
  await expect(desktop.page.locator(".draft-bar")).toContainText("0 pending changes");
  expect(
    (await desktop.calls("ipc")).filter((call) => call.value === ipcChannels.setActiveMods),
  ).toEqual([]);

  await cancel.click();
  await expect(dependencies).toHaveCount(0);
  await expect(desktop.page.locator(".draft-bar")).toContainText("0 pending changes");
});
