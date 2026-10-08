import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { openDatabaseFolder, openWorkshopInBrowser, revealModFolder } from "../src/main/modActions";
import { SettingsModal } from "../src/renderer/src/components/modals/SettingsModal";
import { ModInfoPanel } from "../src/renderer/src/components/panels/ModInfoPanel";
import { performUiAction } from "../src/renderer/src/services/uiActions";
import { errorMessage } from "../src/renderer/src/utils/errors";
import { createSteamWorkshopUrl, getModWorkshopId } from "../src/shared/steam";
import type { Mod, ModVault } from "../src/shared/types";
import { requireValue } from "../src/shared/validation";
import { normalizeVault } from "../src/shared/vault";

const noop = () => undefined;
const mod = (localPath?: string): Mod => ({
  id: "steam-123",
  workshopId: "123",
  name: "Mod",
  author: "Author",
  source: "steam",
  summary: "Saved description",
  tags: [],
  gameVersions: [],
  screenshots: [],
  subscribed: true,
  downloadedAt: "",
  addedAt: "",
  localPath,
});
const vault = (mods: Mod[] = []): ModVault => normalizeVault({ mods });
const noDiscovery = {
  activeMods: async () => assert.fail("Do not scan all mod metadata to reveal a known folder"),
  steamLibraries: async () =>
    assert.fail("Do not auto-detect libraries when a known folder is available"),
};
async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "mod-actions-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

void test("opening the database folder uses its actual parent without reading or changing even an invalid database", async () =>
  temporary(async (directory) => {
    const database = join(directory, "mod-vault.json");
    const original = "Invalid database content must be left untouched";
    await writeFile(database, original);
    const opened: string[] = [];
    const shell = {
      openPath: async (path: string) => {
        opened.push(path);
        return "";
      },
    };
    await openDatabaseFolder(database, shell);
    assert.deepEqual(opened, [directory]);
    assert.equal(await readFile(database, "utf8"), original);
    assert.deepEqual(await readdir(directory), ["mod-vault.json"]);
    await openDatabaseFolder(join(directory, "missing.json"), shell);
    assert.deepEqual(opened, [directory, directory]);
    assert.deepEqual(await readdir(directory), ["mod-vault.json"]);
  }));

void test("database folder opening reports OS error strings and rejected requests without changing data, and allows retry", async () =>
  temporary(async (directory) => {
    const database = join(directory, "mod-vault.json");
    const original = JSON.stringify(vault([mod()]));
    await writeFile(database, original);
    const notifications: string[] = [];
    const notify = (error: unknown) => notifications.push(errorMessage(error));
    await performUiAction(
      () => openDatabaseFolder(database, { openPath: async () => "Finder unavailable" }),
      notify,
    );
    await performUiAction(
      () =>
        openDatabaseFolder(database, {
          openPath: async () => {
            throw new Error("Permission denied");
          },
        }),
      notify,
    );
    assert.deepEqual(notifications, [
      "Could not open the database folder. Finder unavailable",
      "Permission denied",
    ]);
    await assert.rejects(
      openDatabaseFolder("relative/mod-vault.json", {
        openPath: async () => assert.fail("Do not open a relative database folder"),
      }),
      /absolute path/,
    );
    await openDatabaseFolder(database, { openPath: async () => "" });
    assert.equal(await readFile(database, "utf8"), original);
  }));

void test("Settings database and log buttons call only their own actions and are absent from browser preview", () => {
  let openedDatabase = 0;
  let openedLogs = 0;
  let saved = 0;
  const props = {
    configPath: "",
    workshopPath: "",
    onWorkshopPathChange: noop,
    onDetectWorkshopPath: noop,
    onTestWorkshopPath: noop,
    onBrowseWorkshopPath: noop,
    onBrowseConfigPath: noop,
    onClose: noop,
    onConfigPathChange: noop,
    onSubmit: () => {
      saved++;
    },
  };
  const element = SettingsModal({
    ...props,
    onOpenDatabaseFolder: () => {
      openedDatabase++;
    },
    onOpenLogs: () => {
      openedLogs++;
    },
  });
  const button = (text: string) =>
    findElement(
      element,
      (entry) =>
        entry.type === "button" &&
        Children.toArray(entry.props.children as ReactNode).includes(text),
    );
  const database = button("Open database folder");
  const logs = button("Open logs");
  assert.ok(database && logs);
  assert.equal(database.props.type, "button");
  assert.equal(logs.props.type, "button");
  (database.props.onClick as () => void)();
  assert.equal(openedDatabase, 1);
  assert.equal(openedLogs, 0);
  assert.equal(saved, 0);
  (logs.props.onClick as () => void)();
  assert.equal(openedLogs, 1);
  assert.equal(openedDatabase, 1);
  assert.equal(saved, 0);
  assert.doesNotMatch(
    renderToStaticMarkup(<SettingsModal {...props} />),
    /Open database folder|Open logs/,
  );
});

void test("Workshop browsing sends a canonical HTTPS link to the OS, not a Steam protocol", async () => {
  const opened: string[] = [];
  const shell = {
    openExternal: async (url: string) => {
      opened.push(url);
    },
  };
  await openWorkshopInBrowser("123", shell);
  assert.deepEqual(opened, ["https://steamcommunity.com/sharedfiles/filedetails/?id=123"]);
  for (const id of ["steam://123", "../123", "123&other=value", "0", "", "1".repeat(21)]) {
    assert.throws(() => openWorkshopInBrowser(id, shell), /Invalid Steam Workshop ID/);
  }
  assert.equal(opened.length, 1);
  await assert.rejects(
    openWorkshopInBrowser("123", {
      openExternal: async () => {
        throw new Error("No default browser");
      },
    }),
    /No default browser/,
  );
});

void test("Workshop identity prefers saved IDs and safely normalizes HTTP URLs", () => {
  assert.equal(getModWorkshopId({ workshopId: "123", url: "steam://something" }), "123");
  assert.equal(
    getModWorkshopId({
      url: "http://steamcommunity.com/sharedfiles/filedetails/?id=456&searchtext=hello",
    }),
    "456",
  );
  assert.equal(
    createSteamWorkshopUrl("456"),
    "https://steamcommunity.com/sharedfiles/filedetails/?id=456",
  );
  for (const url of [
    "steam://123",
    "file:///tmp/test",
    "https://evil.test/sharedfiles/filedetails/?id=123",
    "https://steamcommunity.com.evil.test/sharedfiles/filedetails/?id=123",
    "https://user@steamcommunity.com/sharedfiles/filedetails/?id=123",
    "https://steamcommunity.com:9999/sharedfiles/filedetails/?id=123",
    "https://steamcommunity.com/other?id=123",
    "https://steamcommunity.com/sharedfiles/filedetails/?id=../123",
    "not a URL",
  ]) {
    assert.equal(getModWorkshopId({ url }), undefined);
  }
});

void test("reveal uses the configured Workshop folder even when an old drive path exists, without mutating the vault", async () =>
  temporary(async (directory) => {
    const selected = join(directory, "Samsung drive", "294100");
    const currentPath = join(selected, "123");
    const oldPath = join(directory, "T7 Shield", "123");
    await mkdir(currentPath, { recursive: true });
    await mkdir(oldPath, { recursive: true });
    const current = { ...vault([mod(oldPath)]), settings: { workshopModsPath: ` ${selected}/ ` } };
    const before = JSON.stringify(current);
    const revealed: string[] = [];
    await revealModFolder(
      "steam-123",
      current,
      {
        showItemInFolder: (path) => {
          revealed.push(path);
        },
      },
      noDiscovery,
    );
    assert.deepEqual(revealed, [currentPath]);
    assert.equal(JSON.stringify(current), before);
  }));

void test("a missing configured mod does not fall back to another drive or reveal a regular file", async () =>
  temporary(async (directory) => {
    const selected = join(directory, "294100");
    const oldPath = join(directory, "old", "123");
    await mkdir(selected);
    await mkdir(oldPath, { recursive: true });
    const current = { ...vault([mod(oldPath)]), settings: { workshopModsPath: selected } };
    const shell = { showItemInFolder: () => assert.fail("Do not reveal a missing folder") };
    await assert.rejects(
      revealModFolder("steam-123", current, shell, noDiscovery),
      /mod folder was not found/,
    );
    await writeFile(join(selected, "123"), "not a directory");
    await assert.rejects(
      revealModFolder("steam-123", current, shell, noDiscovery),
      /mod folder was not found/,
    );
  }));

void test("reveal resolves the current Steam library when a saved path is stale", async () =>
  temporary(async (directory) => {
    const library = join(directory, "Steam library");
    const path = join(library, "steamapps", "workshop", "content", "294100", "123");
    await mkdir(path, { recursive: true });
    const revealed: string[] = [];
    await revealModFolder(
      "steam-123",
      vault([mod(join(directory, "old", "123"))]),
      {
        showItemInFolder: (path) => {
          revealed.push(path);
        },
      },
      { ...noDiscovery, steamLibraries: async () => [join(directory, "absent"), library] },
    );
    assert.deepEqual(revealed, [path]);
  }));

void test("saved local mods can be revealed without Steam", async () =>
  temporary(async (directory) => {
    const path = join(directory, "Local mod");
    await mkdir(path);
    const local: Mod = { ...mod(path), id: "local", workshopId: undefined, source: "local" };
    const revealed: string[] = [];
    const shell = {
      showItemInFolder: (path: string) => {
        revealed.push(path);
      },
    };
    await revealModFolder("local", vault([local]), shell, noDiscovery);
    assert.deepEqual(revealed, [path]);
  }));

void test("unsaved active Core and unsaved Workshop mods resolve to installed folders", async () =>
  temporary(async (directory) => {
    const core = join(directory, "Core");
    const root = join(directory, "294100");
    await mkdir(core);
    await mkdir(join(root, "123"), { recursive: true });
    const current = { ...vault(), settings: { workshopModsPath: root } };
    const revealed: string[] = [];
    const shell = {
      showItemInFolder: (path: string) => {
        revealed.push(path);
      },
    };
    await revealModFolder("active-package:ludeon.rimworld", current, shell, {
      ...noDiscovery,
      activeMods: async () => ({
        packageIds: ["ludeon.rimworld"],
        installedMods: [{ packageId: "ludeon.rimworld", localPath: core }],
      }),
    });
    await revealModFolder("steam-123", current, shell, noDiscovery);
    assert.deepEqual(revealed, [core, join(root, "123")]);
  }));

void test("missing, unknown or relative mod folders fail without invoking Finder", async () =>
  temporary(async (directory) => {
    const shell = { showItemInFolder: () => assert.fail("Do not reveal an invalid folder") };
    const dependencies = {
      activeMods: async () => ({ packageIds: [] }),
      steamLibraries: async () => [],
    };
    await assert.rejects(revealModFolder("", vault(), shell, dependencies), /Choose a mod/);
    await assert.rejects(
      revealModFolder("unknown", vault(), shell, dependencies),
      /not available locally/,
    );
    await assert.rejects(
      revealModFolder("steam-123", vault([mod(join(directory, "missing"))]), shell, dependencies),
      /not available locally/,
    );
    await assert.rejects(
      revealModFolder("steam-123", vault([mod("relative/123")]), shell, dependencies),
      /absolute path/,
    );
    await assert.rejects(
      revealModFolder("steam-../123", vault(), shell, dependencies),
      /not available locally/,
    );
  }));

void test("a timed-out folder lookup reports one notification, retains the vault and cannot reveal a late result", async () =>
  temporary(async (directory) => {
    const path = join(directory, "steamapps", "workshop", "content", "294100", "123");
    await mkdir(path, { recursive: true });
    const current = {
      ...vault([mod()]),
      selectedModId: "steam-123",
      userTags: [{ id: "qol", name: "QoL", color: "#7fbf90" }],
    };
    const original = JSON.stringify(current);
    const revealed: string[] = [];
    const notifications: string[] = [];
    let complete: ((libraries: string[]) => void) | undefined;
    const pending = new Promise<string[]>((resolve) => {
      complete = resolve;
    });
    const shell = {
      showItemInFolder: (folder: string) => {
        revealed.push(folder);
      },
    };
    await performUiAction(
      () =>
        revealModFolder("steam-123", current, shell, {
          ...noDiscovery,
          steamLibraries: () => pending,
          lookupTimeoutMs: 5,
        }),
      (error) => notifications.push(errorMessage(error)),
    );
    assert.match(requireValue(notifications[0]), /Finding the mod folder timed out/);
    assert.equal(notifications.length, 1);
    assert.equal(JSON.stringify(current), original);
    assert.deepEqual(revealed, []);
    requireValue(complete)([directory]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(revealed, []);
    await revealModFolder("steam-123", current, shell, {
      ...noDiscovery,
      steamLibraries: async () => [directory],
    });
    assert.deepEqual(revealed, [path]);
  }));

void test("Finder failures propagate to the action notification without changing mod data and permit retry", async () =>
  temporary(async (directory) => {
    const path = join(directory, "123");
    await mkdir(path);
    const current = vault([mod(path)]);
    const original = JSON.stringify(current);
    const notifications: string[] = [];
    await performUiAction(
      () =>
        revealModFolder(
          "steam-123",
          current,
          {
            showItemInFolder: () => {
              throw new Error("Finder unavailable");
            },
          },
          noDiscovery,
        ),
      (error) => notifications.push(errorMessage(error)),
    );
    assert.deepEqual(notifications, ["Finder unavailable"]);
    assert.equal(JSON.stringify(current), original);
    let revealed = false;
    await revealModFolder(
      "steam-123",
      current,
      {
        showItemInFolder: () => {
          revealed = true;
        },
      },
      noDiscovery,
    );
    assert.equal(revealed, true);
  }));

void test("folder permission failures are reported without changing permissions or opening Finder", async () =>
  temporary(async (directory) => {
    if (process.platform === "win32" || process.getuid?.() === 0) {
      return;
    }
    const root = join(directory, "294100");
    await mkdir(join(root, "123"), { recursive: true });
    await chmod(root, 0o000);
    try {
      await assert.rejects(
        revealModFolder(
          "steam-123",
          { ...vault([mod()]), settings: { workshopModsPath: root } },
          { showItemInFolder: () => assert.fail("Do not reveal an inaccessible mod") },
          noDiscovery,
        ),
        /Cannot access the mod folder.*EACCES|Cannot access the mod folder.*EPERM/,
      );
    } finally {
      await chmod(root, 0o700);
    }
  }));

function findElement(
  node: ReactNode,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Record<string, unknown>>(child)) {
      continue;
    }
    if (predicate(child)) {
      return child;
    }
    const found = findElement(child.props.children as ReactNode, predicate);
    if (found) {
      return found;
    }
  }
  return undefined;
}

const infoProps = { tags: [], onRemoveModFromLibrary: noop, onAssignTag: noop, onCreateTag: noop };
void test("Mod Info exposes folder and Workshop links that use the native desktop actions", () => {
  const revealed: string[] = [];
  const opened: string[] = [];
  const element = ModInfoPanel({
    ...infoProps,
    mod: { ...mod(), url: "steam://123" },
    onRevealModFolder: (id) => {
      revealed.push(id);
    },
    onOpenWorkshop: (id) => {
      opened.push(id);
    },
  });
  const folder = findElement(
    element,
    (element) => element.type === "a" && element.props["aria-label"] === "Open mod folder",
  );
  assert.ok(folder);
  assert.equal(folder.props["aria-disabled"], undefined);
  let folderPrevented = false;
  (folder.props.onClick as (event: { preventDefault: () => void }) => void)({
    preventDefault: () => {
      folderPrevented = true;
    },
  });
  assert.equal(folderPrevented, true);
  assert.deepEqual(revealed, ["steam-123"]);
  const link = findElement(
    element,
    (element) => element.type === "a" && element.props.href === createSteamWorkshopUrl("123"),
  );
  assert.ok(link);
  assert.equal(link.props.href, createSteamWorkshopUrl("123"));
  assert.equal(link.props.rel, "noopener noreferrer");
  let prevented = false;
  (link.props.onClick as (event: { preventDefault: () => void }) => void)({
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.deepEqual(opened, ["123"]);
});

void test("Mod Info disables unavailable folder actions and preserves normal browser-preview links", () => {
  const html = renderToStaticMarkup(<ModInfoPanel {...infoProps} mod={mod()} />);
  assert.match(html, /aria-disabled="true"[^>]*aria-label="Open mod folder"/);
  const element = ModInfoPanel({ ...infoProps, mod: mod() });
  const link = findElement(element, (element) => element.type === "a");
  assert.ok(link);
  (link.props.onClick as (event: { preventDefault: () => void }) => void)({
    preventDefault: () =>
      assert.fail("Do not intercept a normal browser link without a native handler"),
  });
  const local = { ...mod(), workshopId: undefined, source: "local" as const };
  const localHtml = renderToStaticMarkup(
    <ModInfoPanel {...infoProps} mod={local} onRevealModFolder={noop} />,
  );
  assert.doesNotMatch(localHtml, /Open mod folder/);
  assert.doesNotMatch(localHtml, /Steam Workshop/);
  const empty = renderToStaticMarkup(<ModInfoPanel {...infoProps} />);
  assert.doesNotMatch(empty, /Open mod folder/);
});

void test("pending folder reveal disables only the folder link, leaving metadata and tag controls accessible", () => {
  const html = renderToStaticMarkup(
    <ModInfoPanel {...infoProps} mod={mod()} isRevealingFolder onRevealModFolder={noop} />,
  );
  assert.match(html, /aria-disabled="true"[^>]*aria-label="Finding mod folder"/);
  assert.match(html, /Saved description/);
  assert.match(html, /aria-label="Search mod tags"/);
  assert.doesNotMatch(html, /<input[^>]*disabled/);
  assert.doesNotMatch(html, /<button[^>]*disabled[^>]*>[^<]*Remove saved mod/);
});
