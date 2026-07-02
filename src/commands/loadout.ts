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
  const w = process.stdout.write.bind(process.stdout);
  w(`loadout for ${dir}\n`);
  w(`  profile   ${entry.profile}\n`);
  w(`  captured  ${entry.capturedAt} · ${entry.enabled ? "enabled" : "DISABLED (cue loadout on)"}\n`);
  w(`  skills    ${entry.full.length} full · ${entry.deferred.length} deferred\n`);
  if (entry.userKeep.length > 0) w(`  userKeep  ${entry.userKeep.join(", ")}\n`);
  if (entry.userDefer.length > 0) w(`  userDefer ${entry.userDefer.join(", ")}\n`);
  if (entry.deferred.length > 0) {
    const head = entry.deferred.slice(0, 15);
    const rest = entry.deferred.length - head.length;
    w(`  deferred  ${head.join(", ")}${rest > 0 ? `, +${rest} more` : ""}\n`);
  }
  w(`edit: cue loadout keep <id…> · defer <id…> · on|off · reset · --cue-full at launch loads all\n`);
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
