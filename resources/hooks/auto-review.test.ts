import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// End-to-end test of the auto-review Stop hook's loop logic. The reviewer
// itself is stubbed via CUE_AUTO_REVIEW_CMD, so no real `claude` is spawned —
// we exercise the gate / diff-detection / block / clean / loop-guard paths.

const SCRIPT = join(import.meta.dir, "auto-review.sh");

let home: string;
let repo: string;

function git(args: string[], cwd: string) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

function runHook(opts: { env?: Record<string, string>; cwd?: string; stopActive?: boolean } = {}) {
  const payload = JSON.stringify({
    transcript_path: "",
    cwd: opts.cwd ?? repo,
    stop_hook_active: opts.stopActive ?? false,
  });
  const r = spawnSync("bash", [SCRIPT], {
    input: payload,
    encoding: "utf8",
    env: { ...process.env, HOME: home, ...(opts.env ?? {}) },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status };
}

async function enableFlag() {
  await mkdir(join(home, ".config", "cue"), { recursive: true });
  await writeFile(join(home, ".config", "cue", "auto-review-enabled"), "");
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "cue-ar-home-"));
  repo = await mkdtemp(join(tmpdir(), "cue-ar-repo-"));
  git(["init", "-q"], repo);
  git(["config", "user.email", "t@t.test"], repo);
  git(["config", "user.name", "t"], repo);
  await writeFile(join(repo, "f.js"), "version one\n");
  git(["add", "."], repo);
  git(["commit", "-qm", "base"], repo);
  // Create an uncommitted change → a diff vs HEAD exists.
  await writeFile(join(repo, "f.js"), "version two has a bug\n");
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(repo, { recursive: true, force: true });
});

describe("auto-review Stop hook", () => {
  test("no-op when the opt-in flag is absent (even with a diff)", async () => {
    const out = runHook({ env: { CUE_AUTO_REVIEW_CMD: "printf 'CRITICAL: x\\n'" } });
    expect(out.code).toBe(0);
    expect(out.stdout.trim()).toBe("");
  });

  test("recursion guard: no-op when CUE_AUTO_REVIEW_INNER=1", async () => {
    await enableFlag();
    const out = runHook({ env: { CUE_AUTO_REVIEW_INNER: "1", CUE_AUTO_REVIEW_CMD: "printf 'CRITICAL: x\\n'" } });
    expect(out.code).toBe(0);
    expect(out.stdout.trim()).toBe("");
  });

  test("blocks (decision:block) and feeds findings back on CRITICAL/HIGH", async () => {
    await enableFlag();
    const out = runHook({ env: { CUE_AUTO_REVIEW_CMD: "printf 'CRITICAL: null deref in f.js\\n'" } });
    expect(out.code).toBe(0);
    const decision = JSON.parse(out.stdout);
    expect(decision.decision).toBe("block");
    expect(decision.reason).toContain("CRITICAL: null deref in f.js");
    expect(decision.reason).toContain("VERIFY");
  });

  test("does NOT block when the reviewer returns REVIEW_CLEAN", async () => {
    await enableFlag();
    const out = runHook({ env: { CUE_AUTO_REVIEW_CMD: "printf 'REVIEW_CLEAN\\n'" } });
    expect(out.code).toBe(0);
    expect(out.stdout.trim()).toBe("");
  });

  test("loop guard: same unchanged diff is not re-blocked on the next Stop", async () => {
    await enableFlag();
    const stub = { CUE_AUTO_REVIEW_CMD: "printf 'HIGH: broken contract\\n'" };
    const first = runHook({ env: stub });
    expect(JSON.parse(first.stdout).decision).toBe("block"); // round 1 blocks
    const second = runHook({ env: stub, stopActive: true }); // agent didn't change the diff
    expect(second.code).toBe(0);
    expect(second.stdout.trim()).toBe(""); // no infinite loop
  });

  test("no-op when there is nothing to review (clean tree)", async () => {
    await enableFlag();
    git(["checkout", "--", "f.js"], repo); // revert the uncommitted change
    const out = runHook({ env: { CUE_AUTO_REVIEW_CMD: "printf 'CRITICAL: x\\n'" } });
    expect(out.code).toBe(0);
    expect(out.stdout.trim()).toBe("");
  });
});
