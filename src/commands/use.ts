/**
 * `cue use <profile>` — pin a profile to the current directory.
 *
 * Writes `.cue.profile` in CWD (or $HOME with --global).
 *
 * Composite selectors are accepted: `cue use postizz+trendradar` validates
 * each part separately and pins the full `a+b` string verbatim.
 *
 * After pinning a single profile, surfaces any `recommends:` companions and
 * offers an interactive prompt to upgrade the pin to a composite. Skip the
 * prompt with `--no-prompt` (or in non-TTY environments — auto-skipped).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import * as p from "@clack/prompts";

import { isCompositeSelector, listProfiles, loadProfile, parseProfileSelector } from "../lib/profile-loader";
import { countProfileSkills } from "../lib/profile-capabilities";

function printHelp(): void {
  process.stdout.write("Usage: cue use [<profile>[+<profile>…]] [options]\n\n");
  process.stdout.write("With no profile in an interactive terminal, opens a searchable picker.\n\n");
  process.stdout.write("Options:\n");
  process.stdout.write("  -g, --global          Pin in your home directory\n");
  process.stdout.write("      --no-prompt       Skip companion-profile prompts\n");
  process.stdout.write("      --no-profiles-dir Do not write profile metadata snapshots\n");
  process.stdout.write("  -h, --help            Show this help\n");
}

/** Ensure `entry` appears in the .gitignore at `dir` (idempotent). */
function ensureGitignoreEntry(dir: string, entry: string): void {
  const path = join(dir, ".gitignore");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = existing.split("\n").map(l => l.trim());
  if (lines.includes(entry)) return;
  const suffix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(path, existing + suffix + entry + "\n");
}

/** Write profiles/<name>.json for each profile part into dir (best-effort). */
async function writeProfilesDir(parts: string[], dir: string): Promise<void> {
  try {
    mkdirSync(join(dir, "profiles"), { recursive: true });
    await Promise.all(parts.map(async (name) => {
      try {
        const p = await loadProfile(name);
        const snapshot = {
          name: p.name,
          description: p.description,
          kind: p.kind,
          ...(p.icon ? { icon: p.icon } : {}),
          ...(p.inheritanceChain.length > 1 ? { inherits: p.inheritanceChain.slice(0, -1) } : {}),
          ...(p.recommends.length > 0 ? { recommends: p.recommends } : {}),
        };
        writeFileSync(join(dir, "profiles", `${name}.json`), JSON.stringify(snapshot, null, 2) + "\n");
      } catch {
        // best-effort per profile — missing profile metadata is non-fatal
      }
    }));
  } catch {
    // never fail the pin because of profiles/ write errors
  }
}

export async function run(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return 0;
  }
  const global = args.includes("--global") || args.includes("-g");
  const noPrompt = args.includes("--no-prompt");
  const noProfilesDir = args.includes("--no-profiles-dir");
  let selector = args.find(a => !a.startsWith("-"));
  const profiles = await listProfiles();

  if (!selector) {
    if (!stdin.isTTY || !stdout.isTTY) {
      process.stderr.write("Usage: cue use <profile>[+<profile>…] [--global] [--no-prompt]\n");
      process.stderr.write("Run `cue list` for primary profiles or `cue list --all` for extensions.\n");
      return 1;
    }
    const options = await Promise.all(profiles.map(async (name) => {
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
    const picked = await p.autocomplete({
      message: "Choose a profile",
      placeholder: "Type to search all profiles…",
      options,
    });
    if (p.isCancel(picked)) {
      p.cancel("Cancelled.");
      return 130;
    }
    selector = picked as string;
  }

  // Validate every part of the selector exists. Composite selectors are
  // pinned verbatim — the loader splits on `+` again at read time.
  let parts: string[];
  try {
    parts = parseProfileSelector(selector);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 1;
  }
  const missing = parts.filter((p) => !profiles.includes(p));
  if (missing.length > 0) {
    process.stderr.write(`Profile${missing.length > 1 ? "s" : ""} not found: ${missing.join(", ")}\n`);
    process.stderr.write("Run `cue list` for primary profiles or `cue list --all` for extensions.\n");
    return 1;
  }

  const writePin = (value: string) => {
    const target = global ? join(homedir(), ".cue.profile") : join(process.cwd(), ".cue.profile");
    writeFileSync(target, value + "\n");
  };

  writePin(selector);
  const scope = global ? "globally" : `in ${process.cwd()}`;
  process.stdout.write(`✅ Now using "${selector}" ${scope}\n`);

  // Write profiles/<name>.json manifest + gitignore both cue artifacts (project-local only).
  if (!global && !noProfilesDir) {
    await writeProfilesDir(parts, process.cwd());
    const created = parts.map(p => `profiles/${p}.json`).join(", ");
    process.stdout.write(`📁 Profile manifest written: ${created}\n`);
    ensureGitignoreEntry(process.cwd(), ".cue.profile");
    ensureGitignoreEntry(process.cwd(), "profiles/");
  }

  // Recommendation surfacing — only on plain (non-composite) selections.
  if (!isCompositeSelector(selector)) {
    try {
      const resolved = await loadProfile(selector);
      const present = new Set(profiles);
      const recs = resolved.recommends.filter((r) => r !== selector && present.has(r));
      if (recs.length > 0) {
        const composite = [selector, ...recs].join("+");
        process.stdout.write(`\n💡 Recommended companion profiles: ${recs.join(", ")}\n`);
        process.stdout.write(`   Activate together: cue use ${composite}\n`);

        if (!noPrompt && stdin.isTTY) {
          const rl = createInterface({ input: stdin, output: stdout });
          try {
            const answer = (await rl.question(`\nUpgrade pin to "${composite}"? [y/N] `)).trim().toLowerCase();
            if (answer === "y" || answer === "yes") {
              writePin(composite);
              process.stdout.write(`✅ Now using "${composite}" ${scope}\n`);
            }
          } finally {
            rl.close();
          }
        }
      }
    } catch {
      // Recommendation surfacing is best-effort — never fail the pin on it.
    }
  }

  return 0;
}
