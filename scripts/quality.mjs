import { spawn } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
for (const [command, args] of [
  [npm, ["run", "format:check"]],
  [npm, ["run", "lint"]],
  [npm, ["run", "typecheck"]],
  [npm, ["test"]],
  [process.execPath, ["scripts/e2e.mjs"]],
]) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32" && command === npm,
    });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0) {
    process.exitCode = code;
    break;
  }
}
