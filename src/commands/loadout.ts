/**
 * `cue loadout` — inspect and edit the project loadout captured at launch.
 *
 *   cue loadout                 show this project's loadout
 *   cue loadout keep <id…>      promote skills to full (materialized) for this project
 *   cue loadout defer <id…>     demote skills to the deferred index for this project
 *   cue loadout off | on        disable / re-enable the loadout for this project
 *   cue loadout reset           forget the loadout (recomputed on next launch)
 *
 * Edits key off the same directory the launch used (the `.cue.profile` pin
 * dir), found by walking up from cwd. Changes apply on the next launch — the
 * filtered profile changes the runtime content hash, so the rebuild is
 * automatic.
 */

import { stripVTControlCharacters, styleText } from "node:util";
import { wrapText } from "../lib/discover-format";
import { visibleWidth } from "../lib/picker/ui";
import {
  deleteLoadout,
  findLoadoutDir,
  readLoadout,
  writeLoadout,
  type LoadoutEntry,
} from "../lib/project-loadout";

const USAGE =
  "usage: cue loadout [keep <id…> | defer <id…> | on | off | reset]\n";

function locate(cwd: string): { dir: string; entry: LoadoutEntry } | null {
  const dir = findLoadoutDir(cwd);
  if (!dir) return null;
  const entry = readLoadout(dir);
  return entry ? { dir, entry } : null;
}

function show(dir: string, entry: LoadoutEntry): void {
  const columns = process.stdout.columns || 80;
  const clean = (text: string) =>
    stripVTControlCharacters(text).replace(/[\p{Cc}\u2028\u2029]+/gu, " ");
  const lines = [
    `${styleText("cyan", "◆ cue loadout")}  ${styleText(entry.enabled ? "green" : "yellow", entry.enabled ? "Enabled" : "Disabled")}`,
    `  Profile   ${clean(entry.profile)}`,
    `  Project   ${clean(dir)}`,
    `  Captured  ${clean(entry.capturedAt)}`,
  ];
  const group = (label: string, ids: string[]) => {
    lines.push("", styleText("bold", `${label} (${ids.length})`));
    lines.push(...wrapText(ids.map(clean).join(", ") || "None", columns - 2, "")
      .map((line) => `  ${line}`));
  };
  if (!entry.enabled) lines.push("", styleText("yellow", "Saved groups (inactive)"));
  group("At startup", entry.full);
  group("On demand", entry.deferred);
  if (entry.userKeep.length > 0) group("Pinned at startup", entry.userKeep);
  if (entry.userDefer.length > 0) group("Pinned on demand", entry.userDefer);

  lines.push("", styleText("bold", "Change for the next launch"));
  for (const [command, description] of [
    ["cue loadout keep <id…>", "Load at startup"],
    ["cue loadout defer <id…>", "Load on demand"],
    entry.enabled
      ? ["cue loadout off", "Disable filtering"]
      : ["cue loadout on", "Enable filtering"],
    ["cue loadout reset", "Recompute saved loadout"],
  ]) {
    const name = styleText("cyan", command);
    const inline = `  ${name}  ·  ${description}`;
    if (visibleWidth(inline) <= columns) lines.push(inline);
    else lines.push(`  ${name}`, `    ${description}`);
  }
  lines.push(
    "",
    styleText("bold", "Load all skills once"),
    ...wrapText("Add --cue-full to the agent command.", columns - 2, "")
      .map((line) => `  ${line}`),
  );
  process.stdout.write(`${lines.join("\n")}\n`);
}

/** Move ids between full/deferred and pin the choice in userKeep/userDefer. */
function move(entry: LoadoutEntry, ids: string[], to: "full" | "deferred"): string[] {
  const applied: string[] = [];
  for (const id of ids) {
    const key = id.toLowerCase();
    const inFull = entry.full.some((s) => s.toLowerCase() === key);
    const inDeferred = entry.deferred.some((s) => s.toLowerCase() === key);
    // Record the user's intent even for ids not currently in the profile —
    // a future recompute (profile/signal change) honors userKeep/userDefer.
    if (to === "full") {
      entry.userKeep = [...new Set([...entry.userKeep, id])];
      entry.userDefer = entry.userDefer.filter((s) => s.toLowerCase() !== key);
      if (inDeferred) {
        entry.deferred = entry.deferred.filter((s) => s.toLowerCase() !== key);
        if (!inFull) entry.full = [...entry.full, id];
      }
    } else {
      entry.userDefer = [...new Set([...entry.userDefer, id])];
      entry.userKeep = entry.userKeep.filter((s) => s.toLowerCase() !== key);
      if (inFull) {
        entry.full = entry.full.filter((s) => s.toLowerCase() !== key);
        if (!inDeferred) entry.deferred = [...entry.deferred, id];
      }
    }
    if (inFull || inDeferred) applied.push(id);
    else process.stderr.write(`cue loadout: "${id}" is not in this loadout's profile — recorded for future recomputes\n`);
  }
  return applied;
}

export async function run(args: string[]): Promise<number> {
  const cwd = process.cwd();
  const sub = args[0];

  if (sub === "--help" || sub === "-h" || sub === "help") {
    process.stdout.write(USAGE);
    return 0;
  }

  const found = locate(cwd);
  if (!found) {
    process.stdout.write(
      `cue loadout: nothing captured for ${cwd} — launch a ≥25-skill profile here first\n`,
    );
    return sub === undefined ? 0 : 1;
  }
  const { dir, entry } = found;

  switch (sub) {
    case undefined:
    case "show":
      show(dir, entry);
      return 0;
    case "keep":
    case "defer": {
      const ids = args.slice(1);
      if (ids.length === 0) {
        process.stderr.write(USAGE);
        return 1;
      }
      const applied = move(entry, ids, sub === "keep" ? "full" : "deferred");
      writeLoadout(dir, entry);
      process.stdout.write(
        `cue loadout: ${sub === "keep" ? "promoted" : "deferred"} ${applied.length}/${ids.length} — ` +
        `now ${entry.full.length} full · ${entry.deferred.length} deferred (applies next launch)\n`,
      );
      return 0;
    }
    case "on":
    case "off":
      entry.enabled = sub === "on";
      writeLoadout(dir, entry);
      process.stdout.write(`cue loadout: ${sub === "on" ? "enabled" : "disabled"} for ${dir}\n`);
      return 0;
    case "reset":
      deleteLoadout(dir);
      process.stdout.write(`cue loadout: reset for ${dir} — recomputed on next launch\n`);
      return 0;
    default:
      process.stderr.write(USAGE);
      return 1;
  }
}
