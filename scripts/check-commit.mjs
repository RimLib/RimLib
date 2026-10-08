import { spawn } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

function execute(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32" && command.endsWith(".cmd"),
    });
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}

const root = process.cwd();
const snapshot = await mkdtemp(join(tmpdir(), "mod-library-commit-"));
try {
  // Check the exact index; do not stash user changes or modify staged files.
  let code = await execute("git", ["checkout-index", "--all", `--prefix=${snapshot}${sep}`], root);
  if (code === 0) {
    await symlink(join(root, "node_modules"), join(snapshot, "node_modules"), "junction");
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    code = await execute(npm, ["run", "quality"], snapshot);
  }
  process.exitCode = code;
} finally {
  await rm(snapshot, { recursive: true, force: true });
}
