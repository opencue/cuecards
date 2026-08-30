/**
 * `cue submit-profile <path>` — fork opencue/cuecards, branch, commit the profile,
 * open a PR. Lowers contribution friction for community profiles.
 *
 * Workflow:
 *   1. Validate the input profile.yaml via the existing linter (no E-errors)
 *   2. `gh repo fork opencue/cuecards --clone` into a tmp dir (or use existing fork)
 *   3. Copy profile.yaml into profiles/<name>/ on a new branch
 *   4. Commit + push + `gh pr create`
 *
 * Safety: dry-run by default. The user must pass --yes to actually push + PR.
 */

import { existsSync, mkdtempSync, mkdirSync, copyFileSync, readFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { parse as parseYaml } from "yaml";

import { lintProfile, type ProfileLintResult } from "../lib/profile-linter";

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

const UPSTREAM_REPO = "opencue/cuecards";

interface ProfileMeta {
  name: string;
  description: string;
  icon?: string;
  inherits?: string;
}

function readProfileMeta(path: string): ProfileMeta {
  const content = readFileSync(path, "utf8");
  const parsed = parseYaml(content);
  if (!parsed || typeof parsed !== "object") throw new Error(`${path} is not valid YAML`);
  const { name, description, icon, inherits } = parsed as ProfileMeta;
  if (!name) throw new Error(`profile.yaml missing required field: name`);
  if (!description) throw new Error(`profile.yaml missing required field: description`);
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(name)) throw new Error(`profile name "${name}" must be kebab-case ([a-z][a-z0-9-]{1,63})`);
  return { name, description, icon, inherits };
}

function run(cmd: string, args: string[], opts: { cwd?: string; inherit?: boolean } = {}): { ok: boolean; out: string; err: string } {
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd,
    encoding: "utf8",
    stdio: opts.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    timeout: 60000,
  });
  return {
    ok: res.status === 0,
    out: res.stdout?.trim() ?? "",
    err: res.stderr?.trim() ?? "",
  };
}

function hasGh(): boolean {
  return run("gh", ["--version"]).ok;
}

function ghUser(): string | null {
  const r = run("gh", ["api", "user", "--jq", ".login"]);
  return r.ok ? r.out : null;
}

function printLintReport(result: ProfileLintResult): boolean {
  let hasErrors = false;
  for (const issue of result.issues) {
    if (issue.severity === "error") hasErrors = true;
    const icon = issue.severity === "error" ? red("✗") : yellow("⚠");
    process.stdout.write(`  ${icon} ${issue.rule}: ${issue.message}\n`);
  }
  return !hasErrors;
}

export async function runCmd(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help") || args.length === 0) {
    process.stdout.write(`cue submit-profile — open a PR adding a profile to ${UPSTREAM_REPO}

Usage:
  cue submit-profile <path/to/profile.yaml> [--yes] [--dry-run] [--branch <name>]

Flow:
  1. Validate the profile (schema + linter)
  2. Fork ${UPSTREAM_REPO} (or use existing fork)
  3. Branch, copy profile.yaml to profiles/<name>/profile.yaml
  4. Commit, push, open PR via gh

Defaults to --dry-run. Pass --yes to actually fork + push + PR.

Examples:
  cue submit-profile ./my-profile/profile.yaml
  cue submit-profile ./my-profile/profile.yaml --yes
  cue submit-profile ./my-profile/profile.yaml --yes --branch add-data-engineering-profile
`);
    return 0;
  }

  const path = args.find(a => !a.startsWith("-"));
  if (!path) {
    process.stderr.write("Usage: cue submit-profile <path/to/profile.yaml>\n");
    return 1;
  }
  if (!existsSync(path)) {
    process.stderr.write(`File not found: ${path}\n`);
    return 1;
  }
  const dryRun = !args.includes("--yes");
  const branchIdx = args.indexOf("--branch");
  const branchOverride = branchIdx >= 0 ? args[branchIdx + 1] : undefined;

  // ── 1. Parse + validate ───────────────────────────────────────────────
  let meta: ProfileMeta;
  try {
    meta = readProfileMeta(path);
  } catch (e) {
    process.stderr.write(red(`✗ Schema error: `) + (e as Error).message + "\n");
    return 1;
  }
  process.stdout.write(`\n  ${bold("Profile:")} ${meta.name}  ${dim(meta.description)}\n`);

  // ── 2. Run the linter (requires the file to be in profiles/<name>/) ───
  // We stage to a tmp profiles dir + lint there so the resolver finds it.
  const stagingRoot = mkdtempSync(join(tmpdir(), "cue-submit-"));
  const profilesDir = join(stagingRoot, "profiles", meta.name);
  mkdirSync(profilesDir, { recursive: true });
  copyFileSync(resolve(path), join(profilesDir, "profile.yaml"));
  process.stdout.write(`  ${dim("Staged to:")} ${profilesDir}\n`);

  process.stdout.write(`\n  ${bold("Lint report:")}\n`);
  const lintResult = await lintProfile(meta.name, { profilesDir: join(stagingRoot, "profiles") } as any).catch((e: Error) => {
    process.stderr.write(red(`✗ Lint failed: `) + e.message + "\n");
    return null;
  });
  if (!lintResult) return 1;

  const lintOk = printLintReport(lintResult);
  if (!lintOk) {
    process.stderr.write(`\n  ${red("✗ Fix the E-errors above before submitting.")}\n\n`);
    return 1;
  }
  process.stdout.write(`  ${green("✓ Lint passed")}\n`);

  // ── 3. gh fork + branch + commit + PR ────────────────────────────────
  if (!hasGh()) {
    process.stderr.write(red("✗ gh CLI not found. Install: https://cli.github.com/\n"));
    return 1;
  }
  const user = ghUser();
  if (!user) {
    process.stderr.write(red("✗ Not authenticated. Run: gh auth login\n"));
    return 1;
  }
  process.stdout.write(`  ${dim("gh user:")} ${user}\n`);

  const branch = branchOverride ?? `add-profile-${meta.name}`;
  const prTitle = `Add ${meta.icon ? meta.icon + " " : ""}${meta.name} profile`;
  const prBody = `## What

Adds a new \`${meta.name}\` profile to cue.

**Description**: ${meta.description}
${meta.inherits ? `**Inherits**: \`${meta.inherits}\`\n` : ""}

## Why

[Briefly explain the use case — what kind of project benefits from this profile, and what's missing in the existing profiles that prompted you to create it.]

## Validation

\`\`\`
cue validate ${meta.name}
\`\`\`

- ✅ Schema valid
- ✅ All skill / MCP / rule / command references resolve
- ✅ No W1-W5 hard warnings

## Submitted via

\`cue submit-profile\` — happy to iterate on the profile based on review feedback.

---

<sub>Opened with [\`cue submit-profile\`](https://github.com/opencue/cuecards/blob/main/src/commands/submit-profile.ts).</sub>`;

  if (dryRun) {
    process.stdout.write(`\n  ${bold("─── DRY RUN ───")}\n`);
    process.stdout.write(`  ${dim("Would:")}\n`);
    process.stdout.write(`    1. ${green("gh repo fork " + UPSTREAM_REPO + " --clone")} (if needed)\n`);
    process.stdout.write(`    2. ${green(`git checkout -b ${branch}`)}\n`);
    process.stdout.write(`    3. ${green(`cp ${path} profiles/${meta.name}/profile.yaml`)}\n`);
    process.stdout.write(`    4. ${green(`git commit -m "feat: add ${meta.name} profile"`)}\n`);
    process.stdout.write(`    5. ${green(`git push -u origin ${branch}`)}\n`);
    process.stdout.write(`    6. ${green("gh pr create")}\n`);
    process.stdout.write(`\n  ${bold("PR Title:")} ${prTitle}\n`);
    process.stdout.write(`\n  ${bold("PR Body preview:")}\n${prBody.split("\n").map(l => "    " + l).join("\n")}\n`);
    process.stdout.write(`\n  ${dim("(dry-run — pass --yes to execute)")}\n\n`);
    return 0;
  }

  // ── Real execution path ──────────────────────────────────────────────
  const forkDir = join(homedir(), ".cache", "cue", "submit-fork");
  mkdirSync(join(homedir(), ".cache", "cue"), { recursive: true });

  if (!existsSync(join(forkDir, ".git"))) {
    process.stdout.write(`\n  ${bold("Forking")} ${UPSTREAM_REPO}...\n`);
    const fork = run("gh", ["repo", "fork", UPSTREAM_REPO, "--clone", forkDir, "--remote=true"], { inherit: true });
    if (!fork.ok) {
      process.stderr.write(red("✗ Fork failed\n"));
      return 1;
    }
  } else {
    process.stdout.write(`  ${dim(`Reusing existing fork at ${forkDir}`)}\n`);
    run("git", ["fetch", "upstream", "main"], { cwd: forkDir });
    run("git", ["checkout", "main"], { cwd: forkDir });
    run("git", ["reset", "--hard", "upstream/main"], { cwd: forkDir });
  }

  process.stdout.write(`  ${bold("Creating branch:")} ${branch}\n`);
  run("git", ["checkout", "-b", branch], { cwd: forkDir });
  const destDir = join(forkDir, "profiles", meta.name);
  mkdirSync(destDir, { recursive: true });
  copyFileSync(resolve(path), join(destDir, "profile.yaml"));

  run("git", ["add", "profiles/" + meta.name + "/profile.yaml"], { cwd: forkDir });
  const commit = run("git", ["commit", "-m", `feat: add ${meta.name} profile`], { cwd: forkDir });
  if (!commit.ok) {
    process.stderr.write(red("✗ Commit failed: ") + commit.err + "\n");
    return 1;
  }

  process.stdout.write(`  ${bold("Pushing branch...")}\n`);
  const push = run("git", ["push", "-u", "origin", branch], { cwd: forkDir, inherit: true });
  if (!push.ok) {
    process.stderr.write(red("✗ Push failed\n"));
    return 1;
  }

  process.stdout.write(`  ${bold("Opening PR...")}\n`);
  const pr = run("gh", [
    "pr", "create",
    "--repo", UPSTREAM_REPO,
    "--title", prTitle,
    "--body", prBody,
    "--head", `${user}:${branch}`,
  ], { cwd: forkDir });
  if (!pr.ok) {
    process.stderr.write(red("✗ PR creation failed: ") + pr.err + "\n");
    return 1;
  }
  process.stdout.write(`\n  ${green("✓ PR opened:")} ${pr.out}\n\n`);
  return 0;
}

export { runCmd as run };
