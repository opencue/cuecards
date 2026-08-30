/**
 * `cue brief` — show (or persist) the verified facts cue hands the agent about
 * the current directory.
 *
 * The same scan runs automatically on every launch; this command exists so you
 * can see exactly what the agent is told, and so you can turn it into a
 * `.cue/project.md` you can annotate and commit.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  BRIEF_FILE,
  mergeBriefFile,
  renderBrief,
  scanBrief,
  type ProjectBrief,
} from "../lib/project-brief";

const HELP = `cue brief — verified facts about this directory, as handed to the agent

Usage:
  cue brief                Print the brief for the current directory
  cue brief --write        Create/refresh .cue/project.md (your notes are kept)
  cue brief --json         Print the structured scan
  cue brief --path <dir>   Scan another directory

Every launch injects this automatically. CUE_BRIEF=0 turns injection off.
`;

export async function run(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(HELP);
    return 0;
  }
  const pathIdx = args.indexOf("--path");
  const cwd = pathIdx >= 0 ? args[pathIdx + 1] ?? process.cwd() : process.cwd();
  const asJson = args.includes("--json");
  const write = args.includes("--write");

  let brief: ProjectBrief | null = null;
  try {
    brief = scanBrief(cwd);
  } catch {
    brief = null;
  }

  if (!brief) {
    if (asJson) {
      process.stdout.write(`${JSON.stringify({ brief: null, reason: "no manifest or git repo" })}\n`);
      return 0;
    }
    process.stderr.write(
      `cue brief: ${cwd} has no manifest or git repo — nothing verified to report\n`,
    );
    return 1;
  }

  if (asJson) {
    process.stdout.write(`${JSON.stringify(brief, null, 2)}\n`);
    return 0;
  }

  if (!write) {
    process.stdout.write(`${renderBrief(brief)}\n`);
    return 0;
  }
  // The file carries notes in its own section; keeping them out of the machine
  // block is what makes a rewrite idempotent.
  const rendered = renderBrief(brief, { includeNotes: false });

  const target = join(cwd, BRIEF_FILE);
  let existing: string | null = null;
  try {
    existing = await readFile(target, "utf8");
  } catch {
    /* first write */
  }
  const merged = mergeBriefFile(existing, rendered);
  try {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, merged);
  } catch (err) {
    process.stderr.write(`cue brief: could not write ${target}: ${(err as Error).message}\n`);
    return 1;
  }
  process.stdout.write(
    `${existing ? "refreshed" : "created"} ${BRIEF_FILE}` +
      `${existing ? " (your notes were kept)" : " — add notes under ## Notes"}\n`,
  );
  return 0;
}
