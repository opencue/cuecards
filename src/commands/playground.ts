/**
 * `cue playground <skill-id>` — try a skill in an isolated temp environment.
 *
 * Creates a temp runtime with core + the specified skill, launches claude,
 * and cleans up on exit.
 */

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, } from "node:path";
import { execSync, spawn } from "node:child_process";
import { tmpdir } from "node:os";

import { loadProfile } from "../lib/profile-loader";
import { repoRoot } from "../lib/repo-root";

const SKILLS_ROOT = join(repoRoot(), "resources", "skills", "skills");

export async function run(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help") || !args[0] || args[0].startsWith("-")) {
    process.stdout.write(`cue playground — try a skill in isolation

Usage:
  cue playground <skill-id> [--profile base]

Options:
  --profile <name>  Base profile to extend (default: core)

Example:
  cue playground review/code-review
  cue playground meta/rtk-context-trim --profile backend
`);
    return args.includes("-h") || args.includes("--help") ? 0 : 1;
  }

  const skillId = args[0]!;
  const profileIdx = args.indexOf("--profile");
  const baseProfile = profileIdx >= 0 ? args[profileIdx + 1] ?? "core" : "core";

  // Verify skill exists
  const skillPath = join(SKILLS_ROOT, skillId, "SKILL.md");
  if (!existsSync(skillPath)) {
    process.stderr.write(`Skill "${skillId}" not found at ${skillPath}\n`);
    return 1;
  }

  // Create temp dir
  const tmpDir = mkdtempSync(join(tmpdir(), "cue-playground-"));
  const claudeDir = join(tmpDir, "claude");
  mkdirSync(claudeDir, { recursive: true });

  // Build minimal CLAUDE.md
  const { readFileSync } = await import("node:fs");
  let claudeMd = `# Playground: ${skillId}\n\nBase profile: ${baseProfile}\n\n`;

  // Load base profile skills
  try {
    const profile = await loadProfile(baseProfile);
    for (const s of profile.skills.local) {
      const sp = join(SKILLS_ROOT, s.id, "SKILL.md");
      try {
        claudeMd += readFileSync(sp, "utf8") + "\n\n---\n\n";
      } catch {}
    }
  } catch {}

  // Append the playground skill
  claudeMd += readFileSync(skillPath, "utf8");

  writeFileSync(join(claudeDir, "CLAUDE.md"), claudeMd);
  writeFileSync(join(claudeDir, "settings.json"), JSON.stringify({ permissions: {} }, null, 2));
  writeFileSync(join(tmpDir, ".cue-hash"), "playground");

  process.stdout.write(`🎮 Playground: ${skillId} (base: ${baseProfile})\n`);
  process.stdout.write(`   Runtime: ${claudeDir}\n`);
  process.stdout.write(`   Press Ctrl+C to exit and clean up.\n\n`);

  // Launch claude with the temp config dir
  const claudeBin = findClaude();
  if (!claudeBin) {
    process.stderr.write("Cannot find 'claude' binary. Is Claude Code installed?\n");
    cleanup(tmpDir);
    return 1;
  }

  const child = spawn(claudeBin, [], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir },
    stdio: "inherit",
  });

  // Cleanup on exit
  const cleanupAndExit = () => { cleanup(tmpDir); process.exit(0); };
  process.on("SIGINT", cleanupAndExit);
  process.on("SIGTERM", cleanupAndExit);

  return new Promise<number>((resolve) => {
    child.on("close", (code) => {
      cleanup(tmpDir);
      resolve(code ?? 0);
    });
  });
}

function findClaude(): string | null {
  try {
    return execSync("which claude", { encoding: "utf8" }).trim() || null;
  } catch {
    // Check common paths
    const paths = ["/usr/local/bin/claude", join(process.env.HOME ?? "", ".local/bin/claude")];
    for (const p of paths) if (existsSync(p)) return p;
    return null;
  }
}

function cleanup(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}
