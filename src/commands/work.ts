import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { parseArgs } from "node:util";
import { resolveActiveProfile } from "../lib/cwd-resolver";

const usage = `cue work "<task>" [--task-id <id>] [--agent codex|claude] [--profile <name>]

Start or reuse an isolated GitGuardex worktree, then launch the agent there.
Defaults: Codex, the current Cue profile, and an ID derived from the task title.
Use the same ID to resume after the previous agent exits.
`;
const controlChars = /[\x00-\x1f\x7f]/;

function fail(message: string): 1 {
  process.stderr.write(`cue work: ${message}\n`);
  return 1;
}

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error("Git checkout unavailable");
  return result.stdout.trimEnd();
}

function checkout(cwd: string): { root: string; common: string } {
  const [root, common, ...rest] = git(cwd, "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir").split("\n");
  if (!root || !common || rest.length || !isAbsolute(root) || !isAbsolute(common)) {
    throw new Error("Unrecognized Git checkout");
  }
  return { root: realpathSync(root), common: realpathSync(common) };
}

export async function run(args: string[]): Promise<number> {
  let options;
  try {
    options = parseArgs({
      args, allowPositionals: true, strict: true,
      options: {
        help: { type: "boolean", short: "h" },
        "task-id": { type: "string" },
        agent: { type: "string", default: "codex" },
        profile: { type: "string" },
      },
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Invalid arguments.");
  }
  const { values, positionals } = options;
  if (values.help) {
    process.stdout.write(usage);
    return 0;
  }
  const task = positionals[0]?.trim();
  if (positionals.length !== 1 || !task || task.length > 256 || controlChars.test(task)) {
    return fail('Pass one single-line task title (max 256 characters); see cue work --help.');
  }
  const { agent } = values;
  if (agent !== "codex" && agent !== "claude") return fail("--agent must be codex or claude.");
  const id = values["task-id"] ?? `cue-${createHash("sha256").update(task).digest("hex").slice(0, 24)}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) return fail("Invalid --task-id.");
  const explicitProfile = values.profile?.trim();
  if (values.profile !== undefined && (!explicitProfile || explicitProfile.startsWith("-") || controlChars.test(explicitProfile))) {
    return fail("Invalid --profile.");
  }
  if (process.env.CUE_BYPASS === "1") return fail("Unset CUE_BYPASS to launch with a Cue profile.");
  if (process.platform === "win32") return fail("Run cue work under WSL.");
  if (["GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"].some(key => process.env[key] !== undefined)) {
    return fail("Unset Git checkout overrides before starting a worktree.");
  }

  const cwd = process.cwd();
  let original;
  try {
    original = checkout(cwd);
  } catch {
    return fail("Start inside a GitGuardex-managed Git checkout.");
  }
  const health = spawnSync("gx", ["status", "--json"], { cwd, encoding: "utf8" });
  if ((health.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
    return fail("GitGuardex (gx) is required on PATH.");
  }
  if (health.status !== 0) return fail("Could not check GitGuardex. Run gx status for details.");
  try {
    const repo = JSON.parse(health.stdout)?.repo;
    if (repo?.serviceStatus !== "active" || repo?.guardexEnabled !== true || repo?.inGitRepo !== true) {
      return fail("GitGuardex is not active for this checkout. Run gx status for details.");
    }
  } catch {
    return fail("GitGuardex returned an unrecognized status. Run gx status --json.");
  }

  const profile = await resolveActiveProfile(cwd, explicitProfile);
  process.stderr.write(`[cue] gx · preparing task ${id}\n`);
  // Prefix the title so even a task named "help" cannot be parsed as a gx flag.
  const start = spawnSync("gx", [
    "branch", "start", "--tier", "T1", "--no-transfer", "--reuse-existing",
    "--task-id", id, "--task", `cue ${task}`, "--agent", agent,
  ], { cwd, encoding: "utf8" });
  if (start.status !== 0) {
    if (start.stderr) process.stderr.write(start.stderr);
    return fail("GitGuardex could not start or reuse the task. No agent launched.");
  }

  let worktree: string;
  let branch: string;
  try {
    const paths = [...start.stdout.matchAll(/^\[agent-branch-start\] Worktree: ([^\r\n]+)\r?$/gm)];
    const path = paths[0]?.[1];
    if (paths.length !== 1 || !path || !isAbsolute(path) || controlChars.test(path)) throw new Error();
    worktree = realpathSync(path);
    const target = checkout(worktree);
    branch = git(worktree, "symbolic-ref", "--short", "HEAD");
    if (target.root !== worktree || target.common !== original.common ||
        !lstatSync(join(worktree, ".git")).isFile() || !branch.startsWith(`agent/${agent}/`)) {
      throw new Error();
    }
  } catch {
    return fail("GitGuardex did not return a linked agent worktree for this repository. No agent launched.");
  }

  const { run: launch } = await import("./launch");
  process.stderr.write(`[cue] gx · ${branch} · ${worktree}\n`);
  process.chdir(worktree);
  try {
    return await launch([agent, ...(profile ? ["--cue-profile", profile] : []), "--", `Task: ${task}`]);
  } finally {
    process.chdir(cwd);
  }
}
