import assert from "node:assert/strict";
import { link, lstat, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { test } from "node:test";

import { readConfig, resolveConfigPath, setActiveMods } from "../src/main/rimWorldConfig";
import { atomicWrite } from "../src/main/vaultStore";
import { xmlLimits } from "../src/shared/limits";

const currentOrder = ["brrainz.harmony", "ludeon.rimworld", "Author.Old_steam"];

function config(order: readonly string[], custom = "retained") {
  return `<?xml version="1.0" encoding="utf-8"?>
<ModsConfigData custom="root-attribute">
  <!-- keep this fake <activeMods><li>comment.package</li></activeMods> untouched -->
  <version>1.6</version>
  <activeMods source="game">
    ${order.map((packageId) => `<li>${packageId}</li>`).join("\n    ")}
  </activeMods>
  <knownExpansions>
    <li>ludeon.rimworld.royalty</li>
  </knownExpansions>
  <custom flag="retained">${custom}</custom>
</ModsConfigData>
`;
}

function withoutActiveContent(raw: string) {
  return raw.replace(
    /(<activeMods source="game">)[\s\S]*?(<\/activeMods\s*>)/,
    "$1__ACTIVE_CONTENT__$2",
  );
}

async function fixture(run: (path: string, original: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "rimlib-active-config-"));
  const path = join(directory, "ModsConfig.xml");
  const original = config(currentOrder);
  try {
    await writeFile(path, original);
    await run(await realpath(path), original);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

void test("configured relative paths resolve consistently to an absolute ModsConfig.xml path", async () => {
  await fixture(async (path) => {
    const configuredPath = relative(process.cwd(), path);
    const settings = { rimWorldConfigPath: `  ${configuredPath}  ` };
    const expectedPath = resolve(configuredPath);

    assert.equal(isAbsolute(configuredPath), false);
    assert.equal(resolveConfigPath(settings), expectedPath);
    assert.equal((await readConfig(settings)).path, expectedPath);
  });
});

void test("active config reads reject non-files, oversized input, and invalid UTF-8 before parsing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rimlib-active-config-bounds-"));
  const oversized = join(directory, "oversized.xml");
  const invalidUtf8 = join(directory, "invalid.xml");
  try {
    await writeFile(oversized, Buffer.alloc(xmlLimits.maxFileBytes + 1, 0x20));
    await writeFile(invalidUtf8, Buffer.from([0xc3, 0x28]));
    await assert.rejects(readConfig({ rimWorldConfigPath: directory }), /not a regular file/);
    await assert.rejects(readConfig({ rimWorldConfigPath: oversized }), /too large/);
    await assert.rejects(readConfig({ rimWorldConfigPath: invalidUtf8 }), /not valid UTF-8/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("active config writes preserve a configured symlink and update its canonical target", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rimlib-active-config-alias-"));
  const target = join(directory, "real-ModsConfig.xml");
  const alias = join(directory, "ModsConfig.xml");
  const original = config(currentOrder);
  try {
    await writeFile(target, original);
    await symlink(target, alias);
    const result = await setActiveMods(
      { rimWorldConfigPath: alias },
      ["ludeon.rimworld", "author.next"],
      currentOrder,
      { assertClosed: async () => undefined },
    );

    assert.equal(result.configPath, await realpath(target));
    assert.equal((await lstat(alias)).isSymbolicLink(), true);
    assert.match(await readFile(target, "utf8"), /<li>author\.next<\/li>/);
    assert.equal(await readFile(`${target}.rimlib.bak`, "utf8"), original);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("active config writer rejects hard-linked aliases without mutating either pathname", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rimlib-active-config-hard-link-"));
  const target = join(directory, "real-ModsConfig.xml");
  const alias = join(directory, "ModsConfig.xml");
  const original = config(currentOrder);
  try {
    await writeFile(target, original);
    await link(target, alias);
    const originalIdentity = await lstat(target);
    let closed = false;

    await assert.rejects(
      setActiveMods(
        { rimWorldConfigPath: alias },
        ["ludeon.rimworld", "author.next"],
        currentOrder,
        {
          assertClosed: async () => {
            closed = true;
          },
        },
      ),
      /hard-linked/,
    );

    const targetIdentity = await lstat(target);
    const aliasIdentity = await lstat(alias);
    assert.equal(closed, false);
    assert.equal(targetIdentity.ino, originalIdentity.ino);
    assert.equal(aliasIdentity.ino, originalIdentity.ino);
    assert.equal(await readFile(target, "utf8"), original);
    assert.equal(await readFile(alias, "utf8"), original);
    await assert.rejects(readFile(`${alias}.rimlib.bak`, "utf8"), /ENOENT/);
    await assert.rejects(readFile(`${target}.rimlib.bak`, "utf8"), /ENOENT/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("active config writer rejects a hard link introduced at its commit boundary", async () => {
  await fixture(async (path, original) => {
    const competingLink = join(path, "..", "competing-ModsConfig.xml");
    const originalIdentity = await lstat(path);

    await assert.rejects(
      setActiveMods(
        { rimWorldConfigPath: path },
        ["ludeon.rimworld", "author.next"],
        currentOrder,
        {
          assertClosed: async () => undefined,
          write: async (target, text, guard) => {
            if (guard !== undefined) {
              await link(target, competingLink);
            }
            await atomicWrite(target, text, guard);
          },
        },
      ),
      /hard-linked/,
    );

    const targetIdentity = await lstat(path);
    const competingIdentity = await lstat(competingLink);
    assert.equal(targetIdentity.ino, originalIdentity.ino);
    assert.equal(competingIdentity.ino, originalIdentity.ino);
    assert.equal(await readFile(path, "utf8"), original);
    assert.equal(await readFile(competingLink, "utf8"), original);
    assert.equal(await readFile(`${path}.rimlib.bak`, "utf8"), original);
  });
});

void test("active config writer preserves unrelated XML, backs up the source, and accepts case-insensitive expected order", async () => {
  await fixture(async (path, original) => {
    let closedChecks = 0;
    const requested = [
      "brrainz.harmony",
      "ludeon.rimworld",
      "ludeon.rimworld.biotech",
      "author.new",
    ];
    const result = await setActiveMods(
      { rimWorldConfigPath: path },
      requested,
      ["BRRAINZ.HARMONY", "LUDEON.RIMWORLD", "author.old_STEAM"],
      {
        assertClosed: async () => {
          closedChecks++;
        },
      },
    );

    const written = await readFile(path, "utf8");
    assert.equal(closedChecks, 1);
    assert.deepEqual(result, {
      configPath: path,
      gameVersion: "1.6",
      packageIds: requested,
    });
    assert.equal(await readFile(`${path}.rimlib.bak`, "utf8"), original);
    assert.equal(withoutActiveContent(written), withoutActiveContent(original));
    assert.match(
      written,
      /<activeMods source="game">\s*<li>brrainz\.harmony<\/li>\s*<li>ludeon\.rimworld<\/li>\s*<li>ludeon\.rimworld\.biotech<\/li>\s*<li>author\.new<\/li>\s*<\/activeMods>/,
    );
    assert.doesNotMatch(written, /Author\.Old_steam/);
  });
});

void test("active config writer rejects invalid, duplicate, or Core-less requested orders before checking the game", async () => {
  await fixture(async (path, original) => {
    let closedChecks = 0;
    const dependencies = {
      assertClosed: async () => {
        closedChecks++;
      },
    };
    for (const [requested, message] of [
      [["author.mod"], /Core package exactly once/],
      [["ludeon.rimworld", "Author.Mod", "author.mod_steam"], /duplicate package/],
      [["ludeon.rimworld", "steam.123"], /invalid package/],
    ] as const) {
      await assert.rejects(
        setActiveMods({ rimWorldConfigPath: path }, requested, currentOrder, dependencies),
        message,
      );
    }
    assert.equal(closedChecks, 0);
    assert.equal(await readFile(path, "utf8"), original);
    await assert.rejects(readFile(`${path}.rimlib.bak`, "utf8"), /ENOENT/);
  });
});

void test("active config writer rejects a stale expected order without creating a backup", async () => {
  await fixture(async (path, original) => {
    let closed = false;
    await assert.rejects(
      setActiveMods(
        { rimWorldConfigPath: path },
        ["ludeon.rimworld", "author.new"],
        ["ludeon.rimworld", "brrainz.harmony", "Author.Old_steam"],
        {
          assertClosed: async () => {
            closed = true;
          },
        },
      ),
      /changed outside RimLib/,
    );
    assert.equal(closed, false);
    assert.equal(await readFile(path, "utf8"), original);
    await assert.rejects(readFile(`${path}.rimlib.bak`, "utf8"), /ENOENT/);
  });
});

void test("active config writer treats a _steam marker change as physical-copy drift", async () => {
  await fixture(async (path, original) => {
    let closed = false;
    await assert.rejects(
      setActiveMods(
        { rimWorldConfigPath: path },
        ["ludeon.rimworld", "author.new"],
        ["brrainz.harmony_steam", "ludeon.rimworld", "Author.Old_steam"],
        {
          assertClosed: async () => {
            closed = true;
          },
        },
      ),
      /changed outside RimLib/,
    );
    assert.equal(closed, false);
    assert.equal(await readFile(path, "utf8"), original);
    await assert.rejects(readFile(`${path}.rimlib.bak`, "utf8"), /ENOENT/);
  });
});

void test("active config writer leaves the config untouched when RimWorld cannot be confirmed closed", async () => {
  await fixture(async (path, original) => {
    await assert.rejects(
      setActiveMods({ rimWorldConfigPath: path }, ["ludeon.rimworld", "author.new"], currentOrder, {
        assertClosed: async () => {
          throw new Error("RimWorld is running");
        },
      }),
      /RimWorld is running/,
    );
    assert.equal(await readFile(path, "utf8"), original);
    await assert.rejects(readFile(`${path}.rimlib.bak`, "utf8"), /ENOENT/);
  });
});

void test("active config writer's guarded atomic write preserves a concurrent external edit", async () => {
  await fixture(async (path, original) => {
    const external = config(currentOrder, "external edit");
    await assert.rejects(
      setActiveMods({ rimWorldConfigPath: path }, ["ludeon.rimworld", "author.new"], currentOrder, {
        assertClosed: async () => {
          await writeFile(path, external);
        },
      }),
      /File changed outside this app/,
    );
    assert.equal(await readFile(path, "utf8"), external);
    assert.equal(await readFile(`${path}.rimlib.bak`, "utf8"), original);
  });
});

void test("active config writer verifies the complete post-write file and preserves its backup", async () => {
  await fixture(async (path, original) => {
    const requested = ["ludeon.rimworld", "author.new"];
    await assert.rejects(
      setActiveMods({ rimWorldConfigPath: path }, requested, currentOrder, {
        assertClosed: async () => undefined,
        write: async (target, text, guard) => {
          await atomicWrite(target, text, guard);
          if (target === path) {
            await writeFile(path, text.replace("retained", "external post-write edit"));
          }
        },
      }),
      /could not be verified after writing/,
    );
    assert.match(await readFile(path, "utf8"), /external post-write edit/);
    assert.equal(await readFile(`${path}.rimlib.bak`, "utf8"), original);
  });
});
