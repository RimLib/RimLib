import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { fixturePath, harness, verifyFixture } from "./e2e/contracts";

void test("Electron E2E isolation rejects unowned directories and mismatched tokens", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), harness.prefix)));
  const token = randomUUID();
  try {
    assert.throws(() => verifyFixture(root, token));
    await writeFile(join(root, harness.marker), token);
    assert.equal(verifyFixture(root, token), root);
    assert.throws(() => verifyFixture(root, "another-test"));
    assert.throws(() => verifyFixture(dirname(root), token));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("Electron E2E path guards reject traversal and symlink escapes, including missing children", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), harness.prefix)));
  const outside = await realpath(await mkdtemp(join(tmpdir(), "e2e-outside-")));
  try {
    await mkdir(join(root, "safe"));
    assert.equal(
      fixturePath(root, join(root, "safe", "missing.json")),
      join(root, "safe", "missing.json"),
    );
    assert.throws(() => fixturePath(root, join(root, "..", "outside")));
    assert.throws(() => fixturePath(root, "relative-path"));
    await symlink(outside, join(root, "escape"), "junction");
    assert.throws(() => fixturePath(root, join(root, "escape")));
    assert.throws(() => fixturePath(root, join(root, "escape", "missing", "file.json")));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
