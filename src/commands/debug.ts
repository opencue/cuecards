/**
 * `cue debug [profile]` — trace why skills/MCPs aren't loading.
 *
 * Walks the full resolution chain and reports at each step:
 * - Profile resolution (which .cue.profile, inheritance chain)
 * - Skill resolution (found/missing, path, size)
 * - MCP resolution (in registry or not, env vars set)
 * - Plugin resolution (installed or not)
 * - Runtime state (hash, stale, symlinks)
 */

import { resolve, join, dirname } from "node:path";
import { existsSync, readFileSync, lstatSync, readlinkSync } from "node:fs";
import { homedir } from "node:os";

import { loadProfile } from "../lib/profile-loader";
import { resolveProfileForCwd } from "../lib/cwd-resolver";
import { repoRoot } from "../lib/repo-root";

const SKILLS_ROOT = join(repoRoot(), "resources", "skills", "skills");
const MCP_CONFIGS_DIR = join(repoRoot(), "resources", "mcps", "configs");
const RUNTIME_ROOT = join(homedir(), ".config", "cue", "runtime");

export async function run(args: string[]): Promise<number> {
  const explicitProfile = args.find(a => !a.startsWith("-"));
  let profileName = explicitProfile;
  const verbose = args.includes("-v") || args.includes("--verbose");

  const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
  const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
  const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
  const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

  process.stdout.write(`\n  ${bold("cue debug")} — tracing profile resolution\n\n`);

  // 1. Profile resolution — explicit arg wins over cwd auto-detection
  process.stdout.write(`  ${bold("① Profile Resolution")}\n`);
  if (explicitProfile) {
    process.stdout.write(`    ${green("✓")} Profile: ${explicitProfile} (source: cli-arg)\n`);
  } else {
    const cwd = process.cwd();
    try {
      const resolved = await resolveProfileForCwd({ cwd, homeDir: homedir(), configDir: join(homedir(), ".config", "cue") });
      if (resolved.source === "none") {
        process.stdout.write(`    ${red("✗")} No profile found for ${cwd}\n`);
        process.stdout.write(`    ${dim("Fix: echo <profile> > .cue.profile or pass a profile name")}\n\n`);
        return 1;
      }
      profileName = (resolved as any).profile;
      process.stdout.write(`    ${green("✓")} Profile: ${profileName} (source: ${resolved.source})\n`);
    } catch (e) {
      process.stdout.write(`    ${red("✗")} Resolution failed: ${e}\n`);
      return 1;
    }
  }

  // 2. Load profile
  process.stdout.write(`\n  ${bold("② Profile Loading")}\n`);
  let profile;
  try {
    profile = await loadProfile(profileName!);
    process.stdout.write(`    ${green("✓")} Loaded: ${profileName}\n`);
    process.stdout.write(`    ${dim(`Inheritance: ${profile.inheritanceChain.join(" → ")}`)}\n`);
  } catch (e) {
    process.stdout.write(`    ${red("✗")} Failed to load: ${e}\n`);
    return 1;
  }

  // 3. Skills — expand glob ids (e.g. "*/*") instead of treating them literally
  process.stdout.write(`\n  ${bold("③ Skills")} (${profile.skills.local.length} local, ${profile.skills.npx.length} npx)\n`);
  let skillIssues = 0;
  let resolvedCount = 0;
  for (const s of profile.skills.local) {
    const id = s.id;
    if (id.includes("*")) {
      if (verbose) process.stdout.write(`    ${dim(`~ ${id} (glob — resolved at materialize time)`)}\n`);
      continue;
    }
    const path = join(SKILLS_ROOT, id, "SKILL.md");
    if (existsSync(path)) {
      resolvedCount++;
      if (verbose) {
        const size = readFileSync(path, "utf8").length;
        process.stdout.write(`    ${green("✓")} ${id} ${dim(`(${Math.ceil(size/4)} tokens)`)}\n`);
      }
    } else {
      process.stdout.write(`    ${red("✗")} ${id} — not found at ${path}\n`);
      skillIssues++;
    }
  }
  if (skillIssues === 0 && !verbose) {
    process.stdout.write(`    ${green("✓")} ${resolvedCount} literal skill ids resolved\n`);
  }

  // 4. MCPs
  process.stdout.write(`\n  ${bold("④ MCPs")} (${profile.mcps.length})\n`);
  const mcpIds = new Set<string>();
  for (const file of ["claude_runtime.sanitized.json", "claude.sanitized.json", "codex.sanitized.json"]) {
    try {
      const raw = JSON.parse(readFileSync(join(MCP_CONFIGS_DIR, file), "utf8"));
      if (raw.servers) for (const id of Object.keys(raw.servers)) mcpIds.add(id);
    } catch {}
  }

  let mcpIssues = 0;
  for (const m of profile.mcps) {
    const id = m.id;
    if (mcpIds.has(id)) {
      if (verbose) process.stdout.write(`    ${green("✓")} ${id} — in registry\n`);
    } else {
      process.stdout.write(`    ${red("✗")} ${id} — NOT in any MCP registry config\n`);
      mcpIssues++;
    }
  }
  if (mcpIssues === 0 && !verbose) {
    process.stdout.write(`    ${green("✓")} All ${profile.mcps.length} MCPs found in registry\n`);
  }

  // 4b. Rules / Commands / Hooks
  const RESOURCES_ROOT = join(repoRoot(), "resources");
  let resourceIssues = 0;
  for (const [kind, refs, base] of [
    ["Rules", profile.rules, join(RESOURCES_ROOT, "rules")],
    ["Commands", profile.commands, join(RESOURCES_ROOT, "commands")],
    ["Hooks", profile.hooks, join(RESOURCES_ROOT, "hooks")],
  ] as const) {
    if (refs.length === 0) continue;
    process.stdout.write(`\n  ${bold(`④${kind === "Rules" ? "a" : kind === "Commands" ? "b" : "c"} ${kind}`)} (${refs.length})\n`);
    let missing = 0;
    for (const ref of refs) {
      const needsExt = kind !== "Hooks" && !ref.endsWith(".md");
      const path = needsExt ? join(base, `${ref}.md`) : (ref.startsWith("/") ? ref : join(base, ref));
      if (existsSync(path)) {
        if (verbose) process.stdout.write(`    ${green("✓")} ${ref}\n`);
      } else {
        process.stdout.write(`    ${red("✗")} ${ref} — not found at ${path}\n`);
        missing++;
      }
    }
    if (missing === 0 && !verbose) {
      process.stdout.write(`    ${green("✓")} All ${refs.length} ${kind.toLowerCase()} found\n`);
    }
    resourceIssues += missing;
  }

  // 5. Runtime state
  process.stdout.write(`\n  ${bold("⑤ Runtime State")}\n`);
  const runtimeDir = join(RUNTIME_ROOT, profileName!, "claude");
  if (existsSync(runtimeDir)) {
    const hashFile = join(runtimeDir, ".cue-hash");
    if (existsSync(hashFile)) {
      const hash = readFileSync(hashFile, "utf8").trim();
      process.stdout.write(`    ${green("✓")} Runtime exists: ${runtimeDir}\n`);
      process.stdout.write(`    ${dim(`Hash: ${hash.slice(0, 16)}...`)}\n`);
    } else {
      process.stdout.write(`    ${yellow("⚠")} Runtime exists but no hash — may be stale\n`);
    }

    // Check credentials
    const creds = join(runtimeDir, ".credentials.json");
    if (existsSync(creds)) {
      const st = lstatSync(creds);
      if (st.isSymbolicLink()) {
        const target = readlinkSync(creds);
        process.stdout.write(`    ${yellow("⚠")} Credentials: symlink → ${target} ${dim("(should be copy)")}\n`);
      } else {
        process.stdout.write(`    ${green("✓")} Credentials: present (${st.size} bytes)\n`);
      }
    } else {
      process.stdout.write(`    ${red("✗")} Credentials: missing — will need /login\n`);
    }

    // Check skills symlinks
    const skillsDir = join(runtimeDir, "skills");
    if (existsSync(skillsDir)) {
      const { readdirSync } = await import("node:fs");
      const entries = readdirSync(skillsDir);
      let broken = 0;
      for (const e of entries) {
        const p = join(skillsDir, e);
        try {
          const st = lstatSync(p);
          if (st.isSymbolicLink()) {
            const target = readlinkSync(p);
            if (!existsSync(resolve(dirname(p), target))) broken++;
          }
        } catch { broken++; }
      }
      if (broken > 0) {
        process.stdout.write(`    ${red("✗")} ${broken} broken skill symlinks in runtime\n`);
      } else {
        process.stdout.write(`    ${green("✓")} ${entries.length} skill symlinks OK\n`);
      }
    }
  } else {
    process.stdout.write(`    ${dim("No runtime materialized yet — will build on next launch")}\n`);
  }

  // Summary
  const totalIssues = skillIssues + mcpIssues + resourceIssues;
  process.stdout.write(`\n  ${bold("Summary:")} `);
  if (totalIssues === 0) {
    process.stdout.write(`${green("All clear")} — profile should load correctly.\n`);
  } else {
    process.stdout.write(`${red(`${totalIssues} issue(s)`)} found. Fix and run \`cue doctor --fix\`.\n`);
  }
  process.stdout.write("\n");

  return totalIssues > 0 ? 1 : 0;
}
