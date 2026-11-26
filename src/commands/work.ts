import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { constants as osConstants } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { resolveActiveProfile } from "../lib/cwd-resolver";

const usage = `cue work "<task>" [--task-id <id>] [--agent codex|claude] [--profile <name>] [--preview]
cue work --resume [--task-id <id>] [--agent codex|claude] [--profile <name>]

Start or reuse an isolated GitGuardex worktree, then launch the agent there.
Defaults: Codex, the current Cue profile, and an ID derived from the task title.
--preview plans the checkout without creating a worktree or launching an agent.
--resume picks an existing task worktree; pass --task-id to select without a TTY.
`;
const controlChars = /[\x00-\x1f\x7f]/;
const taskId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
type Agent = "codex" | "claude";
type Task = { taskId: string; agent: Agent; branch: string; worktree: string };
type ListedTask = Task & { busy: boolean };

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

function validTask(value: Partial<Task> | null): value is Task {
  return !!value && typeof value.taskId === "string" && taskId.test(value.taskId) &&
    (value.agent === "codex" || value.agent === "claude") &&
    typeof value.branch === "string" && value.branch.startsWith(`agent/${value.agent}/`) && !controlChars.test(value.branch) &&
    typeof value.worktree === "string" && isAbsolute(value.worktree) && !controlChars.test(value.worktree);
}

function pickTask(tasks: ListedTask[]): Promise<ListedTask | undefined> {
  for (const [index, task] of tasks.entries()) {
    process.stderr.write(`  ${index + 1}. ${task.taskId} · ${task.branch}${task.busy ? " (in use)" : ""}\n`);
  }
  if (!process.stdin.isTTY) return Promise.resolve(undefined);
  const input = createInterface({ input: process.stdin, output: process.stderr });
  process.stderr.write("Choose a task number (Enter to cancel): ");
  return input[Symbol.asyncIterator]().next().then(({ value }) => {
    return /^[1-9]\d*$/.test(value ?? "") ? tasks[Number(value) - 1] : undefined;
  }).finally(() => input.close());
}

function runGuarded(cwd: string, task: Task, launchArgs: string[]): Promise<number> {
  return new Promise((done) => {
    // Reenter cue under the GitGuardex lease, retaining the active launcher for
    // both the Bun source CLI and the Node package wrapper.
    const child = spawn("gx", [
      "branch", "run-task", task.taskId, task.branch, task.worktree, "--",
      process.execPath, resolve(process.argv[1]!), "launch", ...launchArgs,
    ], { cwd, env: { ...process.env, CUE_NO_UPDATE_CHECK: "1" }, stdio: "inherit" });
    child.once("error", (error) => done(fail(error.message)));
    child.once("exit", (code, signal) => done(code ?? (signal ? 128 + osConstants.signals[signal] : 1)));
  });
}

export async function run(args: string[]): Promise<number> {
  let options;
  try {
    options = parseArgs({
      args, allowPositionals: true, strict: true,
      options: {
        help: { type: "boolean", short: "h" },
        preview: { type: "boolean" },
        resume: { type: "boolean" },
        "task-id": { type: "string" },
        agent: { type: "string" },
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
  const { preview, resume, agent: specificAgent } = values;
  const title = positionals[0]?.trim() ?? "";
  if (resume ? !!preview || positionals.length !== 0
    : positionals.length !== 1 || !title || title.length > 256 || controlChars.test(title)) {
    if (resume) return fail("--resume cannot be combined with a task title or --preview.");
    return fail('Pass one single-line task title (max 256 characters); see cue work --help.');
  }
  if (specificAgent !== undefined && specificAgent !== "codex" && specificAgent !== "claude") {
    return fail("--agent must be codex or claude.");
  }
  const requestedId = values["task-id"];
  if (requestedId !== undefined && !taskId.test(requestedId)) return fail("Invalid --task-id.");
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

  let selected: Task;
  let prompt: string;
  const profile = await resolveActiveProfile(cwd, explicitProfile);
  const agent = specificAgent ?? "codex";
  const id = requestedId ?? `cue-${createHash("sha256").update(title).digest("hex").slice(0, 24)}`;
  // Prefix the title so even a task named "help" cannot be parsed as a gx flag.
  const startArgs = [
    "branch", "start", "--tier", "T1", "--no-transfer", "--reuse-existing",
    "--task-id", id, "--task", `cue ${title}`, "--agent", agent,
  ];
  const gx = (argv: string[]) => spawnSync("gx", argv, { cwd, encoding: "utf8" });
  if (preview) {
    const result = gx([...startArgs, "--preview"]);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status !== 0) return fail("GitGuardex could not preview the task. No agent launched.");
    process.stdout.write(`Task: ${title}\nTask ID: ${id}\nAgent: ${agent}\nCue profile: ${profile ?? "(auto)"}\n`);
    if (result.stdout) process.stdout.write(result.stdout);
    return 0;
  }

  const support = gx(["branch", "tasks", "--help"]);
  const structured = support.status === 0 && support.stdout.startsWith("Usage: gx branch tasks --json\n");
  // Only the legacy CLI's explicit unknown-subcommand response permits an
  // unguarded legacy launch. A failed or changed probe must fail closed.
  const legacy = support.status === 1 && !support.error && !support.signal &&
    support.stdout.startsWith("Usage: gx branch <start|finish|merge> [options] (examples:");
  if (!structured && !legacy) return fail("Could not determine GitGuardex task support. No agent launched.");
  if (resume) {
    if (!structured) return fail("--resume requires a GitGuardex version with `gx branch tasks --json`.");
    const list = gx(["branch", "tasks", "--json"]);
    if (list.status !== 0) {
      if (list.stderr) process.stderr.write(list.stderr);
      return fail("GitGuardex could not list this repository's tasks.");
    }
    let choices: ListedTask[];
    try {
      const data = JSON.parse(list.stdout);
      if (data?.version !== 1 || !Array.isArray(data.tasks)) throw new Error();
      choices = data.tasks.filter((item: ListedTask) => validTask(item) && typeof item.busy === "boolean" &&
        (!specificAgent || item.agent === specificAgent));
    } catch {
      return fail("GitGuardex returned an unrecognized task list.");
    }
    if (!choices.length) return fail("No resumable Codex or Claude task worktrees in this repository.");
    const matches = requestedId ? choices.filter((item) => item.taskId === requestedId) : [];
    const choice = requestedId ? (matches.length === 1 ? matches[0] : undefined) : await pickTask(choices);
    if (!choice) return fail(requestedId ? "Task ID was not uniquely found." :
      process.stdin.isTTY ? "No task selected." : "Use --task-id to select a task without a terminal.");
    if (choice.busy) return fail("Task worktree is in use or its occupancy cannot be verified.");
    selected = choice;
    prompt = `Continue task ${choice.taskId}. Inspect the worktree before making changes.`;
  } else {
    process.stderr.write(`[cue] gx · preparing task ${id}\n`);
    const result = gx(structured ? [...startArgs, "--json"] : startArgs);
    if (result.status !== 0) {
      if (result.stderr) process.stderr.write(result.stderr);
      return fail("GitGuardex could not start or reuse the task. No agent launched.");
    }
    try {
      if (structured) {
        const task = JSON.parse(result.stdout);
        if (task?.version !== 1 || !validTask(task) || task.taskId !== id || task.agent !== agent) throw new Error();
        selected = task;
      } else {
        const paths = [...result.stdout.matchAll(/^\[agent-branch-start\] Worktree: ([^\r\n]+)\r?$/gm)];
        const legacyPath = paths[0]?.[1];
        if (paths.length !== 1 || !legacyPath || !isAbsolute(legacyPath) || controlChars.test(legacyPath)) throw new Error();
        selected = { taskId: id, agent, branch: "", worktree: legacyPath };
      }
    } catch {
      return fail("GitGuardex did not return a linked agent worktree for this repository. No agent launched.");
    }
    prompt = `Task: ${title}`;
  }

  let worktree: string, branch: string;
  try {
    worktree = realpathSync(selected.worktree);
    const target = checkout(worktree);
    branch = git(worktree, "symbolic-ref", "--short", "HEAD");
    if (target.root !== worktree || target.common !== original.common ||
        !lstatSync(join(worktree, ".git")).isFile() || !branch.startsWith(`agent/${selected.agent}/`) ||
        (structured && branch !== selected.branch)) {
      throw new Error();
    }
  } catch {
    return fail("GitGuardex did not return a linked agent worktree for this repository. No agent launched.");
  }

  const launchArgs = [selected.agent, ...(profile ? ["--cue-profile", profile] : []), "--", prompt];
  process.stderr.write(`[cue] gx · ${branch} · ${worktree}\n`);
  if (structured) return runGuarded(cwd, { ...selected, worktree }, launchArgs);
  const { run: launch } = await import("./launch");
  process.chdir(worktree);
  try {
    return await launch(launchArgs);
  } finally {
    process.chdir(cwd);
  }
}
