/**
 * `cue skills pin <id>` — pin a skill to current commit.
 * `cue skills rollback <id>` — revert to previous pin.
 * `cue skills unpin <id>` — remove pin.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { repoRoot } from "../lib/repo-root";

const SKILLS_ROOT = join(repoRoot(), "resources", "skills", "skills");
const PIN_HISTORY_PATH = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  "cue",
  "pin-history.json",
);

interface PinHistory {
  [skillId: string]: { pin: string; ts: string }[];
}

function loadHistory(): PinHistory {
  if (!existsSync(PIN_HISTORY_PATH)) return {};
  try { return JSON.parse(readFileSync(PIN_HISTORY_PATH, "utf8")); } catch { return {}; }
}

function saveHistory(h: PinHistory): void {
  mkdirSync(dirname(PIN_HISTORY_PATH), { recursive: true });
  writeFileSync(PIN_HISTORY_PATH, JSON.stringify(h, null, 2));
}

function getCurrentCommit(skillId: string): string | null {
  const skillDir = join(SKILLS_ROOT, skillId);
  const res = spawnSync("git", ["log", "-1", "--format=%H", "--", skillDir], {
    cwd: join(repoRoot(), "resources", "skills"),
    encoding: "utf8",
  });
  return res.status === 0 ? res.stdout.trim().slice(0, 7) : null;
}

export async function run(args: string[]): Promise<number> {
  const sub = args[0]; // pin, rollback, unpin
  const id = args[1];

  if (!sub || !id) {
    process.stderr.write("Usage: cue skills pin <id>\n       cue skills rollback <id>\n       cue skills unpin <id>\n");
    return 1;
  }

  const skillDir = join(SKILLS_ROOT, id);
  if (!existsSync(skillDir)) {
    process.stderr.write(`Skill "${id}" not found.\n`);
    return 1;
  }

  const history = loadHistory();

  switch (sub) {
    case "pin": {
      const commit = getCurrentCommit(id);
      if (!commit) {
        process.stderr.write("Could not determine current commit.\n");
        return 1;
      }
      const entries = history[id] ?? [];
      entries.push({ pin: `git@${commit}`, ts: new Date().toISOString() });
      history[id] = entries;
      saveHistory(history);
      process.stdout.write(`📌 Pinned "${id}" to git@${commit}\n`);
      return 0;
    }

    case "rollback": {
      const entries = history[id];
      if (!entries || entries.length < 2) {
        process.stderr.write(`No previous pin to rollback to for "${id}".\n`);
        return 1;
      }
      entries.pop(); // remove current
      const prev = entries[entries.length - 1]!;
      history[id] = entries;
      saveHistory(history);
      process.stdout.write(`⏪ Rolled back "${id}" to ${prev.pin} (from ${prev.ts})\n`);
      return 0;
    }

    case "unpin": {
      delete history[id];
      saveHistory(history);
      process.stdout.write(`🔓 Unpinned "${id}" — will use HEAD\n`);
      return 0;
    }

    default:
      process.stderr.write(`Unknown subcommand: ${sub}\n`);
      return 1;
  }
}
