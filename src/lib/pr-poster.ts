/**
 * Fork → branch → push → PR create flow, wrapped around the `gh` CLI.
 *
 * Every step is idempotent and bails cleanly on the first error. The flow is
 * driven by `postPrToRepo()`; tests can substitute the `runner` to avoid
 * hitting GitHub.
 *
 * The flow itself:
 *   1. fork the upstream repo into the user's account (idempotent — gh
 *      reports the existing fork if already present)
 *   2. clone the fork into a tmpdir under the user's home
 *   3. apply the linter's auto-fixes to each SKILL.md path
 *   4. commit on a deterministic branch name
 *   5. push the branch
 *   6. open a PR against upstream:default-branch
 *   7. delete the tmpdir, leave the fork in place (cleaned later by cleanup-forks)
 *
 * Caller is responsible for preflight (throttle/opt-out checks) and for
 * recording the result via pr-throttle's `recordOpened`.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

/**
 * Build a deterministic branch name keyed by today's date + a hash of the
 * fix set. Same inputs produce the same branch (idempotent on re-runs the
 * same day); changes in the fix set produce a new branch instead of silently
 * force-pushing over the previous one.
 *
 * Format: cue/skill-md-fixes-YYYY-MM-DD-<8 hex>
 */
export function deriveBranchName(upstream: string, changes: Array<{ path: string; after: string }>): string {
  const today = new Date().toISOString().slice(0, 10);
  const fingerprint = createHash("sha256")
    .update(upstream + "\n")
    .update(changes.map((c) => `${c.path}\n${c.after}`).join("\n---\n"))
    .digest("hex")
    .slice(0, 8);
  return `cue/skill-md-fixes-${today}-${fingerprint}`;
}

export interface Runner {
  /** Run a command, capture stdout+stderr+status. Throws nothing — always resolves. */
  run(cmd: string, args: string[], opts?: { cwd?: string; timeoutMs?: number; input?: string }): Promise<{ stdout: string; stderr: string; status: number }>;
}

export const defaultRunner: Runner = {
  run(cmd, args, opts = {}) {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      let settled = false;
      const finish = (status: number) => { if (!settled) { settled = true; resolve({ stdout, stderr, status }); } };
      child.stdout.on("data", (c) => { stdout += c.toString(); });
      child.stderr.on("data", (c) => { stderr += c.toString(); });
      child.on("close", (code) => finish(code ?? 1));
      child.on("error", (e) => { stderr += `[spawn error] ${e.message}\n`; finish(127); });
      if (opts.input !== undefined) { child.stdin.write(opts.input); child.stdin.end(); }
      else child.stdin.end();
      const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} finish(124); }, opts.timeoutMs ?? 60000);
      child.on("close", () => clearTimeout(t));
    });
  },
};

// ---------------------------------------------------------------------------
// Discrete steps
// ---------------------------------------------------------------------------

export async function whoami(runner: Runner): Promise<string | null> {
  const res = await runner.run("gh", ["api", "user", "--jq", ".login"], { timeoutMs: 10000 });
  if (res.status !== 0) return null;
  return res.stdout.trim() || null;
}

export async function forkRepo(runner: Runner, upstream: string): Promise<{ fork: string; existed: boolean } | { error: string }> {
  const user = await whoami(runner);
  if (!user) return { error: "could not determine gh user — run `gh auth login`" };
  const fork = `${user}/${upstream.split("/")[1]}`;
  // gh repo fork is idempotent — if the fork exists it just reports "already exists"
  const res = await runner.run("gh", ["repo", "fork", upstream, "--clone=false", "--remote=false"], { timeoutMs: 60000 });
  const existed = /already exists/i.test(res.stderr);
  if (res.status !== 0 && !existed) {
    return { error: `gh repo fork failed: ${res.stderr.trim() || res.stdout.trim() || "exit " + res.status}` };
  }
  return { fork, existed };
}

export async function cloneFork(runner: Runner, fork: string, tmpRoot: string): Promise<{ dir: string } | { error: string }> {
  const dir = mkdtempSync(join(tmpRoot, "cue-pr-"));
  const res = await runner.run("gh", ["repo", "clone", fork, dir, "--", "--depth=1"], { timeoutMs: 120000 });
  if (res.status !== 0) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    return { error: `gh repo clone failed: ${res.stderr.trim() || "exit " + res.status}` };
  }
  return { dir };
}

export async function syncForkWithUpstream(runner: Runner, fork: string): Promise<boolean> {
  // Keeps fork up to date so the branch we create is based on latest upstream.
  // Failure is non-fatal — the PR may still be valid against an older base.
  const res = await runner.run("gh", ["repo", "sync", fork], { timeoutMs: 30000 });
  return res.status === 0;
}

export interface FileChange { path: string; before: string; after: string; }

/** Apply fixes to the cloned fork's working tree. Returns paths that actually changed. */
export function writeFilesToWorktree(dir: string, changes: FileChange[]): string[] {
  const written: string[] = [];
  const root = resolve(dir);
  for (const c of changes) {
    const full = resolve(dir, c.path);
    // Refuse paths that escape the worktree (e.g. "../../.bashrc"): resolve
    // normalizes "..", so a traversal lands outside `root` and is skipped.
    if (full !== root && !full.startsWith(root + sep)) continue;
    if (!existsSync(full)) continue;
    const current = readFileSync(full, "utf8");
    if (current === c.after) continue;
    writeFileSync(full, c.after);
    written.push(c.path);
  }
  return written;
}

export async function commitAndPush(
  runner: Runner,
  dir: string,
  branch: string,
  message: string,
): Promise<{ ok: true } | { error: string }> {
  // Use a checkout-or-create flow so re-runs against an existing branch keep working.
  const cb = await runner.run("git", ["checkout", "-B", branch], { cwd: dir });
  if (cb.status !== 0) return { error: `git checkout -B failed: ${cb.stderr.trim()}` };

  const add = await runner.run("git", ["add", "-A"], { cwd: dir });
  if (add.status !== 0) return { error: `git add failed: ${add.stderr.trim()}` };

  // -c flags here run the commit without requiring user.{name,email} to be set
  // — useful in CI/sandbox environments.
  const commit = await runner.run("git", [
    "-c", "user.email=cue-bot@users.noreply.github.com",
    "-c", "user.name=cue-bot",
    "commit", "-m", message,
  ], { cwd: dir });
  // "nothing to commit" is OK if the fork already has identical content
  if (commit.status !== 0 && !/nothing to commit/i.test(commit.stdout + commit.stderr)) {
    return { error: `git commit failed: ${commit.stderr.trim() || commit.stdout.trim()}` };
  }

  const push = await runner.run("git", ["push", "-u", "origin", branch, "--force-with-lease"], { cwd: dir, timeoutMs: 60000 });
  if (push.status !== 0) return { error: `git push failed: ${push.stderr.trim()}` };
  return { ok: true };
}

export interface OpenPrResult { number: number; url: string; }

export async function openPr(
  runner: Runner,
  upstream: string,
  fork: string,
  branch: string,
  title: string,
  body: string,
): Promise<OpenPrResult | { error: string }> {
  const forkOwner = fork.split("/")[0];
  // gh pr create against upstream with our fork's branch
  const res = await runner.run("gh", [
    "pr", "create",
    "--repo", upstream,
    "--head", `${forkOwner}:${branch}`,
    "--title", title,
    "--body", body,
  ], { timeoutMs: 60000 });

  if (res.status !== 0) {
    // If a PR already exists for this branch, gh tells us — surface that as success.
    const existingMatch = res.stderr.match(/already exists:?\s+(https:\/\/github\.com\/\S+\/pull\/(\d+))/i);
    if (existingMatch) return { number: parseInt(existingMatch[2]!, 10), url: existingMatch[1]! };
    return { error: `gh pr create failed: ${res.stderr.trim() || "exit " + res.status}` };
  }
  // Successful create — stdout is the PR URL
  const url = res.stdout.trim().split("\n").pop() ?? "";
  const num = url.match(/\/pull\/(\d+)/)?.[1];
  return { number: num ? parseInt(num, 10) : 0, url };
}

// ---------------------------------------------------------------------------
// Top-level driver
// ---------------------------------------------------------------------------

export interface PostPrInput {
  upstream: string;          // owner/name to PR against
  changes: FileChange[];     // SKILL.md files we touched
  prTitle: string;
  prBody: string;
  branch?: string;           // defaults to cue/skill-md-fixes
  runner?: Runner;
  keepTmp?: boolean;         // skip cleanup of the cloned fork dir (for debugging)
}

export interface PostPrSuccess {
  ok: true;
  prNumber: number;
  prUrl: string;
  fork: string;
  branch: string;
  filesChanged: string[];
}

export interface PostPrFailure {
  ok: false;
  step: "whoami" | "fork" | "clone" | "apply" | "commit" | "push" | "pr-create";
  error: string;
  fork?: string;
}

export async function postPrToRepo(input: PostPrInput): Promise<PostPrSuccess | PostPrFailure> {
  const runner = input.runner ?? defaultRunner;
  const branch = input.branch ?? deriveBranchName(input.upstream, input.changes);

  const fork = await forkRepo(runner, input.upstream);
  if ("error" in fork) return { ok: false, step: "fork", error: fork.error };

  // Best-effort sync; don't fail the run on sync failure.
  await syncForkWithUpstream(runner, fork.fork);

  const cloned = await cloneFork(runner, fork.fork, tmpdir());
  if ("error" in cloned) return { ok: false, step: "clone", error: cloned.error, fork: fork.fork };

  try {
    const filesChanged = writeFilesToWorktree(cloned.dir, input.changes);
    if (filesChanged.length === 0) {
      return { ok: false, step: "apply", error: "no files changed after writing fixes (worktree already had identical content)", fork: fork.fork };
    }

    const commitRes = await commitAndPush(runner, cloned.dir, branch, input.prTitle);
    if ("error" in commitRes) return { ok: false, step: "push", error: commitRes.error, fork: fork.fork };

    const pr = await openPr(runner, input.upstream, fork.fork, branch, input.prTitle, input.prBody);
    if ("error" in pr) return { ok: false, step: "pr-create", error: pr.error, fork: fork.fork };

    return { ok: true, prNumber: pr.number, prUrl: pr.url, fork: fork.fork, branch, filesChanged };
  } finally {
    if (!input.keepTmp) {
      try { rmSync(cloned.dir, { recursive: true, force: true }); } catch {}
    }
  }
}

// ---------------------------------------------------------------------------
// PR state polling — used by cleanup-forks to find merged/closed PRs
// ---------------------------------------------------------------------------

export async function fetchPrState(
  runner: Runner,
  upstream: string,
  prNumber: number,
): Promise<"open" | "merged" | "closed" | "unknown"> {
  const res = await runner.run("gh", ["pr", "view", String(prNumber), "--repo", upstream, "--json", "state,merged", "--jq", "{state, merged}"], { timeoutMs: 10000 });
  if (res.status !== 0) return "unknown";
  try {
    const { state, merged } = JSON.parse(res.stdout) as { state: string; merged: boolean };
    if (merged) return "merged";
    if (state === "CLOSED") return "closed";
    if (state === "OPEN") return "open";
  } catch {}
  return "unknown";
}

export async function deleteFork(runner: Runner, fork: string): Promise<{ ok: true } | { error: string }> {
  const res = await runner.run("gh", ["repo", "delete", fork, "--yes"], { timeoutMs: 30000 });
  if (res.status !== 0) return { error: `gh repo delete failed: ${res.stderr.trim() || "exit " + res.status}` };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Opt-out check — fetches the repo's README and looks for the marker
// ---------------------------------------------------------------------------

export async function checkOptOutMarker(runner: Runner, repo: string, marker: string): Promise<boolean | null> {
  const res = await runner.run("gh", ["api", `repos/${repo}/readme`, "-H", "Accept: application/vnd.github.raw"], { timeoutMs: 10000 });
  if (res.status !== 0) return null; // unknown — fail open (don't post in caller if uncertain)
  return res.stdout.toLowerCase().includes(marker.toLowerCase());
}
