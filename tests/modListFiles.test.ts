import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  assertSafeModListExportTarget,
  exportRimWorldModListFile,
  importRimWorldModListFile,
  maxModListEntries,
  maxModListFileBytes,
  parseRimWorldModListXml,
  renderRimWorldModListXml,
} from "../src/main/modListFiles";
import { atomicWrite } from "../src/main/vaultStore";
import { rimWorldOfficialContent } from "../src/shared/officialContent";

const core = "ludeon.rimworld";
const royalty = "ludeon.rimworld.royalty";

function modListXml(
  activeMods: readonly string[] = ["brrainz.harmony", core, royalty, "author.example"],
  knownExpansions: readonly string[] = [royalty],
  version = "1.6.4871 rev595",
): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<ModsConfigData>
  <version>${version}</version>
  <activeMods>
${activeMods.map((packageId) => `    <li>${packageId}</li>`).join("\n")}
  </activeMods>
  <knownExpansions>
${knownExpansions.map((packageId) => `    <li>${packageId}</li>`).join("\n")}
  </knownExpansions>
</ModsConfigData>
`;
}

void test("RimSort-compatible XML parser preserves list order and accepts a UTF-8 BOM", () => {
  const result = parseRimWorldModListXml(`\uFEFF${modListXml()}`);
  assert.deepEqual(result, {
    version: "1.6.4871 rev595",
    activeMods: ["brrainz.harmony", core, royalty, "author.example"],
    knownExpansions: [royalty],
  });
});

void test("mod-list renderer writes canonical standalone XML and defaults to every registered DLC", () => {
  const xml = renderRimWorldModListXml({
    version: "1.6",
    activeMods: ["LUDEON.RIMWORLD", "Author.Example_STEAM"],
  });
  const dlc = rimWorldOfficialContent
    .filter((content) => content.kind === "dlc")
    .map((content) => content.packageId);

  assert.equal(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>\n'), true);
  assert.equal(xml.endsWith("</ModsConfigData>\n"), true);
  assert.match(xml, /[ ]{2}<activeMods>\n[ ]{4}<li>ludeon\.rimworld<\/li>/);
  assert.deepEqual(parseRimWorldModListXml(xml), {
    version: "1.6",
    activeMods: [core, "author.example_steam"],
    knownExpansions: dlc,
  });
});

void test("mod-list renderer preserves a caller-supplied expansion order", () => {
  const anomaly = "ludeon.rimworld.anomaly";
  const rendered = renderRimWorldModListXml({
    version: "1.6.4871 rev595",
    activeMods: [core],
    knownExpansions: [anomaly.toUpperCase(), royalty.toUpperCase()],
  });
  assert.deepEqual(parseRimWorldModListXml(rendered).knownExpansions, [anomaly, royalty]);
});

void test("mod-list parser rejects DTDs, entities, invalid roots, and ambiguous structure", () => {
  for (const [xml, message] of [
    [
      '<!DOCTYPE ModsConfigData [<!ENTITY x "ludeon.rimworld">]><ModsConfigData><version>1.6</version><activeMods><li>&x;</li></activeMods><knownExpansions/></ModsConfigData>',
      /Unsupported XML/,
    ],
    [modListXml().replace('version="1.0"', 'version="1.1"'), /XML version 1.0/],
    [modListXml().replace('encoding="utf-8"', 'encoding="iso-8859-1"'), /only UTF-8/],
    ["<Other />", /unsupported element|ModsConfigData is missing/i],
    [
      "<ModsConfigData><version>1.6</version><version>1.5</version><activeMods><li>ludeon.rimworld</li></activeMods><knownExpansions/></ModsConfigData>",
      /version must occur exactly once/,
    ],
    [
      "<ModsConfigData><version>1.6</version><activeMods><li>ludeon.rimworld</li></activeMods><activeMods><li>author.mod</li></activeMods><knownExpansions/></ModsConfigData>",
      /activeMods must occur exactly once/,
    ],
    [
      '<ModsConfigData extra="true"><version>1.6</version><activeMods><li>ludeon.rimworld</li></activeMods><knownExpansions/></ModsConfigData>',
      /unsupported element or attribute/,
    ],
    [
      "<ModsConfigData><version>1.6</version><activeMods><li>ludeon.rimworld</li></activeMods></ModsConfigData>",
      /knownExpansions is missing/,
    ],
  ] as const) {
    assert.throws(() => parseRimWorldModListXml(xml), message);
  }
});

void test("mod-list parser rejects empty, nested, or attributed list items without partial parsing", () => {
  for (const item of [
    "<li></li>",
    "<li>   </li>",
    "<li><package>ludeon.rimworld</package></li>",
    '<li source="x">ludeon.rimworld</li>',
  ]) {
    assert.throws(
      () =>
        parseRimWorldModListXml(
          `<ModsConfigData><version>1.6</version><activeMods>${item}</activeMods><knownExpansions/></ModsConfigData>`,
        ),
      /item 1|unsupported element or attribute/,
    );
  }
});

void test("mod-list validation rejects invalid, duplicate, Core-less, and multiply-Core active packages", () => {
  for (const [activeMods, message] of [
    [["author.mod"], /Core package exactly once/],
    [[core, "steam.123"], /invalid package identifier/],
    [[core, "_steam"], /invalid package identifier/],
    [[core, "Author.Mod", "author.mod_steam"], /duplicate package identifier/],
    [["LUDEON.RIMWORLD_steam"], /cannot select a Workshop copy of official/],
    [[core, "LUDEON.RIMWORLD_steam"], /cannot select a Workshop copy of official/],
    [[core, "ludeon.rimworld.anomaly_steam"], /cannot select a Workshop copy of official/],
  ] as const) {
    assert.throws(() => parseRimWorldModListXml(modListXml(activeMods, [])), message);
  }
});

void test("mod-list validation rejects invalid expansion lists and malformed versions", () => {
  for (const [xml, message] of [
    [modListXml([core], ["author.not-dlc"]), /non-expansion/],
    [modListXml([core], [`${royalty}_steam`]), /cannot select a Workshop copy of official/],
    [
      modListXml([core], [royalty, `${royalty}_steam`]),
      /cannot select a Workshop copy of official/,
    ],
    [modListXml([core], [core]), /non-expansion/],
    [modListXml([core], [], "version latest"), /valid RimWorld version/],
  ] as const) {
    assert.throws(() => parseRimWorldModListXml(xml), message);
  }
});

void test("mod-list parser enforces entry and byte limits before accepting content", () => {
  const tooMany = Array.from({ length: maxModListEntries + 1 }, (_, index) =>
    index === 0 ? core : `author.mod${index}`,
  );
  assert.throws(() => parseRimWorldModListXml(modListXml(tooMany, [])), /too many entries/);
  assert.throws(
    () => parseRimWorldModListXml("x".repeat(maxModListFileBytes + 1)),
    /file is too large/,
  );
});

void test("file helpers atomically round-trip an explicitly named XML export", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rimlib-mod-list-"));
  try {
    const selectedPath = join(directory, "example-list.xml");
    const writtenPath = await exportRimWorldModListFile(selectedPath, {
      version: "1.6",
      activeMods: [core, "author.example"],
      knownExpansions: [royalty],
    });
    assert.equal(writtenPath, selectedPath);
    assert.equal((await readFile(writtenPath, "utf8")).endsWith("\n"), true);
    assert.deepEqual(await importRimWorldModListFile(writtenPath), {
      version: "1.6",
      activeMods: [core, "author.example"],
      knownExpansions: [royalty],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("export rejects a path without an XML extension instead of replacing another file", async () => {
  await assert.rejects(
    exportRimWorldModListFile(join(tmpdir(), "unconfirmed-export-name"), {
      version: "1.6",
      activeMods: [core],
    }),
    /ending in \.xml/,
  );
});

void test("export helper uses compare-and-swap for existing and absent targets", async () => {
  const path = join(tmpdir(), "rimlib-cas-export.xml");
  const guards: (string | undefined)[] = [];
  const writeText = async (
    _path: string,
    _text: string,
    guard?: { expected: string | undefined },
  ) => {
    guards.push(guard?.expected);
  };
  await exportRimWorldModListFile(
    path,
    { version: "1.6", activeMods: [core], knownExpansions: [] },
    { readText: async () => "previous", writeText },
  );
  await exportRimWorldModListFile(
    path,
    { version: "1.6", activeMods: [core], knownExpansions: [] },
    {
      readText: async () => {
        const missing = new Error("missing") as NodeJS.ErrnoException;
        missing.code = "ENOENT";
        throw missing;
      },
      writeText,
    },
  );
  assert.deepEqual(guards, ["previous", undefined]);
});

void test("export refuses the live ModsConfig path, symlinks, and hard links", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rimlib-export-identity-"));
  const liveConfig = join(directory, "ModsConfig.xml");
  const symbolicAlias = join(directory, "symbolic.xml");
  const hardAlias = join(directory, "hard.xml");
  const separate = join(directory, "separate.xml");
  try {
    await writeFile(liveConfig, modListXml());
    await symlink(liveConfig, symbolicAlias);
    await link(liveConfig, hardAlias);
    await writeFile(separate, "separate");

    for (const target of [liveConfig, symbolicAlias, hardAlias]) {
      await assert.rejects(assertSafeModListExportTarget(target, liveConfig), /will not overwrite/);
    }
    await assert.doesNotReject(assertSafeModListExportTarget(separate, liveConfig));

    let wrote = false;
    await assert.rejects(
      exportRimWorldModListFile(
        liveConfig,
        { version: "1.6", activeMods: [core], knownExpansions: [] },
        {
          liveConfigPaths: [liveConfig],
          writeText: async () => {
            wrote = true;
          },
        },
      ),
      /will not overwrite/,
    );
    assert.equal(wrote, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("export protects absent live config names on case-insensitive filesystems", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rimlib-export-case-"));
  try {
    await assert.rejects(
      assertSafeModListExportTarget(
        join(directory, "modsconfig.xml"),
        join(directory, "ModsConfig.xml"),
        { caseInsensitivePaths: true },
      ),
      /will not overwrite/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("export checks every live configuration again at the atomic publish boundary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rimlib-export-recheck-"));
  const firstConfig = join(directory, "first", "ModsConfig.xml");
  const secondConfig = join(directory, "second", "ModsConfig.xml");
  const output = join(directory, "exports", "list.xml");
  try {
    await mkdir(join(directory, "first"), { recursive: true });
    await mkdir(join(directory, "second"), { recursive: true });
    await mkdir(join(directory, "exports"), { recursive: true });
    await writeFile(firstConfig, modListXml());
    await writeFile(secondConfig, modListXml());

    let publishGuardChecked = false;
    await assert.rejects(
      exportRimWorldModListFile(
        output,
        { version: "1.6", activeMods: [core], knownExpansions: [] },
        {
          liveConfigPaths: [firstConfig, secondConfig],
          readText: async () => {
            const missing = new Error("missing") as NodeJS.ErrnoException;
            missing.code = "ENOENT";
            throw missing;
          },
          writeText: async (_path, _text, guard) => {
            publishGuardChecked = true;
            await guard?.beforePublish?.(secondConfig);
          },
        },
      ),
      /will not overwrite/,
    );
    assert.equal(publishGuardChecked, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("unsupported hard links leave an existing export untouched and report a local-path remedy", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rimlib-unsupported-export-"));
  const output = join(directory, "existing.xml");
  const previous = modListXml([core, "author.previous"], []);
  const unsupportedLink = async () => {
    const unsupported = new Error("hard links unsupported") as NodeJS.ErrnoException;
    unsupported.code = "ENOTSUP";
    throw unsupported;
  };
  try {
    await writeFile(output, previous);
    await assert.rejects(
      exportRimWorldModListFile(
        output,
        { version: "1.6", activeMods: [core, "author.next"], knownExpansions: [] },
        {
          writeText: (path, text, guard) =>
            atomicWrite(path, text, guard, { link: unsupportedLink }),
        },
      ),
      /does not support RimLib's safe atomic XML export.*local filesystem location/,
    );
    assert.equal(await readFile(output, "utf8"), previous);
    assert.deepEqual(await readdir(directory), ["existing.xml"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("file import times out without parsing a stalled cloud-storage read", async () => {
  await assert.rejects(
    importRimWorldModListFile(join(tmpdir(), "stalled.xml"), {
      readText: async () => new Promise<string>(() => undefined),
      readTimeoutMs: 1,
    }),
    /timed out.*local file|local file.*timed out/i,
  );
});

void test("export times out before writing when its existing-file read stalls", async () => {
  let wrote = false;
  await assert.rejects(
    exportRimWorldModListFile(
      join(tmpdir(), "stalled-existing-export.xml"),
      { version: "1.6", activeMods: [core] },
      {
        readText: async () => new Promise<string>(() => undefined),
        readTimeoutMs: 1,
        writeText: async () => {
          wrote = true;
        },
      },
    ),
    /Reading the existing export timed out/,
  );
  assert.equal(wrote, false);
});

void test("export times out before writing when destination identity checks stall", async () => {
  let wrote = false;
  const stalledStat = async () => new Promise<never>(() => undefined);
  await assert.rejects(
    exportRimWorldModListFile(
      join(tmpdir(), "stalled-identity-export.xml"),
      { version: "1.6", activeMods: [core] },
      {
        liveConfigPaths: [join(tmpdir(), "live-ModsConfig.xml")],
        readTimeoutMs: 1,
        stat: stalledStat,
        writeText: async () => {
          wrote = true;
        },
      },
    ),
    /Checking the export destination timed out/,
  );
  assert.equal(wrote, false);
});

void test("file import rejects invalid UTF-8, directories, and oversized files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rimlib-import-validation-"));
  try {
    const invalidUtf8 = join(directory, "invalid.xml");
    const oversized = join(directory, "oversized.xml");
    await writeFile(invalidUtf8, Buffer.from([0xc3, 0x28]));
    await writeFile(oversized, Buffer.alloc(maxModListFileBytes + 1, 0x20));

    await assert.rejects(importRimWorldModListFile(invalidUtf8), /not valid UTF-8/);
    await assert.rejects(importRimWorldModListFile(directory), /not a regular file/);
    await assert.rejects(importRimWorldModListFile(oversized), /too large/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
