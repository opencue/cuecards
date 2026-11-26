import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cue = join(import.meta.dir, "../index.ts");

function withCheckout(check: (fixture: {
  run: (args: string[], extra?: NodeJS.ProcessEnv) => ReturnType<typeof invoke>;
  base: string;
  worktree: string;
  git: (...args: string[]) => string;
  log: string;
}) => void) {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), "cue-work-")));
  const base = join(temp, "repo");
  const worktree = join(temp, "task worktree");
  const bin = join(temp, "bin");
  const agent = join(bin, "claude");
  const log = join(temp, "gx.log");
  const profiles = join(temp, "profiles");
  mkdirSync(base);
  mkdirSync(bin);
  for (const name of ["fixture", "override", "ponytail"]) {
    mkdirSync(join(profiles, name), { recursive: true });
    const defaults = name === "ponytail"
      ? "skills:\n  npx:\n    - repo: DietrichGebert/ponytail\n      skills: [ponytail]\n"
      : "";
    writeFileSync(join(profiles, name, "profile.yaml"), `name: ${name}\ndescription: Cue work test\n${defaults}`);
  }
  const env = {
    PATH: `${bin}:${process.env.PATH}`,
    HOME: temp,
    XDG_CONFIG_HOME: join(temp, "config"),
    XDG_CACHE_HOME: join(temp, "cache"),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    CUE_PROFILES_DIR: profiles,
    CUE_REAL_CODEX: agent,
    CUE_OFFLINE: "1",
    CUE_NO_TELEMETRY: "1",
    CI: "1",
    GX_BASE: base,
    GX_WORKTREE: worktree,
    GX_LOG: log,
  };
  function git(...args: string[]) {
    const result = spawnSync("git", args, { cwd: base, env, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || String(result.error));
    return result.stdout;
  }
  try {
    git("init", "-q", "-b", "main");
    writeFileSync(join(base, "tracked.txt"), "committed");
    git("add", "tracked.txt");
    git("-c", "user.name=test", "-c", "user.email=test@example.org", "commit", "-qm", "test");
    writeFileSync(join(base, "tracked.txt"), "dirty on main");
    writeFileSync(join(base, ".cue.profile"), "fixture\n");
    writeFileSync(join(base, "untracked.txt"), "only on main");
    writeFileSync(agent, `#!/bin/sh
printf 'AGENT_CWD=%s\\nAGENT_PROFILE=%s\\nAGENT_ARGS=%s\\n' "$PWD" "$CUE_PROFILE" "$*"
exit "${"$"}{AGENT_EXIT:-0}"
`, { mode: 0o755 });
    writeFileSync(join(bin, "gx"), `#!/bin/sh
set -eu
printf '%s\\n' "$*" >>"$GX_LOG"
if [ "$*" = "status --json" ]; then
  printf '{"repo":{"inGitRepo":true,"guardexEnabled":true,"serviceStatus":"%s"}}\\n' "${"$"}{GX_STATUS:-active}"
  exit 0
fi
if [ "$*" = "branch tasks --help" ]; then
  case "${"$"}{GX_PROBE:-normal}" in
    failed) echo 'service temporarily unavailable' >&2; exit 1 ;;
    changed) echo 'New usage banner'; exit 0 ;;
  esac
  if [ "${"$"}{GX_STRUCTURED:-0}" != 1 ]; then
    printf 'Usage: gx branch <start|finish|merge> [options] (examples:\\n'
    exit 1
  fi
  printf 'Usage: gx branch tasks --json\\n'
  exit 0
fi
if [ "$*" = "branch tasks --json" ]; then
  printf '{"version":1,"tasks":[{"taskId":"fixture-task","agent":"codex","branch":"agent/codex/fixture","worktree":"%s","busy":%s}]}\\n' "$GX_WORKTREE" "${"$"}{GX_BUSY:-false}"
  exit 0
fi
if [ "$1 $2" = "branch run-task" ]; then
  [ "$4" = "agent/codex/fixture" ] && [ "$5" = "$GX_WORKTREE" ] && [ "$6" = "--" ]
  if [ "${"$"}{GX_RUN_BUSY:-0}" = 1 ]; then echo "task became busy" >&2; exit 75; fi
  cd "$5"
  shift 6
  exec "$@"
fi
[ "$1 $2 $3 $4" = "branch start --tier T1" ]
[ "$5 $6" = "--no-transfer --reuse-existing" ]
[ "$7" = "--task-id" ] && [ -n "$8" ]
id="$8"
[ "$9" = "--task" ]
shift 10
[ "$1" = "--agent" ]
if [ "${"$"}{GX_FAIL:-0}" = 1 ]; then echo "task is unavailable" >&2; exit 9; fi
if [ "${"$"}{3:-}" = "--preview" ]; then
  printf 'Checkout estimate: 123 bytes\\n'
  exit 0
fi
if [ "${"$"}{GX_BAD_PATH:-0}" = 1 ]; then
  printf '[agent-branch-start] Worktree: %s\\n' "$GX_BASE"
  exit 0
fi
[ -f "$GX_WORKTREE/.git" ] || git -C "$GX_BASE" worktree add -qb "agent/$2/fixture" "$GX_WORKTREE"
if [ "${"$"}{GX_STRUCTURED:-0}" = 1 ]; then
  [ "${"$"}{3:-}" = "--json" ]
  printf '{"version":%s,"taskId":"%s","agent":"%s","branch":"agent/%s/%s","worktree":"%s"}\\n' "${"$"}{GX_VERSION:-1}" "$id" "$2" "$2" "${"$"}{GX_BRANCH_SUFFIX:-fixture}" "$GX_WORKTREE"
  exit 0
fi
printf '[agent-branch-start] Worktree: %s\\n' "$GX_WORKTREE"
`, { mode: 0o755 });
    check({ run: (args, extra) => invoke(base, args, { ...env, ...extra }), base, worktree, git, log });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function invoke(cwd: string, args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(process.execPath, [cue, "work", ...args], { cwd, env, encoding: "utf8", timeout: 25_000 });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

test.skipIf(process.platform === "win32")("reuses a task worktree without transferring main changes", () => {
  withCheckout(({ run, base, worktree, git, log }) => {
    const before = git("status", "--porcelain");
    for (const title of ["Fix the parser", "Renamed task"]) {
      const result = run([title, "--task-id", "parser-42"]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(`AGENT_CWD=${worktree}`);
      expect(result.stdout).toContain("AGENT_PROFILE=fixture");
      expect(result.stdout).toContain(`AGENT_ARGS=Task: ${title}`);
    }
    expect(git("worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(2);
    expect(readFileSync(log, "utf8").match(/--task-id parser-42/g)).toHaveLength(2);
    expect(git("status", "--porcelain")).toBe(before);
    expect(git("branch", "--show-current").trim()).toBe("main");
    expect(readFileSync(join(base, "tracked.txt"), "utf8")).toBe("dirty on main");
    expect(readFileSync(join(worktree, "tracked.txt"), "utf8")).toBe("committed");
    expect(existsSync(join(worktree, "untracked.txt"))).toBe(false);
  });
});

test.skipIf(process.platform === "win32")("preview prints the plan without creating a worktree or starting a writer", () => {
  withCheckout(({ run, git, log }) => {
    const before = git("worktree", "list", "--porcelain");
    const result = run(["Preview me", "--task-id", "preview", "--profile", "override", "--agent", "claude", "--preview"]);
    expect(result.status, result.stderr).toBe(0);
    for (const line of ["Task: Preview me", "Task ID: preview", "Agent: claude", "Cue profile: override", "Checkout estimate: 123 bytes"]) {
      expect(result.stdout).toContain(line);
    }
    expect(result.stdout).not.toContain("AGENT_CWD");
    expect(git("worktree", "list", "--porcelain")).toBe(before);
    expect(readFileSync(log, "utf8")).toContain("--agent claude --preview");
  });
});

test.skipIf(process.platform === "win32")("structured start checks the reported version and branch and never retries the legacy mutation", () => {
  withCheckout(({ run, worktree, log }) => {
    const env = { GX_STRUCTURED: "1" };
    const ok = run(["Structured", "--task-id", "fixture-task"], { ...env, AGENT_EXIT: "7" });
    expect(ok.status, ok.stderr).toBe(7);
    expect(ok.stdout).toContain(`AGENT_CWD=${worktree}`);
    expect(ok.stdout).toContain("AGENT_PROFILE=fixture");
    for (const invalid of [{ GX_VERSION: "2" }, { GX_BRANCH_SUFFIX: "other" }]) {
      const rejected = run(["Structured", "--task-id", "fixture-task"], { ...env, ...invalid });
      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toContain("linked agent worktree");
      expect(rejected.stdout).not.toContain("AGENT_CWD");
    }
    const trace = readFileSync(log, "utf8");
    expect(trace.match(/^branch start.* --json$/gm)).toHaveLength(3);
    expect(trace.match(/^branch run-task /gm)).toHaveLength(1);
  });
});

test.skipIf(process.platform === "win32")("an ambiguous capability probe cannot downgrade to an unguarded start", () => {
  withCheckout(({ run, log }) => {
    for (const probe of ["failed", "changed"]) {
      const result = run(["No fallback"], { GX_PROBE: probe });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Could not determine GitGuardex task support");
      expect(result.stdout).not.toContain("AGENT_CWD");
    }
    expect(readFileSync(log, "utf8")).not.toContain("branch start");
  });
});

test.skipIf(process.platform === "win32")("resume lists tasks noninteractively and only launches a selected idle worktree", () => {
  withCheckout(({ run, git, worktree, log }) => {
    const env = { GX_STRUCTURED: "1" };
    git("worktree", "add", "-qb", "agent/codex/fixture", worktree);
    const before = git("worktree", "list", "--porcelain");
    const list = run(["--resume"], env);
    expect(list.status).toBe(1);
    expect(list.stderr).toContain("1. fixture-task");
    expect(list.stderr).toContain("Use --task-id");
    const args = ["--resume", "--task-id", "fixture-task"];
    const busy = run(args, { ...env, GX_BUSY: "true" });
    expect(busy.status).toBe(1);
    expect(busy.stderr).toContain("in use");
    expect(run(["--resume", "--task-id", "missing"], env).status).toBe(1);
    const becameBusy = run(args, { ...env, GX_RUN_BUSY: "1" });
    expect(becameBusy.status).toBe(75);
    expect(becameBusy.stderr).toContain("task became busy");
    expect(becameBusy.stdout).not.toContain("AGENT_CWD");
    const resumed = run(args, env);
    expect(resumed.status, resumed.stderr).toBe(0);
    expect(resumed.stdout).toContain(`AGENT_CWD=${worktree}`);
    expect(resumed.stdout).toContain("AGENT_ARGS=Continue task fixture-task");
    expect(git("worktree", "list", "--porcelain")).toBe(before);
    const trace = readFileSync(log, "utf8");
    expect(trace).not.toContain("branch start");
    expect(trace.match(/^branch run-task /gm)).toHaveLength(2);
  });
});

test.skipIf(process.platform === "win32")("supports Claude and an explicit profile and preserves the agent exit code", () => {
  withCheckout(({ run, worktree }) => {
    const result = run(["help", "--agent", "claude", "--profile", "override"], { AGENT_EXIT: "7" });
    expect(result.status, result.stderr).toBe(7);
    expect(result.stdout).toContain(`AGENT_CWD=${worktree}`);
    expect(result.stdout).toContain("AGENT_PROFILE=override");
    expect(result.stdout).toContain("AGENT_ARGS=Task: help");
  });
});

test.skipIf(process.platform === "win32")("refuses an inactive Guardex, failed worktree creation, and a base checkout result", () => {
  withCheckout(({ run, log }) => {
    const disabled = run(["Fix it"], { GX_STATUS: "disabled" });
    expect(disabled.status).toBe(1);
    expect(disabled.stderr).toContain("GitGuardex is not active");
    expect(readFileSync(log, "utf8")).toBe("status --json\n");
    const failed = run(["Fix it"], { GX_FAIL: "1" });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("task is unavailable");
    const unsafe = run(["Fix it"], { GX_BAD_PATH: "1" });
    expect(unsafe.status).toBe(1);
    expect(unsafe.stderr).toContain("linked agent worktree");
    for (const result of [disabled, failed, unsafe]) expect(result.stdout).not.toContain("AGENT_CWD");
  });
});
