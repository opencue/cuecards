/**
 * `cue init` — project scanner + profile wizard.
 *
 * Two phases run end-to-end:
 *   1. **Global onboarding** (first-run only, or `--re-onboard`): picks a
 *      default-profile composite, opts into local analytics, and marks
 *      `.onboarded` so subsequent `cue init` calls skip straight to phase 2.
 *   2. **Per-directory pinning** (always): scan cwd, suggest the best
 *      profile, write `.cue.profile`, offer to install discovered gems.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as p from "@clack/prompts";

import { detectProfileV2 } from "../lib/auto-detect";
import { scanProject } from "../lib/project-scanner";
import { listProfiles } from "../lib/profile-loader";
import { getCachedGemsForProfile, autoInstallClis } from "./discover";
import { shimInstalled, runInstall } from "./shell";
import { shimDir } from "../lib/shim-dir";
import { gateFreshSkill } from "./security";
import {
  configDir,
  enable as enableTelemetry,
  isEnabled as telemetryEnabled,
  analyticsPath,
} from "../lib/telemetry-consent";

/**
 * Marker file: presence means the user has been through global onboarding
 * at least once. Stored next to `default-profile` and `analytics.jsonl`
 * under the same XDG config dir for parity.
 */
/**
 * Marker file shared with `cue launch` so the wizard fires on the FIRST
 * launch of cue, not only when the user explicitly runs `cue init`.
 * Exported for that integration.
 */
export function onboardedMarkerPath(): string {
  return join(configDir(), ".onboarded");
}

function defaultProfilePath(): string {
  return join(configDir(), "default-profile");
}

/**
 * First-run setup: default-profile composition + analytics opt-in. Returns
 * `false` when the user cancels mid-wizard so the caller can short-circuit.
 *
 * Writes:
 *   - `<configDir>/default-profile` (when a composite was chosen)
 *   - `<configDir>/.telemetry-consent` (when user opts in)
 *   - `<configDir>/.onboarded` (marker — written by the caller post-success)
 */
export async function runGlobalOnboarding(): Promise<boolean> {
  p.log.info(
    "👋 Welcome to cue. Quick 30-second setup before we pin a profile to this directory.",
  );

  // Step 1: default-profile composite.
  const defaultPick = await p.select<string>({
    message: "Default profile — loads when no .cue.profile is pinned to a directory:",
    options: [
      {
        value: "core",
        label: "core only",
        hint: "recommended - smallest default context",
      },
      {
        value: "core+skill-writer",
        label: "core + skill-writer",
        hint: "optional - add skill management when needed",
      },
      { value: "__custom", label: "Custom…", hint: "type a +-separated composite" },
      { value: "__skip", label: "Skip for now", hint: "falls back to plain `core`" },
    ],
    initialValue: "core",
  });
  if (p.isCancel(defaultPick)) return false;

  let defaultComposite: string | null = null;
  if (defaultPick === "__custom") {
    const custom = await p.text({
      message: "Composite (e.g., core+skill-writer+backend):",
      placeholder: "core",
      validate: (v) => {
        const parts = (v ?? "").split("+").map((s) => s.trim()).filter((s) => s.length > 0);
        if (parts.length === 0) return "Must contain at least one profile name";
        for (const part of parts) {
          if (!/^[a-z][a-z0-9-]{1,63}$/.test(part)) {
            return `"${part}" must be kebab-case (lowercase, hyphens)`;
          }
        }
        return undefined;
      },
    });
    if (p.isCancel(custom)) return false;
    defaultComposite = (custom as string).trim();
  } else if (defaultPick !== "__skip") {
    defaultComposite = defaultPick as string;
  }

  if (defaultComposite) {
    const path = defaultProfilePath();
    mkdirSync(dirname(path), { recursive: true });
    // File format: one profile name per line, `core` always implied.
    const parts = defaultComposite
      .split("+")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== "core");
    writeFileSync(path, ["core", ...parts].join("\n") + "\n");
    p.log.success(`Default profile: ${["core", ...parts].join(" + ")}`);
  } else {
    p.log.message("Default profile left at `core`. Change anytime with `cue use --set-default`.");
  }

  // Step 2: local analytics opt-in. Skipped when already enabled.
  // Default is YES — every active cue feature (skill-report, prune,
  // pair-suggestions, CLAUDE.md compaction that just cut your medusa
  // profile by 76%) reads from this log. Nothing leaves the machine.
  if (!telemetryEnabled()) {
    p.log.info(
      "📊 Local analytics powers cue's best features:\n" +
      "    • Recent profile picker (sorted by what you actually use)\n" +
      "    • cue skill-report — flags dead skills wasting tokens\n" +
      "    • cue prune --dead — removes them\n" +
      "    • CLAUDE.md compaction (saves ~40-76% per profile)\n" +
      "    • cue suggest-pairs — \"you usually pair X with Y\"\n" +
      "  Stored ONLY on this machine. Never uploaded. Disable anytime: cue telemetry disable",
    );
    const optIn = await p.confirm({
      message: "Enable local analytics? (recommended)",
      initialValue: true,
    });
    if (p.isCancel(optIn)) return false;
    if (optIn) {
      const result = enableTelemetry();
      const wiped = result.wipedLegacyBytes > 0
        ? ` (wiped ${result.wipedLegacyBytes}B of pre-consent legacy data)`
        : "";
      p.log.success(`Analytics enabled${wiped}. Log: ${analyticsPath()}`);
    } else {
      p.log.message("Skipped — opt in later with `cue telemetry enable`.");
    }
  }

  return true;
}

async function offerDiscoverGems(profile: string): Promise<void> {
  const gems = getCachedGemsForProfile(profile, 8).slice(0, 3);
  if (!gems.length) return;

  p.log.info(`💎 Top gems for "${profile}":`);
  for (const g of gems) {
    p.log.message(`  ${g.full_name} (★${g.stars}, score ${g.gem_score}) — ${(g.description ?? "").slice(0, 60)}`);
  }

  const install = await p.confirm({ message: "Install these gems?" });
  if (p.isCancel(install) || !install) return;

  let flagged = 0;
  for (const g of gems) {
    p.log.step(`Installing ${g.full_name}...`);
    const res = spawnSync("npx", ["skills", "add", g.full_name, "-a", "claude-code", "-y"], {
      encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"],
    });
    // A failed fetch (network/registry error, timeout) must not be treated as a
    // successful install — skip the gate + registration for a gem that isn't there.
    if (res.error || res.status !== 0) {
      p.log.warn(`Could not install ${g.full_name} — skipping.`);
      continue;
    }
    // Security gate: flag a just-fetched skill with critical findings and skip
    // its CLI auto-install (the gem is installed to ~/.claude/skills, but the
    // wizard does not auto-register it to a profile).
    const gate = gateFreshSkill(g.name);
    if (!gate.ok) {
      flagged++;
      p.log.error(`${g.full_name}: ${gate.critical.length} critical security finding(s) — review before use.`);
      for (const c of gate.critical) p.log.message(`  [${c.code}] ${c.message}`);
      continue;
    }
    if (!gate.scanned) {
      p.log.warn(`${g.full_name}: no SKILL.md found to scan — review manually.`);
    }
    autoInstallClis(g.name);
  }
  p.log.success(`Installed ${gems.length} gem(s) to ~/.claude/skills${flagged > 0 ? ` (${flagged} flagged by the security scan — review before use)` : ""}.`);
}

/**
 * Print the token budget for the freshly pinned profile against the `full`
 * baseline, right before `ensureShim()` asks to intercept the user's `claude`
 * command. The whole pitch is "your agent loads less" — this is the only point
 * in the flow where that is demonstrable with the user's own numbers, and it
 * has to land before the biggest permission ask, not after.
 *
 * Never throws: a broken cost run must not abort an install whose profile is
 * already pinned.
 */
export async function showCostProof(
  profile: string,
  deps: { costRun?: (args: string[]) => Promise<number> } = {},
): Promise<void> {
  p.log.info(`Token budget for "${profile}" vs loading everything:`);
  try {
    const costRun = deps.costRun ?? (await import("./cost")).run;
    await costRun([profile, "--compare"]);
  } catch {
    p.log.warn("Couldn't measure the token budget — skipping the comparison.");
  }
}

/**
 * Offer to install the shell shims if they're missing. Without the shim,
 * typing `claude` runs vanilla Claude Code and the pinned profile is never
 * loaded — the #1 "I followed the docs and nothing happened" failure. Detect
 * it here and offer the one-time fix.
 */
async function ensureShim(): Promise<void> {
  if (shimInstalled()) return;
  const dir = shimDir();
  p.log.warn(
    "The `claude`/`codex` shim isn't installed yet — without it, launching `claude` runs vanilla Claude Code and won't load this profile.",
  );
  const install = await p.confirm({
    message: `Install the shell shim now? (writes ${dir}/claude)`,
  });
  if (p.isCancel(install) || !install) {
    p.log.message("Skipped — run `cue shell install` later to activate profile loading.");
    return;
  }
  try {
    // runInstall() prints its own PATH guidance, including the exact rc line
    // when the shim dir isn't on PATH yet.
    const code = await runInstall();
    if (code === 0) {
      p.log.success(`Shim installed to ${dir}.`);
    } else {
      p.log.warn("Shim install reported an issue — run `cue shell install` manually for details.");
    }
  } catch {
    p.log.warn("Couldn't install the shim automatically — run `cue shell install` manually.");
  }
}

export async function run(args: string[]): Promise<number> {
  const cwd = process.cwd();
  const reOnboard = args.includes("--re-onboard");
  const skipOnboarding = args.includes("--no-onboarding");

  p.intro("🎯 cue init — set up profile for this project");

  // Global onboarding (first run only, or explicit --re-onboard).
  const marker = onboardedMarkerPath();
  if (!skipOnboarding && (!existsSync(marker) || reOnboard)) {
    const ok = await runGlobalOnboarding();
    if (!ok) {
      p.cancel("Onboarding cancelled. Run `cue init` again anytime.");
      return 130;
    }
    try {
      mkdirSync(configDir(), { recursive: true });
      writeFileSync(marker, new Date().toISOString() + "\n");
    } catch { /* non-fatal — worst case we re-prompt next time */ }
    p.log.message(""); // visual break before per-cwd section
  }

  // Scan
  const project = scanProject(cwd);
  const detected: string[] = [...project.languages, ...project.frameworks, ...project.tools];

  if (detected.length) {
    p.log.info(`Detected: ${detected.join(", ")}`);
  } else {
    p.log.info("No strong project signals detected.");
  }

  // Score
  const suggestions = detectProfileV2(cwd);
  const allProfiles = await listProfiles();

  // Present options
  const options: { value: string; label: string; hint?: string }[] = [];

  for (let i = 0; i < Math.min(suggestions.length, 3); i++) {
    const s = suggestions[i]!;
    options.push({
      value: s.profile,
      label: s.profile,
      hint: `${Math.round(s.confidence * 100)}% match — ${s.reasons.join(", ")}`,
    });
  }

  // Add remaining profiles not in suggestions
  const suggestedNames = new Set(suggestions.map(s => s.profile));
  for (const name of allProfiles) {
    if (suggestedNames.has(name)) continue;
    if (name.startsWith("_")) continue;
    options.push({ value: name, label: name });
  }

  options.push({ value: "__new", label: "Create a new profile", hint: "interactive wizard" });
  options.push({ value: "__skip", label: "Skip — don't pin a profile" });

  const choice = await p.select({
    message: "Which profile for this directory?",
    options,
  });

  if (p.isCancel(choice)) {
    p.cancel("Cancelled.");
    return 130;
  }

  if (choice === "__skip") {
    p.outro("No profile pinned. Run `cue init` again anytime.");
    return 0;
  }

  if (choice === "__new") {
    const name = await p.text({
      message: "Profile name",
      placeholder: "my-project",
      validate: v => !/^[a-z][a-z0-9-]{1,63}$/.test(v ?? "") ? "Must be kebab-case" : undefined,
    });
    if (p.isCancel(name)) { p.cancel("Cancelled."); return 130; }

    const desc = await p.text({
      message: "Description",
      placeholder: `Profile for ${cwd.split("/").pop()}`,
    });
    if (p.isCancel(desc)) { p.cancel("Cancelled."); return 130; }

    // Create minimal profile
    const { run: createProfile } = await import("./create-profile");
    await createProfile([name as string, "--description", desc as string, "--icon", "🔧"]);

    writeFileSync(join(cwd, ".cue.profile"), (name as string) + "\n");
    await offerDiscoverGems(name as string);
    await showCostProof(name as string);
    await ensureShim();
    p.outro(`✅ Created profile "${name}" and pinned to this directory.`);
    return 0;
  }

  // Pin the chosen profile
  writeFileSync(join(cwd, ".cue.profile"), (choice as string) + "\n");
  await offerDiscoverGems(choice as string);
  await showCostProof(choice as string);
  await ensureShim();
  p.outro(`✅ Pinned "${choice}" to this directory. Next \`claude\` launch will use it.`);
  return 0;
}
