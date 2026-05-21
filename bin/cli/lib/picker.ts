/**
 * picker — interactive profile chooser.
 *
 * Two surfaces:
 *   - renderProfileList(): pure formatter (testable)
 *   - runPicker(): interactive TUI driven by @clack/prompts; opens stdin/stdout
 *
 * Picker writes the chosen profile to ./.cue-profile unless --no-pin is passed.
 * Cancel (esc / Ctrl-C) → exit code 130 (caller handles).
 */

import * as p from "@clack/prompts";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface PickerOption {
  value: string;
  label: string;
  hint: string;
}

export interface RenderOptions {
  cwd: string;
  includeFooter?: boolean;
}

export function renderProfileList(opts: PickerOption[], render: RenderOptions): string {
  const lines: string[] = [];
  lines.push(`▍cue · pick a profile for ${render.cwd}`);
  lines.push("");
  for (const opt of opts) {
    lines.push(`  ${opt.label.padEnd(14)} ${opt.hint}`);
  }
  if (render.includeFooter !== false) {
    lines.push("  ─────");
    lines.push("  + new profile from this cwd...");
    lines.push("  ⓘ details (d) · pick once, no pin (n) · cancel (esc)");
  }
  return lines.join("\n");
}

export interface PickerInput {
  cwd: string;
  options: PickerOption[];
  /** Skip writing .cue-profile if true. */
  noPin?: boolean;
}

export interface PickerOutput {
  profile: string;
  pinned: boolean;
}

export async function runPicker(input: PickerInput): Promise<PickerOutput> {
  p.intro(`cue · pick a profile for ${input.cwd}`);

  const choice = await p.select({
    message: "Profile",
    options: input.options.map((o) => ({ value: o.value, label: o.label, hint: o.hint })),
  });

  if (p.isCancel(choice)) {
    p.cancel("cancelled");
    process.exit(130);
  }

  let pinned = false;
  if (!input.noPin) {
    const pinChoice = await p.confirm({ message: "Pin to this directory?", initialValue: true });
    if (p.isCancel(pinChoice)) {
      p.cancel("cancelled");
      process.exit(130);
    }
    if (pinChoice === true) {
      await writeFile(join(input.cwd, ".cue-profile"), `${choice}\n`);
      pinned = true;
    }
  }

  p.outro(`profile: ${choice}${pinned ? " (pinned)" : ""}`);
  return { profile: choice as string, pinned };
}
