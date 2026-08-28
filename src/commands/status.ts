/**
 * `cue status` — single-glance overview of the current cue state.
 *
 * Combines: active profile, usage stats, and doctor warnings.
 */

import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { existsSync, readFileSync, readdirSync, } from "node:fs";
import { fileURLToPath } from "node:url";

import { configDir } from "../lib/config-paths";
import { resolveProfileForCwd } from "../lib/cwd-resolver";
import { loadProfile, listProfiles } from "../lib/profile-loader";
import { computeStats } from "../lib/analytics";
import { readGateStatus, type GateRun } from "../lib/gate-status";
import { countProfileSkills } from "../lib/profile-capabilities";

const REPO_ROOT = process.env.CUE_REPO_ROOT ?? process.env.SOUL_REPO_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS_ROOT = join(REPO_ROOT, "resources", "skills", "skills");
const MCP_CONFIGS_DIR = join(REPO_ROOT, "resources", "mcps", "configs");
const RUNTIME_ROOT = join(process.env.HOME ?? homedir(), ".config", "cue", "runtime");


export interface Warning {
  code: string;
  message: string;
}

export function quickDiagnose(profileName: string, profile: any): Warning[] {
  const warnings: Warning[] = [];

  // Check skills exist on disk
  for (const s of profile.skills.local) {
    const id = s.id ?? s;
    if (typeof id === "string" && id.includes("*")) continue; // skip wildcards
    // Try direct path first (category/slug format)
    if (existsSync(join(SKILLS_ROOT, id, "SKILL.md"))) continue;
    // Try to find the skill in any category (bare slug)
    let found = false;
    try {
      const cats = readdirSync(SKILLS_ROOT, { withFileTypes: true });
      for (const cat of cats) {
        if (!cat.isDirectory()) continue;
        if (existsSync(join(SKILLS_ROOT, cat.name, id, "SKILL.md"))) { found = true; break; }
      }
    } catch { /* skip */ }
    // Also check plugin marketplace paths (for npx-promoted skills).
    if (!found) {
      const mpDir = join(homedir(), ".claude", "plugins", "marketplaces");
      if (existsSync(mpDir)) {
        try {
          for (const mp of readdirSync(mpDir, { withFileTypes: true })) {
            if (!mp.isDirectory()) continue;
            if (existsSync(join(mpDir, mp.name, "skills", id, "SKILL.md"))) { found = true; break; }
          }
        } catch { /* skip */ }
      }
    }
    if (!found) {
      warnings.push({ code: "D1", message: `skill "${id}" not found on disk` });
    }
  }

  // Check MCPs exist in registry
  const mcpIds = new Set<string>();
  for (const file of ["claude.sanitized.json", "claude_runtime.sanitized.json", "codex.sanitized.json"]) {
    try {
      const raw = JSON.parse(readFileSync(join(MCP_CONFIGS_DIR, file), "utf8"));
      if (raw.servers) for (const id of Object.keys(raw.servers)) mcpIds.add(id);
    } catch { /* skip */ }
  }
  for (const m of profile.mcps) {
    const id = m.id ?? m;
    if (!mcpIds.has(id)) {
      warnings.push({ code: "D2", message: `MCP "${id}" not in registry` });
    }
  }

  // D4: Skill → MCP dependency check
  try {
    const { detectMissingDependencies } = require("../lib/skill-dependencies");
    const skillIds = profile.skills.local.map((s: any) => s.id ?? s);
    const profileMcpIds = profile.mcps.map((m: any) => m.id ?? m);
    const missing = detectMissingDependencies(profileName, skillIds, profileMcpIds);
    for (const m of missing) {
      // Implicit deps are regex-scanned from skill prose, so a server name
      // mentioned only as an example (e.g. `mcp__conductor__AskUserQuestion`)
      // would false-positive. Only warn when the server is a real, wirable MCP
      // in the registry — otherwise there's nothing to add. Explicit
      // `requires_mcps:` deps are always surfaced.
      if (m.source === "implicit" && !mcpIds.has(m.mcpId)) continue;
      warnings.push({ code: "D4", message: `skill "${m.skillId}" needs MCP "${m.mcpId}" (${m.source})` });
    }
  } catch { /* non-fatal */ }

  // Check runtime staleness. The materializer writes `.cue-hash` into the
  // per-agent runtime dir (runtime/<profile>/{claude,codex}/.cue-hash), not
  // the profile root — so check both. Only warn when no hash exists anywhere.
  const runtimeDir = join(RUNTIME_ROOT, profileName);
  if (existsSync(runtimeDir)) {
    const hashCandidates = [
      join(runtimeDir, ".cue-hash"),
      join(runtimeDir, "claude", ".cue-hash"),
      join(runtimeDir, "codex", ".cue-hash"),
    ];
    if (!hashCandidates.some((p) => existsSync(p))) {
      warnings.push({ code: "D5", message: "runtime missing hash (may be stale)" });
    }
  }

  return warnings;
}

export async function run(args: string[]): Promise<number> {
  const json = args.includes("--json");

  // 1. Active profile
  const resolved = await resolveProfileForCwd({
    cwd: process.cwd(),
    homeDir: homedir(),
    configDir: configDir(),
  });

  const hasProfile = resolved.source !== "none";
  let profile: any = null;
  let warnings: Warning[] = [];

  if (hasProfile) {
    try {
      profile = await loadProfile(resolved.profile);
      warnings = quickDiagnose(resolved.profile, profile);
    } catch (e) {
      warnings.push({ code: "D0", message: `cannot load profile: ${e}` });
    }
  }

  // 2. Stats
  const stats = computeStats();
  const totalSessions = stats.reduce((a, s) => a + s.sessions, 0);

  // 3. Profiles count
  const allProfiles = await listProfiles();

  // 4. Most recent Stop-hook gate run for this profile. Null when no run has
  //    been recorded yet (fresh install, telemetry off, or gates not declared).
  const gateRun: GateRun | null = hasProfile ? readGateStatus(resolved.profile) : null;

  if (json) {
    const out = {
      profile: hasProfile ? resolved.profile : null,
      source: resolved.source,
      skills: profile ? countProfileSkills(profile) : 0,
      mcps: profile ? profile.mcps.length : 0,
      plugins: profile ? profile.plugins.length : 0,
      subagents: profile ? (profile.subagents?.length ?? 0) : 0,
      totalProfiles: allProfiles.length,
      totalSessions,
      warnings,
      gates: gateRun
        ? {
            ts: gateRun.ts,
            overall: gateRun.overall,
            failed: gateRun.results.filter((r) => !r.ok).map((r) => r.name),
          }
        : null,
    };
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    return 0;
  }

  // Human output
  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
  const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
  const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
  const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
  const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

  // First-run detection
  const isFirstRun = !existsSync(RUNTIME_ROOT) && !hasProfile && totalSessions === 0;
  if (isFirstRun) {
    process.stdout.write("\n");
    process.stdout.write(`  ${bold("Welcome to cue!")} Agent Profile Manager for Claude Code & Codex\n\n`);
    process.stdout.write(`  Get started:\n`);
    process.stdout.write(`    ${bold("cue init")}           Set up a profile for this project\n`);
    process.stdout.write(`    ${bold("cue list")}           See all available profiles\n`);
    process.stdout.write(`    ${bold("cue shell install")}  Install shims so \`claude\` uses cue\n`);
    process.stdout.write(`\n  ${dim("Run cue --help for all commands.")}\n\n`);
    return 0;
  }

  process.stdout.write("\n");

  // Profile section
  if (hasProfile) {
    process.stdout.write(`  ${bold("Profile")}  ${green(resolved.profile)} ${dim(`(${resolved.source})`)}\n`);
    if (profile) {
      const skillCount = countProfileSkills(profile);
      const subagentCount = profile.subagents?.length ?? 0;
      const subagentPart = subagentCount > 0 ? `    ${bold("Subagents")} ${subagentCount}` : "";
      process.stdout.write(`  ${bold("Skills")}   ${skillCount}    ${bold("MCPs")} ${profile.mcps.length}    ${bold("Plugins")} ${profile.plugins.length}${subagentPart}\n`);
    }
  } else {
    process.stdout.write(`  ${bold("Profile")}  ${dim("none pinned for this directory")}\n`);
    process.stdout.write(`  ${dim("→ Run")} ${bold("cue init")} ${dim("to set up a profile for this project")}\n`);
  }

  process.stdout.write("\n");

  // Stats section
  process.stdout.write(`  ${bold("Profiles")} ${allProfiles.length}    ${bold("Sessions")} ${totalSessions}\n`);
  if (stats.length > 0) {
    const top = stats.slice(0, 3);
    const topStr = top.map(s => `${s.profile}(${s.sessions})`).join(", ");
    process.stdout.write(`  ${bold("Top")}      ${topStr}\n`);
  }

  // Quality gates section (only when a run has been recorded for the active
  // profile — otherwise stay silent so the status output doesn't grow noisy
  // for profiles that don't declare any gates).
  if (gateRun) {
    process.stdout.write("\n");
    const when = gateRun.ts.slice(0, 16).replace("T", " ") + "Z";
    if (gateRun.overall === "pass") {
      process.stdout.write(
        `  ${green("✓")} ${bold("Gates")}   ${gateRun.results.length} passed ${dim(`(${when})`)}\n`,
      );
    } else if (gateRun.overall === "fail") {
      const failed = gateRun.results.filter((r) => !r.ok);
      process.stdout.write(
        `  ${red("✗")} ${bold("Gates")}   ${failed.length}/${gateRun.results.length} failed ${dim(`(${when})`)}\n`,
      );
      for (const r of failed.slice(0, 3)) {
        process.stdout.write(`    ${red("✗")} ${r.name} ${dim(`(exit ${r.exit})`)}\n`);
      }
      if (failed.length > 3) {
        process.stdout.write(`    ${dim(`…and ${failed.length - 3} more (cue gates status)`)}\n`);
      }
    } else {
      // overall === "skip" — no gates ran (none declared, or runtime dir absent).
      process.stdout.write(`  ${dim("·")} ${bold("Gates")}   none declared ${dim(`(${when})`)}\n`);
    }
  }

  // Warnings section
  if (warnings.length > 0) {
    process.stdout.write("\n");
    process.stdout.write(`  ${yellow("⚠")} ${bold("Warnings")} (${warnings.length})\n`);
    for (const w of warnings.slice(0, 5)) {
      process.stdout.write(`    ${yellow(w.code)} ${w.message}\n`);
    }
    if (warnings.length > 5) {
      process.stdout.write(`    ${dim(`…and ${warnings.length - 5} more (run cue doctor for details)`)}\n`);
    }
  } else if (hasProfile) {
    process.stdout.write(`\n  ${green("✓")} ${dim("no issues detected")}\n`);
  }

  process.stdout.write(`\n  ${dim("Run cue --help for all commands.")}\n\n`);
  return 0;
}
