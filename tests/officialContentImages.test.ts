import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { InstalledModIndex } from "../src/main/installedMods";
import { SessionLogger, setSessionLogger } from "../src/main/logging";
import {
  installOfficialContentImageProtocol,
  OfficialContentImageStore,
  registerOfficialContentImageScheme,
} from "../src/main/officialContentImages";
import { modImageUrl } from "../src/renderer/src/utils/images";
import {
  getOfficialContent,
  officialContentImageScheme,
  officialContentImageUrl,
  officialPackageIdFromImageUrl,
  rimWorldOfficialContent,
} from "../src/shared/officialContent";
import { isOfficialMod } from "../src/shared/packages";
import { requireValue } from "../src/shared/validation";
import { parseLogRecord } from "./helpers/logRecords";

const png = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
]);

void test("official content uses the exact six canonical package and image identities", () => {
  assert.deepEqual(
    rimWorldOfficialContent.map(({ packageId, steamAppId }) => [packageId, steamAppId]),
    [
      ["ludeon.rimworld", 294100],
      ["ludeon.rimworld.royalty", 1149640],
      ["ludeon.rimworld.ideology", 1392840],
      ["ludeon.rimworld.biotech", 1826140],
      ["ludeon.rimworld.anomaly", 2380740],
      ["ludeon.rimworld.odyssey", 3022790],
    ],
  );
  assert.deepEqual(
    rimWorldOfficialContent.map(({ packageId }) => [packageId, officialContentImageUrl(packageId)]),
    [
      ["ludeon.rimworld", "rimlib-official-image://preview/ludeon.rimworld"],
      ["ludeon.rimworld.royalty", "rimlib-official-image://preview/ludeon.rimworld.royalty"],
      ["ludeon.rimworld.ideology", "rimlib-official-image://preview/ludeon.rimworld.ideology"],
      ["ludeon.rimworld.biotech", "rimlib-official-image://preview/ludeon.rimworld.biotech"],
      ["ludeon.rimworld.anomaly", "rimlib-official-image://preview/ludeon.rimworld.anomaly"],
      ["ludeon.rimworld.odyssey", "rimlib-official-image://preview/ludeon.rimworld.odyssey"],
    ],
  );
  for (const content of rimWorldOfficialContent) {
    assert.equal(getOfficialContent(` ${content.packageId.toUpperCase()}_steam `), content);
    const url = requireValue(officialContentImageUrl(content.packageId));
    assert.equal(officialPackageIdFromImageUrl(url), content.packageId);
    assert.equal(modImageUrl(url), url);
  }
  for (const packageId of ["ludeon.rimworld.fake", "author.rimworld", ""]) {
    assert.equal(getOfficialContent(packageId), undefined);
    assert.equal(officialContentImageUrl(packageId), undefined);
    assert.equal(
      isOfficialMod({ id: `active-package:${packageId}`, packageId, workshopId: undefined }),
      false,
      `${packageId} must not be classified as official content`,
    );
  }
  assert.equal(
    isOfficialMod({
      id: "active-package:ludeon.rimworld.anomaly",
      packageId: "ludeon.rimworld.anomaly",
      workshopId: undefined,
    }),
    true,
  );
  assert.equal(
    isOfficialMod({
      id: "installed-local:ludeon.rimworld.anomaly:spoof",
      packageId: "ludeon.rimworld.anomaly",
      workshopId: undefined,
    }),
    false,
  );
  assert.equal(
    isOfficialMod({
      id: "steam-123",
      packageId: "ludeon.rimworld.anomaly",
      workshopId: "123",
    }),
    false,
  );
  for (const value of [
    `${officialContentImageScheme}://preview/ludeon.rimworld.fake`,
    `${officialContentImageScheme}://preview/ludeon.rimworld?variant=other`,
    `${officialContentImageScheme}://preview/ludeon.rimworld/`,
    `${officialContentImageScheme}://other/ludeon.rimworld`,
    `${officialContentImageScheme}://preview/Ludeon.RimWorld`,
    "file:///game/Data/Core/About/Preview.png",
  ]) {
    assert.equal(officialPackageIdFromImageUrl(value), undefined);
    assert.equal(modImageUrl(value), undefined);
  }
});

void test("the official image protocol serves only approved local PNG previews", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "rimlib-official-preview-"));
  const anomaly = join(directory, "Anomaly");
  const preview = join(anomaly, "About", "Preview.png");
  const warnings: { event: string; data?: unknown }[] = [];
  const images = new OfficialContentImageStore((event, data) => warnings.push({ event, data }));
  try {
    await mkdir(join(anomaly, "About"), { recursive: true });
    await writeFile(preview, png);
    const approved = requireValue(await images.inspect("Ludeon.RimWorld.Anomaly", anomaly));
    images.replace([approved]);

    let schemes: Electron.CustomScheme[] = [];
    registerOfficialContentImageScheme({
      registerSchemesAsPrivileged: (registered) => {
        schemes = registered;
      },
    });
    assert.deepEqual(schemes, [
      {
        scheme: officialContentImageScheme,
        privileges: { secure: true, standard: true },
      },
    ]);

    let registeredScheme: string | undefined;
    let handler: Parameters<Electron.Protocol["handle"]>[1] | undefined;
    installOfficialContentImageProtocol(
      {
        handle: (scheme, registered) => {
          registeredScheme = scheme;
          handler = registered;
        },
      },
      images,
    );
    assert.equal(registeredScheme, officialContentImageScheme);
    const request = requireValue(handler);
    const response = await request(new Request(approved.url));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "image/png");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), png);
    const head = await request(new Request(approved.url, { method: "HEAD" }));
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("Content-Length"), String(png.byteLength));
    assert.equal((await head.arrayBuffer()).byteLength, 0);

    assert.equal((await request(new Request(`${approved.url}?path=/etc/passwd`))).status, 404);
    assert.equal((await request(new Request(approved.url, { method: "POST" }))).status, 405);
    assert.equal(await images.inspect("ludeon.rimworld.fake", anomaly), undefined);
    assert.equal(warnings.length, 0);

    const wrongFolder = join(directory, "NotRoyalty");
    await mkdir(join(wrongFolder, "About"), { recursive: true });
    await writeFile(join(wrongFolder, "About", "Preview.png"), png);
    assert.equal(await images.inspect("ludeon.rimworld.royalty", wrongFolder), undefined);
    assert.equal(warnings.at(-1)?.event, "rimworld.official-preview.unavailable");

    const invalidPngRoot = join(directory, "Biotech");
    await mkdir(join(invalidPngRoot, "About"), { recursive: true });
    await writeFile(join(invalidPngRoot, "About", "Preview.png"), "not a PNG image");
    assert.equal(await images.inspect("ludeon.rimworld.biotech", invalidPngRoot), undefined);
    assert.equal(warnings.at(-1)?.event, "rimworld.official-preview.unavailable");

    const outside = join(directory, "outside.png");
    const royalty = join(directory, "Royalty");
    await writeFile(outside, png);
    await mkdir(join(royalty, "About"), { recursive: true });
    let symlinksAvailable = true;
    try {
      await symlink(outside, join(royalty, "About", "Preview.png"));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!["EACCES", "ENOTSUP", "EPERM"].includes(code ?? "")) {
        throw error;
      }
      symlinksAvailable = false;
      context.diagnostic(`Symlink assertions skipped: ${code}`);
    }
    if (symlinksAvailable) {
      assert.equal(await images.inspect("ludeon.rimworld.royalty", royalty), undefined);
      assert.equal(warnings.at(-1)?.event, "rimworld.official-preview.unavailable");

      await unlink(preview);
      await symlink(outside, preview);
      assert.equal((await request(new Request(approved.url))).status, 404);
      assert.equal(warnings.at(-1)?.event, "rimworld.official-preview.read-failed");
    }

    const core = join(directory, "Core");
    await mkdir(core);
    assert.equal(await images.inspect("ludeon.rimworld", core), undefined);
    assert.equal(warnings.at(-1)?.event, "rimworld.official-preview.unavailable");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("installed metadata scanning keeps valid rows and WARN-logs incomplete About.xml files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rimlib-installed-metadata-warnings-"));
  const logger = new SessionLogger({
    directory: join(directory, "logs"),
    startup: { test: "Installed metadata warnings" },
    pruneOnStart: false,
  });
  setSessionLogger(logger);
  try {
    const game = join(directory, "steamapps", "common", "RimWorld");
    const data = join(game, "Data");
    for (const folder of ["Core", "Valid", "MissingIdentity", "Malformed"]) {
      await mkdir(join(data, folder, "About"), { recursive: true });
    }
    await writeFile(
      join(data, "Core", "About", "About.xml"),
      "<ModMetaData><name>Core</name><packageId>ludeon.rimworld</packageId></ModMetaData>",
    );
    await writeFile(
      join(data, "Valid", "About", "About.xml"),
      "<ModMetaData><name>Valid local mod</name><packageId>author.valid</packageId></ModMetaData>",
    );
    await writeFile(
      join(data, "MissingIdentity", "About", "About.xml"),
      "<ModMetaData><name>Missing identity</name></ModMetaData>",
    );
    await writeFile(join(data, "Malformed", "About", "About.xml"), "<NotModMetadata />");
    await writeFile(
      join(directory, "steamapps", "appmanifest_294100.acf"),
      '"AppState" { "installdir" "RimWorld" }',
    );

    const installed = await new InstalledModIndex(0).read([directory]);
    assert.deepEqual(
      new Set(installed.map((entry) => entry.packageId)),
      new Set(["ludeon.rimworld", "author.valid"]),
    );
    assert.equal(
      installed.find((entry) => entry.packageId === "ludeon.rimworld")?.officialContent,
      true,
    );
    assert.equal(
      installed.find((entry) => entry.packageId === "ludeon.rimworld")?.thumbnail,
      undefined,
    );

    logger.close();
    const records = (await readFile(logger.path, "utf8")).trim().split("\n").map(parseLogRecord);
    for (const event of [
      "rimworld.installed-mod-metadata.missing-package-id",
      "rimworld.installed-mod-metadata.failed",
    ]) {
      const warning = requireValue(records.find((record) => record.event === event));
      assert.equal(warning.level, "WARN");
    }
  } finally {
    setSessionLogger();
    logger.close();
    await rm(directory, { recursive: true, force: true });
  }
});
