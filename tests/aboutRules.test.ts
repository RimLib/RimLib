import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  importInstalledSteamMods,
  readAboutXml,
  type WorkshopFolderDiscovery,
} from "../src/main/steamWorkshop";
import { RIMWORLD_APP_ID, steamResultCodes } from "../src/shared/steam";
import { requireValue } from "../src/shared/validation";

async function temporaryMod(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "rimlib-about-rules-"));
  try {
    await mkdir(join(directory, "About"));
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function writeAbout(directory: string, metadata: string): Promise<void> {
  await writeFile(join(directory, "About", "About.xml"), `<ModMetaData>${metadata}</ModMetaData>`);
}

void test("About.xml keeps base, version replacements, and always-on force rules distinct", async () =>
  temporaryMod(async (directory) => {
    await writeAbout(
      directory,
      `<packageId>Author.Subject</packageId>
       <loadAfter>
         <li> Author.Base </li>
         <li>AUTHOR.DUP_STEAM</li>
         <li><packageId>Author.Object</packageId></li>
         <li>not a valid package!</li>
       </loadAfter>
       <loadAfterByVersion>
         <v1.6>
           <li>Author.Override</li>
           <li>author.dup</li>
           <li>author.shared</li>
         </v1.6>
         <V1.5>
           <li>AUTHOR.SHARED_STEAM</li>
         </V1.5>
         <v1.4 />
         <latest><li>author.ignored</li></latest>
       </loadAfterByVersion>
       <forceLoadAfter>
         <li>Author.Forced</li>
         <li>AUTHOR.BASE_STEAM</li>
       </forceLoadAfter>
       <loadBefore>
         <li>Author.Target</li>
         <li>AUTHOR.TARGET_STEAM</li>
       </loadBefore>
       <loadBeforeByVersion>
         <v1.6><li>Author.Versioned</li></v1.6>
       </loadBeforeByVersion>
       <forceLoadBefore>
         <li>Author.ForcedBefore</li>
         <li>AUTHOR.VERSIONED_STEAM</li>
       </forceLoadBefore>`,
    );

    const metadata = await readAboutXml(directory);
    assert.deepEqual(metadata.loadAfter, [
      { packageId: "author.base" },
      { packageId: "author.dup" },
      { packageId: "author.object" },
    ]);
    assert.deepEqual(metadata.loadAfterByVersion, [
      {
        gameVersion: "v1.6",
        rules: [
          { packageId: "author.override" },
          { packageId: "author.dup" },
          { packageId: "author.shared" },
        ],
      },
      { gameVersion: "v1.5", rules: [{ packageId: "author.shared" }] },
      { gameVersion: "v1.4", rules: [] },
    ]);
    assert.deepEqual(metadata.forceLoadAfter, [
      { packageId: "author.forced" },
      { packageId: "author.base" },
    ]);
    assert.deepEqual(metadata.loadBefore, [{ packageId: "author.target" }]);
    assert.deepEqual(metadata.loadBeforeByVersion, [
      { gameVersion: "v1.6", rules: [{ packageId: "author.versioned" }] },
    ]);
    assert.deepEqual(metadata.forceLoadBefore, [
      { packageId: "author.forcedbefore" },
      { packageId: "author.versioned" },
    ]);
  }));

void test("Workshop imports retain parsed About.xml ordering metadata", async () =>
  temporaryMod(async (directory) => {
    await writeAbout(
      directory,
      `<name>Ordered mod</name>
       <author>Author</author>
       <packageId>Author.Ordered</packageId>
       <description>Ordering metadata survives import.</description>
       <loadAfter><li>Author.Base</li></loadAfter>
       <loadAfterByVersion><v1.6><li>Author.Current</li></v1.6></loadAfterByVersion>
       <forceLoadBefore><li>Author.Forced</li></forceLoadBefore>`,
    );
    const discovery: WorkshopFolderDiscovery = {
      folders: [{ workshopId: "123", path: directory }],
      steamLibraryPaths: [],
      scannedLibraryPaths: [directory],
      unavailableLibraryPaths: [],
      manifestPaths: [],
      warnings: [],
    };
    const imported = await importInstalledSteamMods(discovery, undefined, async () =>
      Response.json({
        response: {
          publishedfiledetails: [
            {
              publishedfileid: "123",
              result: steamResultCodes.ok,
              consumer_app_id: RIMWORLD_APP_ID,
              title: "Remote title",
              description: "Remote description",
            },
          ],
        },
      }),
    );
    const mod = requireValue(imported.mods[0]);
    assert.deepEqual(mod.loadAfter, [{ packageId: "author.base" }]);
    assert.deepEqual(mod.loadAfterByVersion, [
      { gameVersion: "v1.6", rules: [{ packageId: "author.current" }] },
    ]);
    assert.deepEqual(mod.loadBefore, []);
    assert.deepEqual(mod.forceLoadBefore, [{ packageId: "author.forced" }]);
  }));
