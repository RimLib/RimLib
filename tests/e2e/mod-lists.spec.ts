import { readFile } from "node:fs/promises";

import { parseRimWorldModListXml } from "../../src/main/modListFiles";
import { ipcChannels } from "../../src/shared/ipc";
import { initialActivePackages, sampleMods } from "./data";
import { expect, test } from "./fixtures";

test("imports an XML list as a reviewable draft and exports its projected Active order", async ({
  desktop,
}) => {
  const configBefore = await readFile(desktop.config, "utf8");
  const importButton = desktop.page.getByRole("button", { name: "Import mod list", exact: true });

  await importButton.click();
  const preview = desktop.page.getByRole("dialog", {
    name: "Load RimWorld mod list",
    exact: true,
  });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("import.xml");
  await expect(preview).toContainText("1.6.4871 rev595");
  await expect(preview.getByText("Available in RimLib").locator("+ dd")).toHaveText("4");
  await expect(preview.getByText("Unavailable", { exact: true }).locator("+ dd")).toHaveText("1");
  await expect(preview.getByText("Current mods to deactivate").locator("+ dd")).toHaveText("1");
  await expect(preview.getByRole("list", { name: "Unavailable package IDs" })).toHaveText(
    "example.missing",
  );
  expect(await readFile(desktop.config, "utf8")).toBe(configBefore);
  await expect(desktop.page.locator(".draft-bar")).toContainText("0 pending changes");

  await preview.getByRole("button", { name: "Stage 4 available mods only", exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect(desktop.page.locator(".draft-bar")).toContainText("4 pending changes");
  await expect(desktop.page.locator(".draft-bar")).toContainText("1 subscribe");
  await expect(desktop.page.locator(".draft-bar")).toContainText("1 activate");
  await expect(desktop.page.locator(".draft-bar")).toContainText("1 deactivate");
  await expect(desktop.page.locator(".draft-bar")).toContainText("load order");
  await expect(desktop.active.locator(".mod-row-copy strong")).toHaveText([
    sampleMods.harmony.name,
    "Core",
    sampleMods.weapons.name,
    sampleMods.active.name,
  ]);
  await expect(desktop.row(desktop.active, sampleMods.weapons.name)).toContainText(
    "Pending activation",
  );
  await expect(desktop.row(desktop.inactive, sampleMods.camera.name)).toContainText(
    "Pending deactivation",
  );
  expect(await readFile(desktop.config, "utf8")).toBe(configBefore);

  await desktop.page.getByRole("button", { name: "Export mod list", exact: true }).click();
  await expect(
    desktop.page.getByRole("status").filter({ hasText: "Exported 4 mods" }),
  ).toContainText("export.xml");
  const exported = parseRimWorldModListXml(await readFile(desktop.modListExport, "utf8"));
  expect(exported.version).toBe("1.6");
  expect(exported.activeMods).toEqual([
    sampleMods.harmony.packageId,
    "ludeon.rimworld",
    sampleMods.weapons.packageId,
    sampleMods.active.packageId,
  ]);
  expect(exported.knownExpansions).toEqual([
    "ludeon.rimworld.royalty",
    "ludeon.rimworld.ideology",
    "ludeon.rimworld.biotech",
    "ludeon.rimworld.anomaly",
    "ludeon.rimworld.odyssey",
  ]);
  expect(await readFile(desktop.config, "utf8")).toBe(configBefore);

  const review = await desktop.reviewDraft();
  await expect(review.getByRole("listitem")).toHaveCount(4);
  await expect(review).toContainText("import.xml");
  await review.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await readFile(desktop.config, "utf8")).toBe(configBefore);

  await desktop.applyDraft();
  expect(await desktop.activePackageIds()).toEqual(exported.activeMods);
  expect(await readFile(`${desktop.config}.rimlib.bak`, "utf8")).toBe(configBefore);
  expect((await desktop.mod(sampleMods.weapons.id)).subscribed).toBe(true);
  expect(
    (await desktop.calls("ipc")).filter(
      (call) =>
        call.value === ipcChannels.importModList ||
        call.value === ipcChannels.exportModList ||
        call.value === ipcChannels.setActiveMods,
    ),
  ).toEqual([
    { kind: "ipc", value: ipcChannels.importModList },
    { kind: "ipc", value: ipcChannels.exportModList },
    { kind: "ipc", value: ipcChannels.setActiveMods },
  ]);
});

test("cancelling the native XML dialogs leaves the current configuration untouched", async ({
  desktop,
}) => {
  const configBefore = await readFile(desktop.config, "utf8");
  await desktop.setControls({ cancelDialog: true });

  await desktop.page.getByRole("button", { name: "Import mod list", exact: true }).click();
  await expect
    .poll(async () =>
      (await desktop.calls("ipc")).filter((call) => call.value === ipcChannels.importModList),
    )
    .toHaveLength(1);
  await expect(desktop.page.getByRole("dialog", { name: "Load RimWorld mod list" })).toHaveCount(0);
  await expect(desktop.page.locator(".draft-bar")).toContainText("0 pending changes");

  await desktop.page.getByRole("button", { name: "Export mod list", exact: true }).click();
  await expect
    .poll(async () =>
      (await desktop.calls("ipc")).filter((call) => call.value === ipcChannels.exportModList),
    )
    .toHaveLength(1);
  await expect(readFile(desktop.modListExport, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(desktop.config, "utf8")).toBe(configBefore);
  expect(await desktop.activePackageIds()).toEqual(initialActivePackages);
});
