import { sampleMods, sampleTags } from "./data";
import { expect, test } from "./fixtures";

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

test("tag colors are readable, actions point inward and context-menu hover is visible", async ({
  desktop,
}) => {
  const camera = desktop.row(desktop.library, sampleMods.camera.name);
  const light = camera.locator(".user-tag");
  await expect(light).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(light).toHaveCSS("color", "rgb(0, 0, 0)");
  const weapons = desktop.row(desktop.library, sampleMods.weapons.name);
  await expect(weapons.locator(".user-tag")).toHaveCSS("color", "rgb(255, 255, 255)");
  expect(
    await camera
      .locator(".mod-row-main")
      .evaluate((element) => element.nextElementSibling?.classList.contains("tooltip-action")),
  ).toBe(true);
  expect(
    await desktop
      .row(desktop.subscribed, sampleMods.spare.name)
      .locator(".mod-row-main")
      .evaluate((element) => element.previousElementSibling?.classList.contains("tooltip-action")),
  ).toBe(true);
  await camera.click({ button: "right" });
  const item = desktop.page.getByRole("menuitem", { name: "Add tags", exact: true });
  await desktop.page.mouse.move(5, 5);
  const before = await item.evaluate((element) => getComputedStyle(element).backgroundColor);
  await item.hover();
  await expect
    .poll(() => item.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe(before);
  await desktop.page.keyboard.press("Escape");
  await expect(desktop.page.getByRole("menu")).toHaveCount(0);
});

test("notification title is visually stronger than its description", async ({ desktop }) => {
  await desktop.row(desktop.library, sampleMods.camera.name).locator(".mod-row-main").click();
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
    await desktop.row(desktop.library, sampleMods.camera.name).locator(".mod-row-main").click();
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
