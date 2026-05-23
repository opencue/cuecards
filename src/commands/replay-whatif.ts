/**
 * `cue replay --what-if <profile>` — simulate a past session with a different profile.
 * Shows which tool calls would have been available/missing.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

import { loadProfile } from "../lib/profile-loader";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS_ROOT = join(REPO_ROOT, "resources", "skills", "skills");

export async function run(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(`cue replay — replay a session with a different profile

Usage:
  cue replay --what-if <profile>   Simulate last session with a different profile
  cue replay --what-if <profile> --session <path>   Specific session file

Shows which skills/tools would have been available or missing.
`);
    return 0;
  }

  const whatIfIdx = args.indexOf("--what-if");
  const targetProfile = whatIfIdx >= 0 ? args[whatIfIdx + 1] : null;
  const sessionIdx = args.indexOf("--session");
  const sessionPath = sessionIdx >= 0 ? args[sessionIdx + 1] : null;

  if (!targetProfile) {
    process.stderr.write("Usage: cue replay --what-if <profile>\n");
    return 1;
  }

  // Load target profile
  let profile;
  try { profile = await loadProfile(targetProfile); } catch (e) {
    process.stderr.write(`Cannot load profile "${targetProfile}": ${e}\n`);
    return 1;
  }

  const profileSkills = new Set(profile.skills.local.map(s => s.id));
  const profileMcps = new Set(profile.mcps.map(m => m.id));

  // Find session to replay
  let sessFile = sessionPath;
  if (!sessFile) {
    const projectsDir = join(homedir(), ".claude", "projects");
    if (!existsSync(projectsDir)) {
      process.stderr.write("No session files found in ~/.claude/projects/\n");
      return 1;
    }
    // Find most recent session (limit scan)
    let latest = { path: "", mtime: 0 };
    const allDirs = readdirSync(projectsDir);
    for (const dir of allDirs.slice(-20)) { // only last 20 project dirs
      const fullDir = join(projectsDir, dir);
      try {
        if (!statSync(fullDir).isDirectory()) continue;
        const files = readdirSync(fullDir).filter(f => f.endsWith(".jsonl"));
        for (const f of files.slice(-3)) { // only last 3 per dir
          const p = join(fullDir, f);
          const mt = statSync(p).mtimeMs;
          if (mt > latest.mtime) latest = { path: p, mtime: mt };
        }
      } catch {}
    }
    sessFile = latest.path;
  }

  if (!sessFile || !existsSync(sessFile)) {
    process.stderr.write("No session file found.\n");
    return 1;
  }

  // Parse session for skill/tool references
  const content = readFileSync(sessFile, "utf8");
  const lines = content.split("\n").filter(Boolean);

  const skillRefs = new Set<string>();
  const toolCalls = new Set<string>();

  for (const line of lines) {
    try {
      const msg = JSON.parse(line);
      // Skill references
      const text = JSON.stringify(msg);
      const refs = text.match(/skills\/([a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)?)\/SKILL\.md/g);
      if (refs) for (const r of refs) skillRefs.add(r.replace("skills/", "").replace("/SKILL.md", ""));

      // Tool calls
      if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
        for (const block of msg.message.content) {
          if (block.type === "tool_use") toolCalls.add(block.name);
        }
      }
    } catch {}
  }

  // Analyze
  const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
  const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
  const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

  const available = [...skillRefs].filter(s => profileSkills.has(s));
  const missing = [...skillRefs].filter(s => !profileSkills.has(s));

  process.stdout.write(`\n  🔄 What-if: replaying with ${bold(targetProfile)}\n\n`);
  process.stdout.write(`  Session: ${dim(sessFile.split("/").slice(-2).join("/"))}\n`);
  process.stdout.write(`  Skills referenced: ${skillRefs.size}  Tools called: ${toolCalls.size}\n\n`);

  if (available.length > 0) {
    process.stdout.write(`  ${green("✓")} Available in ${targetProfile} (${available.length}):\n`);
    for (const s of available.slice(0, 5)) process.stdout.write(`    ✓ ${s}\n`);
    if (available.length > 5) process.stdout.write(`    ${dim(`+${available.length - 5} more`)}\n`);
  }

  if (missing.length > 0) {
    process.stdout.write(`\n  ${red("✗")} Missing from ${targetProfile} (${missing.length}):\n`);
    for (const s of missing.slice(0, 5)) process.stdout.write(`    ✗ ${s}\n`);
    if (missing.length > 5) process.stdout.write(`    ${dim(`+${missing.length - 5} more`)}\n`);
  }

  const coverage = skillRefs.size > 0 ? Math.round((available.length / skillRefs.size) * 100) : 100;
  process.stdout.write(`\n  Coverage: ${coverage}% of referenced skills available in ${targetProfile}\n`);

  if (coverage === 100) {
    process.stdout.write(`  ${green("✓")} This profile would have worked perfectly for this session.\n`);
  } else if (coverage >= 80) {
    process.stdout.write(`  ${dim("Most skills covered. Minor gaps.")} \n`);
  } else {
    process.stdout.write(`  ${red("⚠")} Significant skill gaps — this profile may not be suitable.\n`);
  }

  process.stdout.write("\n");
  return 0;
}
