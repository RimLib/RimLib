import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cache = join(root, "node_modules", ".cache");
await mkdir(cache, { recursive: true });
const directory = await mkdtemp(join(cache, "rimlib-tests-"));
const args = process.argv.slice(2);
const propertiesOnly = args[0] === "--properties";
const testArgs = propertiesOnly ? args.slice(1) : args;
try {
  const entries = (await readdir(join(root, "tests")))
    .filter((entry) => /\.test\.tsx?$/.test(entry))
    .filter((entry) => !propertiesOnly || /\.property\.test\.tsx?$/.test(entry))
    .sort();
  if (!entries.length) {
    throw new Error("No tests were discovered.");
  }
  await build({
    entryPoints: entries.map((entry) => join(root, "tests", entry)),
    outdir: directory,
    bundle: true,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    packages: "external",
    logLevel: "silent",
  });
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--test",
        ...testArgs,
        ...entries.map((entry) => join(directory, entry.replace(/\.tsx?$/, ".js"))),
      ],
      { stdio: "inherit" },
    );
    child.once("error", reject);
    child.once("close", resolve);
  });
  process.exitCode = code ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
