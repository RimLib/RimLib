import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ipcChannels } from "../../src/shared/ipc";
import { configXml, initialActivePackages, sampleMods, sampleTags } from "./data";
import { expect, test } from "./fixtures";

test("active rows and deactivation drafts survive installed metadata loading", async ({
  desktop,
}) => {
  // Stop the initial app before creating the folder so its in-flight scanner cannot persist the
  // metadata before this test observes the deliberate config-only placeholder state.
  await desktop.close();
  const unsavedWorkshopAbout = join(desktop.workshop, "999", "About");
  await mkdir(unsavedWorkshopAbout, { recursive: true });
  await writeFile(
    join(unsavedWorkshopAbout, "About.xml"),
    "<ModMetaData><name>First Workshop</name><author>Workshop Author</author><packageId>example.unsaved-workshop</packageId><description>Workshop metadata.</description></ModMetaData>",
  );
  await writeFile(
    desktop.config,
    configXml(["example.unsaved-workshop", ...initialActivePackages]),
  );
  await desktop.setControls({ ipcDelays: { [ipcChannels.getInstalledMods]: 4_000 } });
  await desktop.launch();

  const list = desktop.active.getByRole("list");
  const core = desktop.row(desktop.active, "Core");
  const placeholder = desktop.row(desktop.active, "example.unsaved-workshop");
  await Promise.all([
    expect(placeholder).toBeVisible({ timeout: 2_000 }),
    expect(desktop.row(desktop.active, sampleMods.camera.name)).toBeVisible({ timeout: 2_000 }),
    expect(core).toBeVisible({ timeout: 2_000 }),
    expect(list).toHaveAttribute("aria-busy", "true", { timeout: 2_000 }),
    expect(desktop.active.getByRole("status")).toContainText("Loading mod details…", {
      timeout: 2_000,
    }),
  ]);
  await expect(placeholder.locator(".mod-row-main")).toHaveAttribute("aria-pressed", "true");
  await expect(desktop.infoName).toHaveText("example.unsaved-workshop");
  await expect(desktop.info.locator(".mod-source")).toHaveText("local");
  expect(await list.evaluate((element) => element.scrollTop)).toBe(0);
  await placeholder.locator(".mod-row-main").dblclick();
  const stagedPlaceholder = desktop.row(desktop.library, "example.unsaved-workshop");
  await expect(stagedPlaceholder).toContainText("Pending deactivation");
  await expect(desktop.library.locator(".mod-row-copy strong").first()).toHaveText(
    "example.unsaved-workshop",
  );
  await expect(desktop.active).not.toHaveAttribute("aria-busy", /.+/);
  await expect(desktop.active.getByText("No active mods", { exact: true })).toHaveCount(0);
  await expect(core.locator(".thumb")).not.toHaveClass(/has-image/);

  await expect(list).toHaveAttribute("aria-busy", "false", { timeout: 7_000 });
  await expect(desktop.active.getByRole("status")).toHaveCount(0);
  await expect(desktop.active.locator(".count-badge")).toHaveText("4 mods");
  await expect(placeholder).toHaveCount(0);
  await expect(stagedPlaceholder).toHaveCount(0);
  const installedInactive = desktop.row(desktop.library, "First Workshop");
  await expect(installedInactive).toContainText("Pending deactivation");
  await expect(desktop.library.locator(".mod-row-copy strong").first()).toHaveText(
    "First Workshop",
  );
  await installedInactive.locator(".mod-row-main").dblclick();
  await expect(desktop.page.locator(".draft-bar")).toContainText("0 pending changes");
  await expect(desktop.active.locator(".count-badge")).toHaveText("5 mods");
  const installed = desktop.row(desktop.active, "First Workshop");
  await expect(installed.locator(".mod-row-main")).toHaveAttribute("aria-pressed", "true");
  await expect(desktop.infoName).toHaveText("First Workshop");
  await expect(desktop.info.locator(".mod-source")).toHaveText("steam");
  expect(await list.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(core.locator(".thumb")).toHaveClass(/has-image/);
  await expect(core.locator(".thumb img")).toHaveAttribute(
    "src",
    "rimlib-official-image://preview/ludeon.rimworld",
  );
});

test("tag search uses one input border and tooltips escape the modal", async ({ desktop }) => {
  await desktop.page.getByRole("button", { name: "Manage Tags", exact: true }).click();
  const dialog = desktop.page.getByRole("dialog", { name: "Tags", exact: true });
  const search = dialog.getByRole("textbox", { name: "Search tags", exact: true });
  const tagRows = dialog.getByRole("listitem");
  await expect(tagRows.first()).toHaveCSS("border-bottom-width", "1px");
  await expect(tagRows.last()).toHaveCSS("border-bottom-width", "0px");
  await expect(search).toHaveCSS("border-top-width", "0px");
  await expect(search).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const searchRect = await search.boundingBox();
  const outerRect = await search.locator("..").boundingBox();
  expect(searchRect).not.toBeNull();
  expect(outerRect).not.toBeNull();
  expect(searchRect?.height).toBeLessThanOrEqual(outerRect?.height ?? 0);
  await dialog.getByRole("button", { name: `Delete ${sampleTags.qol.name}` }).hover();
  const tooltip = desktop.page.getByRole("tooltip").filter({ hasText: "Delete tag" });
  await expect(tooltip).toBeVisible();
  expect(
    await tooltip.locator("..").evaluate((element) => Number(getComputedStyle(element).zIndex)),
  ).toBeGreaterThan(1000);
  expect(
    await tooltip.locator("..").evaluate((element) => element.parentElement === document.body),
  ).toBe(true);
  const bounds = await tooltip.boundingBox();
  const viewport = await desktop.page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
  expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(viewport.height);
});

test("tag colors are readable, rows omit inline actions and context-menu hover is visible", async ({
  desktop,
}) => {
  const camera = desktop.row(desktop.subscribed, sampleMods.camera.name);
  const light = camera.locator(".user-tag");
  await expect(light).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(light).toHaveCSS("color", "rgb(0, 0, 0)");
  const weapons = desktop.row(desktop.library, sampleMods.weapons.name);
  await expect(weapons.locator(".user-tag")).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(camera.locator(".tooltip-action")).toHaveCount(0);
  await expect(weapons.locator(".tooltip-action")).toHaveCount(0);
  const menu = await desktop.openContextMenu(weapons);
  const item = menu.getByRole("menuitem", { name: "Add tags", exact: true });
  await desktop.page.mouse.move(5, 5);
  const before = await item.evaluate((element) => getComputedStyle(element).backgroundColor);
  await item.hover();
  await expect
    .poll(() => item.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe(before);
  await desktop.page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});

test("context menus ignore stale scroll notifications and close when their list moves", async ({
  desktop,
}) => {
  await desktop.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.setSize(1180, 720),
  );
  const list = desktop.library.getByRole("list");
  await expect
    .poll(() => list.evaluate((element) => element.scrollHeight > element.clientHeight))
    .toBe(true);
  const menu = await desktop.openContextMenu(desktop.row(desktop.library, sampleMods.weapons.name));

  await list.dispatchEvent("scroll");
  await expect(menu).toBeVisible();

  const moved = await list.evaluate((element) => {
    const previous = element.scrollTop;
    element.scrollTop = previous === 0 ? element.scrollHeight : 0;
    element.dispatchEvent(new Event("scroll"));
    return element.scrollTop !== previous;
  });
  expect(moved).toBe(true);
  await expect(menu).toHaveCount(0);
});

test("pending changes use outlined icon indicators instead of filled tags", async ({ desktop }) => {
  const libraryRow = desktop.row(desktop.library, sampleMods.weapons.name);
  await libraryRow.locator(".mod-row-main").dblclick();

  const activeRow = desktop.row(desktop.active, sampleMods.weapons.name);
  const indicators = activeRow.locator(".draft-badge");
  await expect(indicators).toHaveCount(2);
  for (const indicator of await indicators.all()) {
    await expect(indicator).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(indicator).toHaveCSS("border-top-width", "1px");
    await expect(indicator.locator("svg.lucide-clock-3")).toBeVisible();
  }
  await expect(activeRow.locator(".user-tag")).not.toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
});

test("notification title is visually stronger than its description", async ({ desktop }) => {
  await desktop.row(desktop.library, sampleMods.weapons.name).locator(".mod-row-main").click();
  await desktop.info.getByRole("link", { name: "Open mod folder" }).click();
  const alert = desktop.page.getByRole("alert");
  await expect(alert).toContainText("Action failed");
  const titleWeight = await alert
    .locator("strong")
    .evaluate((element) => Number(getComputedStyle(element).fontWeight));
  const bodyWeight = await alert
    .locator("p")
    .evaluate((element) => Number(getComputedStyle(element).fontWeight));
  expect(titleWeight).toBeGreaterThanOrEqual(700);
  expect(titleWeight).toBeGreaterThan(bodyWeight);
});

test("Auto-sort matches the active-panel header control sizing and spacing", async ({
  desktop,
}) => {
  const autoSort = desktop.subscribed.locator("button.auto-sort-action");
  const count = desktop.subscribed.locator(".count-badge");
  await expect(autoSort).toBeVisible();
  await expect(count).toBeVisible();

  const [autoSortBounds, countBounds] = await Promise.all([
    autoSort.boundingBox(),
    count.boundingBox(),
  ]);
  expect(autoSortBounds).not.toBeNull();
  expect(countBounds).not.toBeNull();
  expect(autoSortBounds?.height).toBe(countBounds?.height);
  expect(autoSortBounds?.y).toBeCloseTo(countBounds?.y ?? 0, 1);
  expect(
    (countBounds?.x ?? 0) - ((autoSortBounds?.x ?? 0) + (autoSortBounds?.width ?? 0)),
  ).toBeCloseTo(8, 1);
  expect(await autoSort.evaluate((element) => getComputedStyle(element).fontSize)).toBe(
    await count.evaluate((element) => getComputedStyle(element).fontSize),
  );
});

test("Core marker, compact Mod Info actions and expandable descriptions stay visually distinct", async ({
  desktop,
}) => {
  const coreMarker = desktop.row(desktop.active, "Core").locator(".official-marker");
  await expect(coreMarker).toContainText("Core");
  await expect(coreMarker.locator("svg.lucide-shield-check")).toBeVisible();
  await expect(coreMarker).toHaveCSS("color", "rgb(131, 185, 232)");
  await expect(coreMarker).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(coreMarker).toHaveCSS("border-top-width", "0px");

  await desktop.row(desktop.library, sampleMods.other.name).locator(".mod-row-main").click();
  const unsubscribe = desktop.info.getByRole("button", { name: "Unsubscribe", exact: true });
  const removed = desktop.info.getByRole("button", { name: "Removed", exact: true });
  const [unsubscribeBounds, removedBounds] = await Promise.all([
    unsubscribe.boundingBox(),
    removed.boundingBox(),
  ]);
  expect(unsubscribeBounds).not.toBeNull();
  expect(removedBounds).not.toBeNull();
  expect(unsubscribeBounds?.y).toBeCloseTo(removedBounds?.y ?? 0, 1);
  expect(unsubscribeBounds?.height).toBeCloseTo(removedBounds?.height ?? 0, 1);

  await desktop.row(desktop.active, sampleMods.camera.name).locator(".mod-row-main").click();
  const summary = desktop.info.locator(".summary");
  const expand = desktop.info.getByRole("button", { name: "Expand mod description" });
  await expect(summary).toHaveClass(/summary-clamped/);
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expect(expand).toContainText("More");
  await expand.click();
  await expect(summary).not.toHaveClass(/summary-clamped/);
  const collapse = desktop.info.getByRole("button", { name: "Collapse mod description" });
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await expect(collapse).toContainText("Less");

  await desktop.row(desktop.library, sampleMods.weapons.name).locator(".mod-row-main").click();
  await expect(desktop.info.locator(".summary-toggle")).toHaveCount(0);
  await desktop.row(desktop.active, sampleMods.camera.name).locator(".mod-row-main").click();
  await expect(
    desktop.info.getByRole("button", { name: "Expand mod description" }),
  ).toHaveAttribute("aria-expanded", "false");
});

test("Steam and local source labels sit at the top-right of the Mod Info image", async ({
  desktop,
}) => {
  for (const { panel, name, source } of [
    { panel: desktop.library, name: sampleMods.other.name, source: "steam" },
    { panel: desktop.active, name: "Core", source: "local" },
  ]) {
    await desktop.row(panel, name).locator(".mod-row-main").click();
    const visual = desktop.info.locator(".mod-visual");
    const label = visual.locator(":scope > .mod-source");
    await expect(label).toHaveText(source);

    const [visualBounds, labelBounds] = await Promise.all([
      visual.boundingBox(),
      label.boundingBox(),
    ]);
    expect(visualBounds).not.toBeNull();
    expect(labelBounds).not.toBeNull();
    const topInset = (labelBounds?.y ?? 0) - (visualBounds?.y ?? 0);
    const rightInset =
      (visualBounds?.x ?? 0) +
      (visualBounds?.width ?? 0) -
      ((labelBounds?.x ?? 0) + (labelBounds?.width ?? 0));
    expect(topInset).toBeGreaterThanOrEqual(8);
    expect(topInset).toBeLessThanOrEqual(10);
    expect(rightInset).toBeGreaterThanOrEqual(8);
    expect(rightInset).toBeLessThanOrEqual(10);
    expect((labelBounds?.y ?? 0) + (labelBounds?.height ?? 0) / 2).toBeLessThan(
      (visualBounds?.y ?? 0) + (visualBounds?.height ?? 0) / 2,
    );
    expect((labelBounds?.x ?? 0) + (labelBounds?.width ?? 0) / 2).toBeGreaterThan(
      (visualBounds?.x ?? 0) + (visualBounds?.width ?? 0) / 2,
    );
  }
});

for (const size of [
  { width: 1440, height: 900 },
  { width: 1180, height: 720 },
]) {
  test(`panels stay framed at ${size.width}x${size.height} without horizontal info scrolling`, async ({
    desktop,
  }, testInfo) => {
    await desktop.app.evaluate(
      ({ BrowserWindow }, dimensions) =>
        BrowserWindow.getAllWindows()[0]?.setSize(dimensions.width, dimensions.height),
      size,
    );
    await desktop.row(desktop.library, sampleMods.weapons.name).locator(".mod-row-main").click();
    await expect(desktop.info).toBeVisible();
    expect(
      await desktop.info.evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    expect(
      await desktop.info
        .locator(".mod-info")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await expect(desktop.library).toBeVisible();
    await expect(desktop.subscribed).toBeVisible();
    expect(
      await desktop.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    await testInfo.attach("layout", {
      body: await desktop.page.screenshot(),
      contentType: "image/png",
    });
  });
}
