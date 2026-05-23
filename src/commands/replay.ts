/**
 * `cue replay <session-id|latest> --profile <name>` — capability diff replay.
 */

import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import { loadProfile } from "../lib/profile-loader";
import { resolveProfileForCwd } from "../lib/cwd-resolver";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");

function findSession(id: string): string | null {
  if (!existsSync(PROJECTS_DIR)) return null;

  if (id === "latest") {
    let latest: { path: string; mtime: number } | null = null;
    for (const project of readdirSync(PROJECTS_DIR)) {
      const sessDir = join(PROJECTS_DIR, project, "sessions");
      if (!existsSync(sessDir)) continue;
      for (const sess of readdirSync(sessDir)) {
        const sessPath = join(sessDir, sess);
        try {
          for (const f of readdirSync(sessPath)) {
            if (!f.endsWith(".jsonl")) continue;
            const full = join(sessPath, f);
            const mtime = statSync(full).mtimeMs;
            if (!latest || mtime > latest.mtime) latest = { path: full, mtime };
          }
        } catch { /* skip */ }
      }
    }
    return latest?.path ?? null;
  }

  // Search by session ID substring
  for (const project of readdirSync(PROJECTS_DIR)) {
    const sessDir = join(PROJECTS_DIR, project, "sessions");
    if (!existsSync(sessDir)) continue;
    for (const sess of readdirSync(sessDir)) {
      if (sess.includes(id)) {
        const sessPath = join(sessDir, sess);
        const files = readdirSync(sessPath).filter(f => f.endsWith(".jsonl"));
        if (files.length) return join(sessPath, files[0]!);
      }
    }
  }
  return null;
}

export async function run(args: string[]): Promise<number> {
  // Route --what-if to the dedicated what-if module
  if (args.includes("--what-if")) {
    const { run: runWhatIf } = await import("./replay-whatif");
    return runWhatIf(args);
  }

  const json = args.includes("--json");
  const profileIdx = args.indexOf("--profile");
  const targetProfile = profileIdx >= 0 ? args[profileIdx + 1] : null;
  const sessionId = args.find(a => !a.startsWith("-") && a !== args[profileIdx! + 1]);

  if (!sessionId || !targetProfile) {
    process.stderr.write("Usage: cue replay <session-id|latest> --profile <name>\n");
    return 1;
  }

  const sessionFile = findSession(sessionId);
  if (!sessionFile) {
    process.stderr.write(`Session "${sessionId}" not found.\n`);
    return 1;
  }

  // Get original profile
  let originalProfile: string;
  try { originalProfile = await resolveProfileForCwd(process.cwd()); } catch { originalProfile = "unknown"; }

  // Load both profiles
  const target = await loadProfile(targetProfile);
  let original;
  try { original = await loadProfile(originalProfile); } catch { original = null; }

  const targetSkills = new Set(target.skills.local.map(s => s.id));
  const originalSkills = original ? new Set(original.skills.local.map(s => s.id)) : new Set<string>();

  const gained = [...targetSkills].filter(s => !originalSkills.has(s));
  const lost = [...originalSkills].filter(s => !targetSkills.has(s));

  // Scan session for skill references
  const content = readFileSync(sessionFile, "utf8");
  const usedSkills = new Set<string>();
  for (const id of [...targetSkills, ...originalSkills]) {
    const slug = id.split("/").pop()!;
    if (content.toLowerCase().includes(slug.toLowerCase())) {
      usedSkills.add(id);
    }
  }

  const wouldHaveHelped = gained.filter(s => {
    const slug = s.split("/").pop()!;
    return content.toLowerCase().includes(slug.toLowerCase());
  });

  const result = {
    session: sessionFile,
    original_profile: originalProfile,
    target_profile: targetProfile,
    skills_gained: gained,
    skills_lost: lost,
    skills_that_would_have_helped: wouldHaveHelped,
  };

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }

  process.stdout.write(`Replay: "${sessionId}" with profile "${targetProfile}" (was: "${originalProfile}")\n\n`);
  process.stdout.write(`Skills gained (+${gained.length}):\n`);
  for (const s of gained) {
    const helpful = wouldHaveHelped.includes(s) ? " ← would have been triggered!" : "";
    process.stdout.write(`  + ${s}${helpful}\n`);
  }
  process.stdout.write(`\nSkills lost (-${lost.length}):\n`);
  for (const s of lost) {
    const wasUsed = usedSkills.has(s) ? " ⚠️  was used in this session!" : "";
    process.stdout.write(`  - ${s}${wasUsed}\n`);
  }
  if (wouldHaveHelped.length) {
    process.stdout.write(`\n💡 ${wouldHaveHelped.length} skill(s) in "${targetProfile}" would have been relevant to this session.\n`);
  }
  return 0;
}
