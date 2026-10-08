import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
if (process.env.HUSKY !== "0") {
  const git = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8" });
  if (git.status !== 0 || realpathSync(git.stdout.trim()) !== realpathSync(root)) {
    console.log(
      "Git hooks were not installed: initialize this project as a Git repository, then run npm run prepare.",
    );
  } else {
    process.chdir(resolve(root));
    const { default: husky } = await import("husky");
    const error = husky();
    if (error) {
      throw new Error(error);
    }
  }
}
