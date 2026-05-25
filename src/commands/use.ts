/**
 * `cue use <profile>` — pin a profile to the current directory.
 *
 * Writes `.cue-profile` in CWD (or $HOME with --global).
 *
 * Composite selectors are accepted: `cue use postizz+trendradar` validates
 * each part separately and pins the full `a+b` string verbatim.
 *
 * After pinning a single profile, surfaces any `recommends:` companions and
 * offers an interactive prompt to upgrade the pin to a composite. Skip the
 * prompt with `--no-prompt` (or in non-TTY environments — auto-skipped).
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { isCompositeSelector, listProfiles, loadProfile, parseProfileSelector } from "../lib/profile-loader";

export async function run(args: string[]): Promise<number> {
  const global = args.includes("--global") || args.includes("-g");
  const noPrompt = args.includes("--no-prompt");
  const selector = args.find(a => !a.startsWith("-"));

  if (!selector) {
    process.stderr.write("Usage: cue use <profile>[+<profile>…] [--global] [--no-prompt]\n");
    const profiles = await listProfiles();
    process.stderr.write(`\nAvailable: ${profiles.join(", ")}\n`);
    return 1;
  }

  // Validate every part of the selector exists. Composite selectors are
  // pinned verbatim — the loader splits on `+` again at read time.
  const profiles = await listProfiles();
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
    process.stderr.write(`Available: ${profiles.join(", ")}\n`);
    return 1;
  }

  const writePin = (value: string) => {
    const target = global ? join(homedir(), ".cue-profile") : join(process.cwd(), ".cue-profile");
    writeFileSync(target, value + "\n");
  };

  writePin(selector);
  const scope = global ? "globally" : `in ${process.cwd()}`;
  process.stdout.write(`✅ Now using "${selector}" ${scope}\n`);

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
