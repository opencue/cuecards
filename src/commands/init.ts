/**
 * `cue init` — project scanner + profile wizard.
 *
 * Two phases run end-to-end:
 *   1. **Global onboarding** (first-run only, or `--re-onboard`): picks a
 *      default-profile composite, opts into local analytics, and marks
 *      `.onboarded` so subsequent `cue init` calls skip straight to phase 2.
 *   2. **Per-directory pinning** (always): scan cwd, suggest the best
 *      profile, write `.cue.profile`, offer to install discovered gems.
 *
 * Non-interactive path (`--profile <name>` / `--yes`, `-y`):
 *
 * An agent driving this command through a one-shot Bash tool cannot answer
 * a `p.select`/`p.confirm`/`p.text` prompt — the call just hangs (or, with
 * stdin closed, crashes on EOF). `--yes` exists so the whole flow can run
 * with NO clack widget ever invoked. That guarantee is deliberately narrow:
 * `--yes` only skips questions the interactive wizard would have asked and
 * already has a safe default for (which profile, whether to install the
 * shim). It must NOT silently say "yes" on the user's behalf to the two
 * prompts that grant something beyond this run — analytics consent and
 * third-party gem installs — because the user never saw those asked. See
 * `runGlobalOnboarding()` and `offerDiscoverGems()` below.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as p from "@clack/prompts";

import { listProfiles, loadProfile } from "../lib/profile-loader";
import { detectRepositoryStacks } from "../lib/repository-stack-detect";
import { countProfileSkills } from "../lib/profile-capabilities";
import { getCachedGemsForProfile, autoInstallClis } from "./discover";
import { shimInstalled, runInstall, type ShimOptions } from "./shell";
import { SHIM_AGENTS, shimDir } from "../lib/shim-dir";
import { findRealAgentBin } from "../lib/claude-binary";
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

export interface GlobalOnboardingOptions {
  /**
   * Run with no `p.select`/`p.confirm`/`p.text` calls. Pins the
   * default-profile to `core` (the same value the interactive prompt marks
   * "recommended") and leaves analytics OFF — consent that was never asked
   * for is not consent. Never throws, never blocks on stdin.
   */
  nonInteractive?: boolean;
}

/**
 * First-run setup: default-profile composition + analytics opt-in. Returns
 * `false` when the user cancels mid-wizard so the caller can short-circuit.
 *
 * Writes:
 *   - `<configDir>/default-profile` (when a composite was chosen, or always
 *     `core` under `nonInteractive`)
 *   - `<configDir>/.telemetry-consent` (when user opts in — NEVER under
 *     `nonInteractive`)
 *   - `<configDir>/.onboarded` (marker — written by the caller post-success)
 */
export async function runGlobalOnboarding(
  opts: GlobalOnboardingOptions = {},
): Promise<boolean> {
  p.log.info(
    "👋 Welcome to cue. Quick 30-second setup before we pin a profile to this directory.",
  );

  if (opts.nonInteractive) {
    // No prompts reachable below this line. Pin the recommended default
    // (`core`) — identical to what the interactive prompt's initial value
    // would have produced — and leave analytics untouched (opted out unless
    // some earlier run already opted in).
    const path = defaultProfilePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "core\n");
    p.log.success("Default profile: core (non-interactive — change anytime with `cue use --set-default`).");
    if (!telemetryEnabled()) {
      p.log.message(
        "Local analytics left OFF (non-interactive — this was never asked). Opt in anytime: `cue telemetry enable`.",
      );
    }
    return true;
  }

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

/**
 * Offer to install third-party "gem" skills discovered for `profile`.
 *
 * Under `nonInteractive`, this is skipped ENTIRELY — no cache lookup, no
 * `p.confirm`, no `npx skills add` process. Installing third-party code
 * pulled from GitHub is not something a convenience flag gets to say "yes"
 * to on the user's behalf; the user never saw the list of what would be
 * installed. One line is printed so the user knows how to run it later.
 */
async function offerDiscoverGems(
  profile: string,
  opts: { nonInteractive?: boolean } = {},
): Promise<void> {
  if (opts.nonInteractive) {
    p.log.message(
      `Skipped gem discovery for "${profile}" (non-interactive) — run \`cue discover\` then \`cue init\` later to review and install third-party skills.`,
    );
    return;
  }

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
 * Test-injection escape hatch into `ensureShim()`'s `runInstall()` call —
 * mirrors the fields `shell.test.ts` already drives `runInstall()` with
 * (`homeDir`, `realClaude`/`realCodex`, `pathDirs`, `out`/`err`). Production
 * callers pass nothing: `ensureShim()` resolves the real home directory and
 * real agent binaries itself.
 */
export type ShimInjectOptions = Pick<
  ShimOptions,
  | "homeDir"
  | "realClaude"
  | "realCodex"
  | "pathDirs"
  | "platform"
  | "updateWindowsPath"
  | "out"
  | "err"
>;

/**
 * Offer to install the shell shims if they're missing. Without the shim,
 * typing `claude` runs vanilla Claude Code and the pinned profile is never
 * loaded — the #1 "I followed the docs and nothing happened" failure. Detect
 * it here and offer the one-time fix.
 *
 * Under `nonInteractive`, the shim IS installed — unlike telemetry consent
 * and gem installs, this is the flag's whole point, and callers that invoke
 * `--yes` (the plugin command, the paste prompt) are required to have asked
 * the user before running it at all.
 *
 * Returns whether a working shim is confirmed in place when this call
 * returns (already installed, or just installed successfully) — `false`
 * covers both "declined" (interactive) and "install failed" (either mode).
 * The caller decides what that means for its own exit code: `run()` only
 * treats `false` as a failure in the non-interactive case, because declining
 * the interactive prompt is not a failure.
 */
async function ensureShim(
  opts: { nonInteractive?: boolean } & ShimInjectOptions = {},
): Promise<boolean> {
  const platform = opts.platform ?? process.platform;
  let installedAny = false;
  let missingAvailable = false;
  for (const agent of SHIM_AGENTS) {
    if (shimInstalled(opts.homeDir, agent, platform)) {
      installedAny = true;
      continue;
    }
    const injected = agent === "claude" ? opts.realClaude : opts.realCodex;
    const real = injected === undefined ? findRealAgentBin(agent) : injected;
    if (real) missingAvailable = true;
  }
  // An agent that is not installed does not require a shim. But if Codex was
  // added after an older Claude-only cue setup, do not let the Claude shim
  // short-circuit setup — install Codex's picker shim too.
  if (installedAny && !missingAvailable) return true;
  const dir = shimDir(opts.homeDir);
  const injected: ShimInjectOptions = {
    homeDir: opts.homeDir,
    realClaude: opts.realClaude,
    realCodex: opts.realCodex,
    pathDirs: opts.pathDirs,
    platform: opts.platform,
    updateWindowsPath: opts.updateWindowsPath,
    out: opts.out,
    err: opts.err,
  };

  if (opts.nonInteractive) {
    p.log.step(`Installing the claude/codex shims (non-interactive) → ${dir}...`);
    try {
      // runInstall() prints its own PATH guidance, including the exact rc
      // line when the shim dir isn't on PATH yet. `yes: true` lets it also
      // append that PATH line non-interactively — the whole run must not
      // touch a single clack widget.
      const code = await runInstall({ ...injected, yes: true });
      if (code === 0) {
        p.log.success(`Shim installed to ${dir}.`);
        return true;
      }
      // A non-zero runInstall() means no working shim exists — most often
      // "no real claude/codex binary found on PATH". Under --yes this MUST
      // surface as a command failure (see run()'s caller), not a swallowed
      // warning that still reports success.
      p.log.error("Shim install failed — run `cue shell install` manually for details.");
      return false;
    } catch {
      p.log.error("Couldn't install the shim automatically — run `cue shell install` manually.");
      return false;
    }
  }

  p.log.warn(
    "The `claude`/`codex` shim isn't installed yet — without it, launching `claude` runs vanilla Claude Code and won't load this profile.",
  );
  const install = await p.confirm({
    message: `Install the shell shim now? (writes ${dir}/claude)`,
  });
  if (p.isCancel(install) || !install) {
    p.log.message("Skipped — run `cue shell install` later to activate profile loading.");
    return false;
  }
  try {
    // runInstall() prints its own PATH guidance, including the exact rc line
    // when the shim dir isn't on PATH yet.
    const code = await runInstall(injected);
    if (code === 0) {
      p.log.success(`Shim installed to ${dir}.`);
      return true;
    }
    p.log.warn("Shim install reported an issue — run `cue shell install` manually for details.");
    return false;
  } catch {
    p.log.warn("Couldn't install the shim automatically — run `cue shell install` manually.");
    return false;
  }
}

export interface RunDeps {
  /** See {@link ShimInjectOptions} — forwarded to `ensureShim()`. */
  shim?: ShimInjectOptions;
}

function printHelp(): void {
  process.stdout.write("Usage: cue setup [options]\n");
  process.stdout.write("       cue init [options]\n\n");
  process.stdout.write("Scans the current project, recommends a profile, and pins the selection.\n\n");
  process.stdout.write("Options:\n");
  process.stdout.write("      --profile <name>  Pin an explicit profile\n");
  process.stdout.write("  -y, --yes             Use safe defaults without prompts\n");
  process.stdout.write("      --no-onboarding   Skip global first-run onboarding\n");
  process.stdout.write("      --re-onboard      Repeat global onboarding\n");
  process.stdout.write("  -h, --help            Show this help\n");
}

export async function run(args: string[], deps: RunDeps = {}): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return 0;
  }
  const cwd = process.cwd();
  const reOnboard = args.includes("--re-onboard");
  const skipOnboarding = args.includes("--no-onboarding");
  const yes = args.includes("--yes") || args.includes("-y");
  const profileFlagIdx = args.indexOf("--profile");
  const profileFlagPresent = profileFlagIdx >= 0;
  const profileRawValue = profileFlagPresent ? args[profileFlagIdx + 1] : undefined;
  // A following flag (e.g. `--profile --yes`, or `--profile` as the last
  // arg) is NOT a value — treat it the same as a missing value rather than
  // silently swallowing the next flag as a profile name.
  const pinnedProfile =
    profileRawValue !== undefined && !profileRawValue.startsWith("-") ? profileRawValue : undefined;

  // Validate `--profile <name>` BEFORE anything else runs — including before
  // `p.intro()` and the onboarding phase. A typo (or a missing value) must
  // fail fast and exit non-zero, never fall back to a guess, and never risk
  // tripping a prompt on the way to reporting the error (applies whether or
  // not `--yes` is also passed — this is a distinct check from the
  // non-interactive flow).
  if (profileFlagPresent && pinnedProfile === undefined) {
    process.stderr.write(
      "❌ --profile requires a profile name (e.g. `--profile core`) — run `cue list` to see available profiles.\n",
    );
    return 1;
  }
  if (pinnedProfile !== undefined) {
    const known = await listProfiles();
    if (!known.includes(pinnedProfile)) {
      process.stderr.write(
        `❌ Unknown profile "${pinnedProfile}" — run \`cue list\` to see available profiles.\n`,
      );
      return 1;
    }
  }

  p.intro("🎯 cue init — set up profile for this project");

  // Global onboarding (first run only, or explicit --re-onboard).
  const marker = onboardedMarkerPath();
  if (!skipOnboarding && (!existsSync(marker) || reOnboard)) {
    const ok = await runGlobalOnboarding({ nonInteractive: yes });
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
  const report = await detectRepositoryStacks(cwd, { limit: 3 });
  const project = report.project;
  const detected: string[] = [...project.languages, ...project.frameworks, ...project.tools];

  if (detected.length) {
    p.log.info(`Detected: ${detected.join(", ")}`);
  } else {
    p.log.info("No strong project signals detected.");
  }

  // Score through the same repository-stack service used by launch and auto-detect.
  const suggestions = report.suggestions;

  // Resolve which profile to pin WITHOUT ever reaching `p.select` when either
  // `--profile` or `--yes` is set.
  let choice: string;
  if (pinnedProfile !== undefined) {
    // Already validated above — skips only the selection menu; every
    // remaining prompt below (gems, shim) still runs interactively unless
    // `--yes` is ALSO set.
    choice = pinnedProfile;
  } else if (yes) {
    // Auto-pin only a strong, separated repository stack. A weak or ambiguous
    // suggestion falls back to the safe default instead of silently guessing.
    choice = report.autoSelection.selector ?? "core";
    if (report.autoSelection.status === "uncertain") {
      p.log.warn(`Suggestion uncertain (${report.autoSelection.reason}); using core.`);
    }
  } else {
    const allProfiles = await listProfiles();

    // Present options
    const options: { value: string; label: string; hint?: string }[] = [];

    for (let i = 0; i < Math.min(suggestions.length, 3); i++) {
      const s = suggestions[i]!;
      const selector = s.parts.join("+");
      options.push({
        value: selector,
        label: selector,
        hint: s.reasons.join(", "),
      });
    }

    options.push({
      value: "__search",
      label: "Search all profiles…",
      hint: `${allProfiles.length} profiles including opt-in extensions`,
    });
    options.push({ value: "__new", label: "Create a new profile", hint: "interactive wizard" });
    options.push({ value: "__skip", label: "Skip — don't pin a profile" });

    const picked = await p.select({
      message: "Which profile for this directory?",
      options,
    });

    if (p.isCancel(picked)) {
      p.cancel("Cancelled.");
      return 130;
    }

    if (picked === "__skip") {
      p.outro("No profile pinned. Run `cue init` again anytime.");
      return 0;
    }

    if (picked === "__search") {
      const searchOptions = await Promise.all(allProfiles.map(async (name) => {
        try {
          const profile = await loadProfile(name);
          const totals = `${countProfileSkills(profile)} skills · ${profile.mcps.length} MCPs`;
          return {
            value: name,
            label: profile.icon ? `${profile.icon} ${name}` : name,
            hint: profile.kind === "overlay"
              ? `opt-in extension · ${totals} · ${profile.description}`
              : `${totals} · ${profile.description}`,
          };
        } catch {
          return { value: name, label: name };
        }
      }));
      const searched = await p.autocomplete({
        message: "Search profiles",
        placeholder: "Type a profile or capability…",
        options: searchOptions,
      });
      if (p.isCancel(searched)) {
        p.cancel("Cancelled.");
        return 130;
      }
      choice = searched as string;
    } else if (picked === "__new") {
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
      // Unreachable under `--yes` today (this whole branch is inside the
      // interactive-only `else`), but threading `nonInteractive`/`deps.shim`
      // here too means it can't quietly become a trap if that ever changes.
      await offerDiscoverGems(name as string, { nonInteractive: yes });
      await showCostProof(name as string);
      const shimActiveNew = await ensureShim({ nonInteractive: yes, ...deps.shim });
      p.outro(
        shimActiveNew
          ? `✅ Created profile "${name}" and pinned to this directory. Next \`claude\` launch will use it.`
          : `✅ Created profile "${name}" and pinned to this directory. Shim not active yet — run \`cue shell install\` to finish.`,
      );
      // Same non-interactive-only gate as the main pin path below — see the
      // comment there. `yes` is always false on this branch today (it's
      // reachable only from the interactive `p.select` menu), so this is
      // belt-and-suspenders, not a behavior change.
      return yes && !shimActiveNew ? 1 : 0;
    } else {
      choice = picked as string;
    }
  }

  // Pin the chosen profile
  writeFileSync(join(cwd, ".cue.profile"), choice + "\n");
  await offerDiscoverGems(choice, { nonInteractive: yes });
  await showCostProof(choice);
  const shimActive = await ensureShim({ nonInteractive: yes, ...deps.shim });
  p.outro(
    shimActive
      ? `✅ Pinned "${choice}" to this directory. Next \`claude\` launch will use it.`
      : `✅ Pinned "${choice}" to this directory. Shim not active yet — run \`cue shell install\` to finish.`,
  );
  // Only the non-interactive path treats "shim didn't end up installed" as a
  // command failure. A user who declined the interactive shim prompt made an
  // informed choice, not an error — `yes` is false there, so this stays 0.
  // Under `--yes`, though, a failed shim install (most commonly: no real
  // claude/codex binary on PATH) means the pinned profile will never load,
  // which is exactly the failure the paste prompt's "if it exits non-zero,
  // stop" step (setup/agent-prompt.md) exists to catch.
  return yes && !shimActive ? 1 : 0;
}
