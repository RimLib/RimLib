import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  _electron,
  type ElectronApplication,
  expect,
  type Locator,
  type Page,
  test as base,
} from "@playwright/test";

import { vaultFileName } from "../../src/shared/storage";
import type { Mod, ModVault } from "../../src/shared/types";
import { requireValue } from "../../src/shared/validation";
import { normalizeVault, serializeVault } from "../../src/shared/vault";
import { vaultSchemaVersion } from "../../src/shared/vaultValidation";
import { type Controls, harness, type NativeCall, verifyFixture } from "./contracts";
import { aboutXml, configXml, initialSubscribedIds, sampleVault } from "./data";

export type Scenario =
  "populated" | "empty" | "corrupt" | "future" | "offline" | "disconnected" | "large";

export class Desktop {
  readonly token = randomUUID();
  readonly errors: string[] = [];
  readonly config: string;
  readonly workshop: string;
  readonly database: string;
  private application?: ElectronApplication;
  private window?: Page;
  private launches = 0;
  private tracing = false;

  constructor(
    readonly root: string,
    private artifactPath: (name: string) => string,
  ) {
    this.config = join(root, "game-config", "ModsConfig.xml");
    this.workshop = join(
      root,
      "Steam library with spaces",
      "steamapps",
      "workshop",
      "content",
      "294100",
    );
    this.database = join(root, "user-data", vaultFileName);
  }

  get app(): ElectronApplication {
    return requireValue(this.application);
  }

  get page(): Page {
    return requireValue(this.window);
  }

  get library(): Locator {
    return this.page.locator(".unsubscribed-panel");
  }

  get subscribed(): Locator {
    return this.page.locator(".subscribed-panel");
  }

  get info(): Locator {
    return this.page.getByRole("complementary", { name: "Mod Info" });
  }

  get infoName(): Locator {
    return this.info.locator(".info-heading h2");
  }

  row(panel: Locator, name: string): Locator {
    return panel.getByRole("listitem").filter({ has: this.page.getByText(name, { exact: true }) });
  }

  async seed(scenario: Scenario): Promise<void> {
    await writeFile(join(this.root, harness.marker), this.token);
    for (const path of [
      join(this.root, "user-data"),
      join(this.root, "session"),
      join(this.root, "logs"),
      join(this.root, "game-config"),
      this.workshop,
    ]) {
      await mkdir(path, { recursive: true });
    }
    const vault = sampleVault(this.config, this.workshop);
    if (scenario === "empty") {
      vault.mods = [];
      vault.userTags = [];
      vault.localSteamState.observedIds = [];
    }
    if (scenario === "large") {
      const template = requireValue(vault.mods[0]);
      for (let index = 0; index < 2_000; index++) {
        vault.mods.push({
          ...template,
          id: `steam-${10_000 + index}`,
          workshopId: String(10_000 + index),
          name: `Generated mod ${String(index).padStart(4, "0")}`,
        });
      }
    }
    for (const mod of vault.mods.filter((entry) => entry.subscribed)) {
      await this.install(mod);
    }
    await writeFile(this.config, configXml());
    await writeFile(
      this.database,
      scenario === "corrupt"
        ? "{unreadable json"
        : JSON.stringify({
            ...serializeVault(vault),
            ...(scenario === "future" ? { schemaVersion: vaultSchemaVersion + 1 } : {}),
          }),
    );
    await writeFile(join(this.root, harness.calls), "");
    const controls: Controls = {
      steamRunning: scenario !== "offline",
      gameRunning: false,
      subscribedIds: scenario === "empty" ? [] : [...initialSubscribedIds],
      failSubscriptionIds: [],
      ipcErrors: {},
      ipcDelays: {},
      metadataStatus: 200,
      cancelDialog: false,
      shellError: "",
    };
    await writeFile(join(this.root, harness.controls), JSON.stringify(controls));
    if (scenario === "disconnected") {
      await rename(this.workshop, `${this.workshop}-disconnected`);
    }
  }

  async install(mod: Mod): Promise<void> {
    const path = join(this.workshop, requireValue(mod.workshopId), "About");
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "About.xml"), aboutXml(mod));
  }

  async launch(): Promise<void> {
    verifyFixture(this.root, this.token);
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] =>
          entry[1] !== undefined &&
          !["ELECTRON_RUN_AS_NODE", "ELECTRON_RENDERER_URL"].includes(entry[0]),
      ),
    );
    this.application = await _electron.launch({
      args: [join(process.cwd(), ".e2e-build", "main.mjs"), "--no-sandbox"],
      env: { ...env, [harness.rootEnv]: this.root, [harness.tokenEnv]: this.token },
      timeout: 15_000,
    });
    this.launches++;
    const observed = new WeakSet<Page>();
    const observe = (page: Page) => {
      if (!observed.has(page)) {
        observed.add(page);
        page.on("pageerror", (error) => this.errors.push(error.message));
      }
    };
    this.app.context().on("page", observe);
    this.app.context().pages().forEach(observe);
    await this.app.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
    this.tracing = true;
    this.window = await this.app.firstWindow();
    observe(this.page);
    await this.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(1440, 900),
    );
    await expect(this.page.getByRole("heading", { name: "RimLib", exact: true })).toBeVisible();
  }

  async close(): Promise<void> {
    if (!this.application) {
      return;
    }
    if (this.tracing) {
      await this.app
        .context()
        .tracing.stop({ path: this.artifactPath(`trace-${this.launches}.zip`) });
      this.tracing = false;
    }
    await this.app.close();
    this.application = undefined;
    this.window = undefined;
  }

  async reopen(): Promise<void> {
    await this.close();
    await this.launch();
  }

  async reviewDraft(): Promise<Locator> {
    await this.page
      .locator(".draft-bar")
      .getByRole("button", { name: "Confirm changes", exact: true })
      .click();
    const dialog = this.page.getByRole("dialog", { name: "Review pending changes", exact: true });
    await expect(dialog).toBeVisible();
    return dialog;
  }

  async applyDraft(): Promise<void> {
    const dialog = await this.reviewDraft();
    const acknowledgement = dialog.getByRole("checkbox");
    if (await acknowledgement.count()) {
      await acknowledgement.check();
    }
    await dialog.getByRole("button", { name: /^Apply \d+ changes?$/ }).click();
    const applying = this.page.getByRole("dialog", { name: "Apply changes", exact: true });
    await expect(
      applying.getByText("Changes applied; RimWorld configuration unchanged", { exact: true }),
    ).toBeVisible();
    await applying
      .locator(".app-modal-actions")
      .getByRole("button", { name: "Close", exact: true })
      .click();
  }

  async vault(): Promise<ModVault> {
    return normalizeVault(JSON.parse(await readFile(this.database, "utf8")));
  }

  async mod(id: string): Promise<Mod> {
    return requireValue((await this.vault()).mods.find((mod) => mod.workshopId === id));
  }

  async setControls(change: Partial<Controls>): Promise<void> {
    const path = join(this.root, harness.controls);
    const current = JSON.parse(await readFile(path, "utf8")) as Controls;
    const temporary = `${path}.tmp`;
    await writeFile(temporary, JSON.stringify({ ...current, ...change }));
    await rename(temporary, path);
  }

  async calls(kind?: string): Promise<NativeCall[]> {
    const calls = (await readFile(join(this.root, harness.calls), "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as NativeCall);
    return kind ? calls.filter((call) => call.kind === kind) : calls;
  }

  async screenshot(): Promise<Buffer | undefined> {
    return this.window?.isClosed() === false ? this.window.screenshot() : undefined;
  }

  async destroy(): Promise<void> {
    // Clear injected failures so ordinary close can flush pending edits during teardown.
    await this.setControls({ ipcErrors: {}, ipcDelays: {} });
    const child = this.application?.process();
    const exited =
      child?.exitCode === null && child.signalCode === null ? once(child, "exit") : undefined;
    const timer = setTimeout(() => child?.kill("SIGKILL"), 10_000);
    try {
      await this.close();
    } finally {
      clearTimeout(timer);
      if (child?.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      await exited;
      this.application = undefined;
      this.window = undefined;
      // Never remove data while an Electron process might still be writing it.
      verifyFixture(this.root, this.token);
      await rm(this.root, { recursive: true, force: true });
    }
  }
}

export const test = base.extend<{ desktop: Desktop; scenario: Scenario }>({
  scenario: ["populated", { option: true }],
  desktop: async ({ scenario }, use, testInfo) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), harness.prefix)));
    const desktop = new Desktop(root, (name) => testInfo.outputPath(name));
    try {
      await desktop.seed(scenario);
      await desktop.launch();
      await use(desktop);
      expect(desktop.errors, "Uncaught renderer errors").toEqual([]);
      expect(
        await desktop.calls("rendererError"),
        "Renderer diagnostics, including caught React errors",
      ).toEqual([]);
    } finally {
      try {
        if (testInfo.status !== testInfo.expectedStatus) {
          const screenshot = await desktop.screenshot();
          if (screenshot) {
            await testInfo.attach("screenshot", { body: screenshot, contentType: "image/png" });
          }
          for (const name of await readdir(join(root, "logs"))) {
            await testInfo.attach(name, {
              body: await readFile(join(root, "logs", name)),
              contentType: "application/x-ndjson",
            });
          }
          await testInfo.attach("native-calls", {
            body: await readFile(join(root, harness.calls)),
            contentType: "application/x-ndjson",
          });
        }
      } finally {
        await desktop.destroy();
      }
    }
  },
});

export { expect };
