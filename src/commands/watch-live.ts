/**
 * `cue watch-live [--profile <name>]` — file watcher for auto-rematerialization.
 *
 * Monitors profile.yaml, referenced SKILL.md files, and .cue.profile in cwd.
 * On change: re-runs materialization with 500ms debounce.
 */

import { watch, existsSync, } from "node:fs";
import { join } from "node:path";

import { loadProfile } from "../lib/profile-loader";
import { resolveActiveProfile } from "../lib/cwd-resolver";
import { repoRoot } from "../lib/repo-root";

const PROFILES_DIR = process.env.CUE_PROFILES_DIR ?? join(repoRoot(), "profiles");
const SKILLS_ROOT = join(repoRoot(), "resources", "skills", "skills");

export async function run(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(`cue watch-live — auto-rematerialize on profile/skill changes

Usage: cue watch-live [--profile <name>]

Monitors:
  • Active profile's profile.yaml
  • All SKILL.md files referenced by the profile
  • .cue.profile in cwd

On any change, re-runs materialization (500ms debounce).
Press Ctrl+C to stop.
`);
    return 0;
  }

  const profileIdx = args.indexOf("--profile");
  let profileName = profileIdx >= 0 ? args[profileIdx + 1] : undefined;

  if (!profileName) {
    try {
      profileName = await resolveActiveProfile() ?? undefined;
    } catch { /* fallback below */ }
  }

  if (!profileName) {
    process.stderr.write("No active profile. Use --profile <name> or set .cue.profile.\n");
    return 1;
  }

  let profile;
  try {
    profile = await loadProfile(profileName);
  } catch (e: any) {
    process.stderr.write(`Failed to load profile "${profileName}": ${e.message}\n`);
    return 1;
  }

  // Collect paths to watch
  const watchPaths: string[] = [];

  // 1. Profile YAML
  const profileYaml = join(PROFILES_DIR, profileName, "profile.yaml");
  if (existsSync(profileYaml)) watchPaths.push(profileYaml);

  // 2. Skill directories (SKILL.md files)
  for (const skill of profile.skills.local) {
    const skillMd = join(SKILLS_ROOT, skill.id, "SKILL.md");
    if (existsSync(skillMd)) watchPaths.push(skillMd);
  }

  // 3. .cue.profile in cwd
  const cueProfile = join(process.cwd(), ".cue.profile");
  if (existsSync(cueProfile)) watchPaths.push(cueProfile);

  if (watchPaths.length === 0) {
    process.stderr.write("No files to watch.\n");
    return 1;
  }

  process.stdout.write(`[watch] Watching ${watchPaths.length} file(s) for profile "${profileName}"...\n`);
  process.stdout.write(`[watch] Press Ctrl+C to stop.\n\n`);

  // Debounce timer
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const rematerialize = async (changedPath: string) => {
    const rel = changedPath.replace(repoRoot() + "/", "");
    process.stdout.write(`[watch] Detected change in ${rel} → rematerializing...\n`);
    try {
      const { materializeRuntime } = await import("../lib/runtime-materializer");
      const { resolveLocalSkill } = await import("../lib/resolver-local");
      const freshProfile = await loadProfile(profileName!);
      const { homedir } = await import("node:os");
      const runtimeRoot = join(
        process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
        "cue", "runtime", profileName!,
      );
      await materializeRuntime({
        profile: freshProfile,
        agent: "claude-code",
        runtimeRoot,
        skillSourceLookup: async (id) => {
          return await resolveLocalSkill(id);
        },
        mcpRegistry: {},
        userClaudeMd: "",
      });
      process.stdout.write(`[watch] ✅ Rematerialized "${profileName}".\n`);
    } catch (e: any) {
      process.stderr.write(`[watch] ❌ Rematerialization failed: ${e.message}\n`);
    }
  };

  const onChange = (changedPath: string) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => rematerialize(changedPath), 500);
  };

  // Set up watchers
  const watchers: ReturnType<typeof watch>[] = [];
  for (const p of watchPaths) {
    try {
      const w = watch(p, () => onChange(p));
      watchers.push(w);
    } catch { /* skip unreadable */ }
  }

  // Keep alive until Ctrl+C
  return new Promise<number>((resolvePromise) => {
    process.on("SIGINT", () => {
      process.stdout.write("\n[watch] Stopped.\n");
      for (const w of watchers) w.close();
      if (debounceTimer) clearTimeout(debounceTimer);
      resolvePromise(0);
    });
  });
}
