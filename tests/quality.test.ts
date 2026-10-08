import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ESLint } from "eslint";

import { isRecord, requireValue } from "../src/shared/validation";

void test("lint rules reject unsafe TypeScript and renderer access to privileged modules", async () => {
  const eslint = new ESLint();
  const results = await eslint.lintText(
    'import { shell } from "electron";\nexport const unsafe: any = shell;\n',
    { filePath: "src/renderer/src/services/diagnostics.ts" },
  );
  const messages = requireValue(results[0]).messages.map((message) => message.ruleId);
  assert.ok(messages.includes("no-restricted-imports"));
  assert.ok(requireValue(results[0]).errorCount > 0);
  const bareNode = await eslint.lintText('import fs from "fs";\nexport const files = fs;\n', {
    filePath: "src/renderer/src/services/diagnostics.ts",
  });
  assert.ok(
    requireValue(bareNode[0]).messages.some(
      (message) => message.ruleId === "no-restricted-imports",
    ),
  );
  // A source path outside the project must be rejected instead of silently skipping typed lint.
  const missing = await eslint.lintText("export const value = 1;\n", {
    filePath: "src/shared/quality-probe.ts",
  });
  assert.ok(requireValue(missing[0]).messages.some((message) => message.fatal));
  const typed = await eslint.lintText("export const unsafe: any = 1;\n", {
    filePath: "src/shared/validation.ts",
  });
  assert.ok(
    requireValue(typed[0]).messages.some(
      (message) => message.ruleId === "@typescript-eslint/no-explicit-any",
    ),
  );
  const suppression = await eslint.lintText(
    "/* eslint-disable @typescript-eslint/no-explicit-any */\nexport const unsafe: any = 1;\n",
    { filePath: "src/shared/validation.ts" },
  );
  assert.ok(
    requireValue(suppression[0]).messages.some(
      (message) => message.ruleId === "@typescript-eslint/no-explicit-any",
    ),
  );
});

void test("production and test configurations retain the unsafe-code and Promise safety rules", async () => {
  const eslint = new ESLint();
  for (const path of ["out/main/index.js", "dist/index.js", "node_modules/example/index.js"]) {
    assert.equal(
      await eslint.isPathIgnored(path),
      true,
      `${path}: generated output must be ignored`,
    );
  }
  for (const path of ["src/main/index.ts", "src/renderer/src/App.tsx", "tests/vault.test.ts"]) {
    const config: unknown = await eslint.calculateConfigForFile(path);
    assert.ok(isRecord(config) && isRecord(config.rules));
    for (const rule of [
      "@typescript-eslint/no-explicit-any",
      "@typescript-eslint/no-unsafe-assignment",
      "@typescript-eslint/no-floating-promises",
      "@typescript-eslint/no-non-null-assertion",
      "curly",
    ]) {
      const setting: unknown = config.rules[rule];
      assert.ok(Array.isArray(setting));
      assert.equal(setting[0], 2, `${path}: ${rule} must be an error`);
    }
  }
});

void test("lint prevents reintroducing raw IPC and persisted action keys but allows ordinary labels", async () => {
  const eslint = new ESLint();
  for (const value of [
    "steam:set-subscription",
    "app:close-ready",
    "unsubscribe-mods",
    "steam-client",
  ]) {
    const results = await eslint.lintText(`export const value = ${JSON.stringify(value)};\n`, {
      filePath: "src/renderer/src/services/diagnostics.ts",
    });
    assert.ok(
      requireValue(results[0]).messages.some(
        (message) => message.ruleId === "no-restricted-syntax",
      ),
    );
  }
  const results = await eslint.lintText('export const label = "Subscribe mods";\n', {
    filePath: "src/renderer/src/services/diagnostics.ts",
  });
  assert.ok(
    requireValue(results[0]).messages.every((message) => message.ruleId !== "no-restricted-syntax"),
  );
  const definition = await eslint.lintText('export const action = "unsubscribe-mods";\n', {
    filePath: "src/shared/domainConstants.ts",
  });
  assert.ok(
    requireValue(definition[0]).messages.every(
      (message) => message.ruleId !== "no-restricted-syntax",
    ),
  );
});

void test("the commit gate checks staged files, rejects bad staged code, and leaves user files untouched", async () => {
  const root = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), "mod-library-hook-test-"));
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  const runGate = () =>
    spawnSync(process.execPath, [join(root, "scripts", "check-commit.mjs")], {
      cwd: directory,
      encoding: "utf8",
      timeout: 30000,
    });
  try {
    git("init", "-q");
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ private: true, type: "module", scripts: { quality: "node verify.mjs" } }),
    );
    await writeFile(
      join(directory, "verify.mjs"),
      'import { readFileSync } from "node:fs"; process.exitCode = readFileSync("state.txt", "utf8") === "valid" ? 0 : 1;',
    );
    await writeFile(join(directory, "state.txt"), "valid");
    git("-c", "core.autocrlf=false", "add", ".");
    await writeFile(join(directory, "state.txt"), "invalid");
    const passing = runGate();
    assert.equal(passing.status, 0, passing.stderr);
    assert.equal(await readFile(join(directory, "state.txt"), "utf8"), "invalid");
    git("-c", "core.autocrlf=false", "add", "state.txt");
    await writeFile(join(directory, "state.txt"), "valid");
    const failing = runGate();
    assert.equal(failing.status, 1, failing.stderr);
    assert.equal(await readFile(join(directory, "state.txt"), "utf8"), "valid");
    const staged = spawnSync("git", ["show", ":state.txt"], { cwd: directory, encoding: "utf8" });
    assert.equal(staged.stdout, "invalid");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
