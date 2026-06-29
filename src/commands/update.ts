/**
 * `cue update` — self-update + skill sync.
 */

import { spawnSync } from "node:child_process";
import { existsSync, } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../lib/repo-root";


interface UpdateResult {
  repo: string;
  updated: boolean;
  changes: string;
}

function gitPull(dir: string): UpdateResult {
  const name = dir === repoRoot() ? "cue" : dir.split("/").pop()!;

  if (!existsSync(join(dir, ".git"))) {
    return { repo: name, updated: false, changes: "not a git repo" };
  }

  // Check for changes
  const fetchRes = spawnSync("git", ["fetch", "--quiet"], { cwd: dir, encoding: "utf8", timeout: 15000 });
  if (fetchRes.status !== 0) {
    return { repo: name, updated: false, changes: `fetch failed: ${fetchRes.stderr}` };
  }

  const diffRes = spawnSync("git", ["log", "HEAD..@{u}", "--oneline"], { cwd: dir, encoding: "utf8" });
  const pending = diffRes.stdout.trim();

  if (!pending) {
    return { repo: name, updated: false, changes: "already up to date" };
  }

  const pullRes = spawnSync("git", ["pull", "--ff-only"], { cwd: dir, encoding: "utf8", timeout: 30000 });
  if (pullRes.status !== 0) {
    return { repo: name, updated: false, changes: `pull failed: ${pullRes.stderr}` };
  }

  const commitCount = pending.split("\n").length;
  return { repo: name, updated: true, changes: `${commitCount} new commit(s)` };
}

export async function run(args: string[]): Promise<number> {
  const check = args.includes("--check");
  const skillsOnly = args.includes("--skills");
  const json = args.includes("--json");

  const repos: string[] = [];

  if (!skillsOnly) repos.push(repoRoot());
  repos.push(join(repoRoot(), "resources", "skills"));
  repos.push(join(repoRoot(), "resources", "mcps"));

  if (check) {
    // Just show what would change
    process.stdout.write("Checking for updates...\n\n");
    for (const dir of repos) {
      if (!existsSync(join(dir, ".git"))) continue;
      const name = dir === repoRoot() ? "cue" : dir.split("/").pop()!;
      const res = spawnSync("git", ["log", "HEAD..@{u}", "--oneline"], { cwd: dir, encoding: "utf8" });
      spawnSync("git", ["fetch", "--quiet"], { cwd: dir, encoding: "utf8", timeout: 15000 });
      const pending = res.stdout.trim();
      if (pending) {
        process.stdout.write(`  📦 ${name}: ${pending.split("\n").length} pending commit(s)\n`);
        for (const line of pending.split("\n").slice(0, 5)) {
          process.stdout.write(`       ${line}\n`);
        }
      } else {
        process.stdout.write(`  ✅ ${name}: up to date\n`);
      }
    }
    return 0;
  }

  process.stdout.write("Updating cue...\n\n");
  const results: UpdateResult[] = [];

  for (const dir of repos) {
    const result = gitPull(dir);
    results.push(result);
    if (!json) {
      const icon = result.updated ? "📦" : "✅";
      process.stdout.write(`  ${icon} ${result.repo}: ${result.changes}\n`);
    }
  }

  // Run bun install if package.json changed
  if (!skillsOnly && results[0]?.updated) {
    process.stdout.write("\n  Running bun install...\n");
    const bunRes = spawnSync("bun", ["install"], { cwd: repoRoot(), encoding: "utf8", timeout: 30000 });
    if (bunRes.status === 0) {
      process.stdout.write("  ✅ Dependencies updated\n");
    } else {
      process.stdout.write(`  ⚠️  bun install failed: ${bunRes.stderr}\n`);
    }
  }

  if (json) {
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
  } else {
    const updated = results.filter(r => r.updated).length;
    process.stdout.write(`\n${updated > 0 ? `✅ ${updated} repo(s) updated.` : "Already up to date."}\n`);
    if (updated > 0) {
      process.stdout.write("Run `/cue-reload` in active sessions to pick up changes.\n");
    }
  }

  return 0;
}
