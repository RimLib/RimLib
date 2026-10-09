import { spawn } from "node:child_process";
import { access, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, ".e2e-build");
const nativeModules = new Set(
  ["steamClient", "steamAvailability", "steamWorkshop", "installedMods", "rimWorldConfig"].map(
    (name) => join(root, "src", "main", name),
  ),
);

async function run(entry, args) {
  const code = await new Promise((fulfill, reject) => {
    const child = spawn(process.execPath, [join(root, "node_modules", entry), ...args], {
      cwd: root,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("close", fulfill);
  });
  if (code !== 0) {
    throw new Error(`Command failed (${String(code)}): ${entry}`);
  }
}

try {
  try {
    await access(join(root, "node_modules", "@playwright", "test", "cli.js"));
  } catch {
    throw new Error(
      "Playwright is not installed. Run npm install before running Electron E2E tests.",
    );
  }
  // Compile the production preload/renderer. Only native adapters in the test main are replaced.
  await run("electron-vite/bin/electron-vite.js", ["build", "--outDir", ".e2e-build/app"]);
  await build({
    entryPoints: [join(root, "tests", "e2e", "bootstrap.ts")],
    outfile: join(output, "main.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    define: { __dirname: JSON.stringify(join(output, "app", "main")) },
    plugins: [
      {
        name: "electron-vite-assets",
        setup(builder) {
          builder.onResolve({ filter: /\?asset$/ }, (args) => ({
            path: resolve(args.resolveDir, args.path.slice(0, -"?asset".length)),
            namespace: "electron-vite-asset",
          }));
          builder.onLoad({ filter: /.*/, namespace: "electron-vite-asset" }, (args) => ({
            contents: `export default ${JSON.stringify(args.path)};`,
            loader: "js",
          }));
        },
      },
      {
        name: "isolated-native-adapters",
        setup(builder) {
          builder.onResolve({ filter: /^\.\.?\// }, (args) => {
            if (
              args.importer.startsWith(join(root, "src", "main")) &&
              nativeModules.has(resolve(args.resolveDir, args.path))
            ) {
              return { path: join(root, "tests", "e2e", "native.ts") };
            }
            return undefined;
          });
        },
      },
    ],
  });
  await run("@playwright/test/cli.js", ["test", ...process.argv.slice(2)]);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await rm(output, { recursive: true, force: true });
}
