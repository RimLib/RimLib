import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { configureApplicationIdentity } from "../src/main/applicationIdentity";
import { privateDirectoryMode } from "../src/main/platformConstants";
import { VaultStore } from "../src/main/vaultStore";
import { AppHeader } from "../src/renderer/src/components/AppHeader";
import { AppTopBar } from "../src/renderer/src/components/AppTopBar";
import { applicationName } from "../src/shared/application";
import {
  browserStorageKeys,
  desktopStorageDirectoryName,
  vaultFileName,
} from "../src/shared/storage";
import { isRecord, requireValue } from "../src/shared/validation";
import { normalizeVault, serializeVault } from "../src/shared/vault";

const noop = () => undefined;

function application(appData: string, initialName: string, userData = join(appData, initialName)) {
  let name = initialName;
  const paths = new Map([
    ["appData", appData],
    ["userData", userData],
    ["sessionData", userData],
  ]);
  const changes: string[] = [];
  return {
    paths,
    changes,
    getName: () => name,
    getPath: (key: string) => requireValue(paths.get(key)),
    setName: (next: string) => {
      name = next;
    },
    setPath: (key: string, value: string) => {
      changes.push(key);
      paths.set(key, value);
    },
  };
}

async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "rimlib-identity-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

void test("RimLib branding matches package metadata, lockfile, page and visible headers", async () => {
  assert.equal(applicationName, "RimLib");
  const metadata: unknown = JSON.parse(await readFile("package.json", "utf8"));
  const lockfile: unknown = JSON.parse(await readFile("package-lock.json", "utf8"));
  assert.ok(isRecord(metadata) && isRecord(lockfile));
  assert.equal(metadata.name, "rimlib");
  assert.equal(metadata.productName, "RimLib");
  assert.equal(lockfile.name, metadata.name);
  assert.ok(isRecord(lockfile.packages));
  const root = lockfile.packages[""];
  assert.ok(isRecord(root));
  assert.equal(root.name, metadata.name);
  assert.match(await readFile("src/renderer/index.html", "utf8"), /<title>RimLib<\/title>/);
  const html = renderToStaticMarkup(
    <>
      <AppTopBar />
      <AppHeader
        notice="Ready"
        disabled={false}
        onOpenSettings={noop}
        onManageTags={noop}
        onSync={noop}
        onUnsubscribeInactive={noop}
      />
    </>,
  );
  assert.match(html, /class="app-topbar-title">RimLib<\/div>/);
  assert.match(html, /<h1[^>]*>RimLib<\/h1>/);
  assert.match(html, /aria-label="Settings"[^>]*class="app-logo-button"/);
  assert.deepEqual(browserStorageKeys, {
    vault: "rimlib:vault",
    vaultBackup: "rimlib:vault:backup",
  });
});

void test("identity setup preserves the RimLib vault, settings, tags, backups and session files byte for byte", async () =>
  temporary(async (directory) => {
    const storage = join(directory, "RimLib");
    assert.equal(desktopStorageDirectoryName, "RimLib");
    await mkdir(storage);
    const vault = normalizeVault({
      mods: [{ id: "saved", name: "Saved mod", userTagIds: ["qol"], notes: "Personal note" }],
      userTags: [{ id: "qol", name: "QoL", color: "#ffffff" }],
      settings: { workshopModsPath: "/saved/294100" },
      selectedModId: "saved",
    });
    const raw = JSON.stringify(serializeVault(vault));
    const database = join(storage, vaultFileName);
    await writeFile(database, raw);
    await writeFile(`${database}.bak`, raw);
    await mkdir(join(storage, "backups"));
    await writeFile(join(storage, "backups", "checkpoint.json"), raw);
    await writeFile(join(storage, "Preferences"), "preserved preferences");
    await mkdir(join(storage, "Local Storage"));
    await writeFile(join(storage, "Local Storage", "session"), "preserved session");
    for (const initialName of ["RimLib", "rimlib"]) {
      const app = application(directory, initialName);
      configureApplicationIdentity(app);
      assert.equal(app.getName(), "RimLib");
      assert.equal(app.getPath("userData"), storage);
      assert.equal(app.getPath("sessionData"), storage);
      const loaded = await new VaultStore(join(app.getPath("userData"), vaultFileName)).load();
      assert.deepEqual(loaded.mods, vault.mods);
      assert.deepEqual(loaded.userTags, vault.userTags);
      assert.deepEqual(loaded.settings, vault.settings);
      assert.equal(loaded.selectedModId, undefined);
      assert.equal(await readFile(database, "utf8"), raw);
      assert.equal(await readFile(`${database}.bak`, "utf8"), raw);
      assert.equal(await readFile(join(storage, "backups", "checkpoint.json"), "utf8"), raw);
      assert.equal(await readFile(join(storage, "Preferences"), "utf8"), "preserved preferences");
      assert.equal(
        await readFile(join(storage, "Local Storage", "session"), "utf8"),
        "preserved session",
      );
    }
    assert.deepEqual(await readdir(directory), ["RimLib"]);
  }));

void test("default storage ignores other application folders without reading or migrating their vaults", async () =>
  temporary(async (directory) => {
    const unrelatedStorage = join(directory, "another-app");
    await mkdir(unrelatedStorage);
    await writeFile(join(unrelatedStorage, vaultFileName), "preserved unrelated vault");
    const app = application(directory, "RimLib");
    configureApplicationIdentity(app);
    const storage = join(directory, "RimLib");
    assert.equal(app.getPath("userData"), storage);
    assert.equal(app.getPath("sessionData"), storage);
    assert.deepEqual(await readdir(storage), []);
    assert.equal(
      await readFile(join(unrelatedStorage, vaultFileName), "utf8"),
      "preserved unrelated vault",
    );
    assert.deepEqual((await readdir(directory)).sort(), ["RimLib", "another-app"]);
  }));

void test("fresh installations create the stable private data directory before setting Electron paths", async () =>
  temporary(async (directory) => {
    const app = application(join(directory, "app-data"), "RimLib");
    configureApplicationIdentity(app);
    const storage = join(directory, "app-data", desktopStorageDirectoryName);
    assert.equal(app.getPath("userData"), storage);
    assert.equal(app.getPath("sessionData"), storage);
    assert.ok((await stat(storage)).isDirectory());
    assert.deepEqual(await readdir(storage), []);
    if (process.platform !== "win32") {
      assert.equal((await stat(storage)).mode & 0o777, privateDirectoryMode);
    }
  }));

void test("explicit data and session overrides remain isolated rather than accessing default storage", async () =>
  temporary(async (directory) => {
    const unrelatedStorage = join(directory, "app-data", "another-app");
    await mkdir(unrelatedStorage, { recursive: true });
    await writeFile(join(unrelatedStorage, vaultFileName), "preserved unrelated vault");
    const app = application(
      join(directory, "app-data"),
      "rimlib",
      join(directory, "isolated-data"),
    );
    app.paths.set("sessionData", join(directory, "isolated-session"));
    configureApplicationIdentity(app);
    assert.equal(app.getName(), "RimLib");
    assert.equal(app.getPath("userData"), join(directory, "isolated-data"));
    assert.equal(app.getPath("sessionData"), join(directory, "isolated-session"));
    assert.deepEqual(app.changes, []);
    assert.deepEqual(await readdir(directory), ["app-data"]);
    assert.equal(
      await readFile(join(unrelatedStorage, vaultFileName), "utf8"),
      "preserved unrelated vault",
    );
  }));

void test("custom session storage survives when default user data is pinned", async () =>
  temporary(async (directory) => {
    const app = application(directory, "rimlib");
    app.paths.set("sessionData", join(directory, "custom-session"));
    configureApplicationIdentity(app);
    assert.equal(app.getPath("userData"), join(directory, desktopStorageDirectoryName));
    assert.equal(app.getPath("sessionData"), join(directory, "custom-session"));
    assert.deepEqual(app.changes, ["userData"]);
  }));

void test("unavailable stable storage aborts identity setup instead of falling back to an empty library", async () =>
  temporary(async (directory) => {
    const storage = join(directory, desktopStorageDirectoryName);
    await writeFile(storage, "preserved file");
    const app = application(directory, "RimLib");
    assert.throws(() => {
      configureApplicationIdentity(app);
    });
    assert.deepEqual(app.changes, []);
    assert.equal(app.getPath("userData"), join(directory, "RimLib"));
    assert.equal(await readFile(storage, "utf8"), "preserved file");
    assert.deepEqual(await readdir(directory), [desktopStorageDirectoryName]);
  }));
