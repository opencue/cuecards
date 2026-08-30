/**
 * `cue trigger-gaps` — show which skills should be firing but aren't.
 *
 * Joins the user's prompt history (from Claude Code's transcript files
 * under ~/.claude/projects/) with the active profile's skill trigger
 * declarations. When a prompt matches a trigger but no skill_hit was
 * recorded, that's a gap — the trigger phrase exists in the wild but the
 * routing isn't kicking in.
 *
 * Usage:
 *   cue trigger-gaps [--profile <name>] [--since <days>] [--limit <n>] [--json]
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { loadProfile } from "../lib/profile-loader";
import { parseSkillFromDir, type ParsedSkill } from "../lib/skill-router";
import { resolveLocalSkill } from "../lib/resolver-local";
import { computeTriggerGaps, type TriggerGapRow } from "../lib/trigger-gaps";
import { computeSkillUsage } from "../lib/skill-report";
import { isEnabled as telemetryEnabled } from "../lib/telemetry-consent";

const REPO_ROOT = resolve(new URL(import.meta.url).pathname, "..", "..", "..");
const PROJECTS_ROOT = join(homedir(), ".claude", "projects");
void REPO_ROOT;

interface ParsedArgs {
  profile: string | null;
  sinceDays: number;
  limit: number;
  json: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    profile: null, sinceDays: 30, limit: 10, json: false, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--json") out.json = true;
    else if (a === "--profile") out.profile = argv[++i] ?? null;
    else if (a === "--since") {
      const v = argv[++i] ?? "30";
      const m = v.match(/^(\d+)\s*d?$/);
      out.sinceDays = m ? Math.max(1, parseInt(m[1]!, 10)) : 30;
    } else if (a === "--limit") out.limit = Math.max(1, Number(argv[++i] ?? "10") || 10);
  }
  return out;
}

function helpText(): string {
  return [
    "cue trigger-gaps — find skills whose trigger phrases appear in prompts but never fire",
    "",
    "Usage:",
    "  cue trigger-gaps [--profile <name>] [--since <days>] [--limit <n>] [--json]",
    "",
    "Reads Claude Code transcripts under ~/.claude/projects/ and matches user",
    "prompts against each profile skill's declared trigger phrases. A prompt",
    "that matches but produced no skill_hit event = a routing gap. Typical fixes:",
    "  - The skill's description is too vague to trigger Claude.",
    "  - The trigger phrase is too generic and matches too many prompts.",
    "  - The skill needs a more specific 'Use when…' lead-in.",
    "",
    "Telemetry must be enabled so hit counts are available for the comparison.",
    "",
  ].join("\n");
}

function resolveActiveProfile(explicit: string | null): string | null {
  if (explicit) return explicit;
  const pin = join(process.cwd(), ".cue.profile");
  if (existsSync(pin)) {
    try {
      const txt = readFileSync(pin, "utf8").trim().split("\n")[0]?.trim();
      if (txt) return txt;
    } catch { /* ignore */ }
  }
  return process.env.CUE_PROFILE ?? null;
}

/**
 * Walk ~/.claude/projects/<dir>/*.jsonl and extract user-role messages
 * within the time window. Claude Code's transcript format is JSONL where
 * each line is a message-shape object; we read defensively because the
 * shape can vary by Claude Code version.
 */
/**
 * Bound the transcript scan so a large `~/.claude/projects/` (GBs of JSONL on
 * an active machine) can't peg CPU / balloon memory / block the dashboard's
 * single event loop. The detector is a recency heuristic, so reading the NEWEST
 * transcripts under a byte + prompt budget keeps the signal while capping cost.
 */
export interface CollectOpts {
  /** Max transcript bytes to read (newest-first). Default 32 MB. */
  maxBytes?: number;
  /** Max prompts to collect. Default 20,000. */
  maxPrompts?: number;
}

export function collectUserPrompts(
  sinceDays: number,
  root = PROJECTS_ROOT,
  opts: CollectOpts = {},
): string[] {
  const maxBytes = opts.maxBytes ?? 32 * 1024 * 1024;
  const maxPrompts = opts.maxPrompts ?? 20_000;
  if (!existsSync(root)) return [];
  const cutoff = Date.now() - sinceDays * 24 * 60 * 60 * 1000;

  // Gather in-window candidate files first, then read NEWEST-first under the
  // budget — so when there's more history than the cap allows, we keep the most
  // recent prompts (the ones that matter for "what should be firing lately").
  const candidates: { fp: string; mt: number; size: number }[] = [];
  let dirs: string[] = [];
  try { dirs = readdirSync(root); } catch { return []; }
  for (const dir of dirs) {
    const dirPath = join(root, dir);
    let stat;
    try { stat = statSync(dirPath); } catch { continue; }
    if (!stat.isDirectory()) continue;
    let files: string[] = [];
    try { files = readdirSync(dirPath).filter((f) => f.endsWith(".jsonl")); } catch { continue; }
    for (const f of files) {
      const fp = join(dirPath, f);
      try {
        const st = statSync(fp);
        if (st.mtimeMs < cutoff) continue;
        candidates.push({ fp, mt: st.mtimeMs, size: st.size });
      } catch { /* unreadable — skip */ }
    }
  }
  candidates.sort((a, b) => b.mt - a.mt);

  const prompts: string[] = [];
  let bytesRead = 0;
  for (const c of candidates) {
    if (bytesRead >= maxBytes || prompts.length >= maxPrompts) break;
    bytesRead += c.size;
    let raw = "";
    try { raw = readFileSync(c.fp, "utf8"); } catch { continue; }
    for (const line of raw.split("\n")) {
      if (prompts.length >= maxPrompts) break;
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as {
          type?: string;
          role?: string;
          message?: { role?: string; content?: unknown };
          content?: unknown;
        };
        // Claude Code shape: { type: "user", message: { role: "user", content: "..." } }
        const role = msg.role ?? msg.message?.role ?? msg.type;
        if (role !== "user") continue;
        const content = msg.message?.content ?? msg.content;
        if (typeof content === "string") {
          prompts.push(content);
        } else if (Array.isArray(content)) {
          for (const part of content) {
            if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
              prompts.push(part.text);
            }
          }
        }
      } catch { /* skip malformed */ }
    }
  }
  return prompts;
}

function renderRows(profileName: string, rows: TriggerGapRow[], sinceDays: number): string {
  if (rows.length === 0) {
    return `No trigger gaps for "${profileName}" in the last ${sinceDays}d. Every trigger that fired in a prompt also fired a skill — routing is healthy.`;
  }
  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
  const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
  const out: string[] = [];
  out.push(`Trigger gaps for "${profileName}" (last ${sinceDays}d):`);
  out.push("");
  out.push("  Prompts matched a trigger but the skill didn't fire. Either the");
  out.push("  skill's description is too weak to route, or the trigger is too");
  out.push("  generic. Sharpen the description, then re-run.");
  out.push("");
  out.push(`  ${dim("gap   matched   hits   skill")}`);
  for (const r of rows) {
    const gap = String(r.gap).padStart(3);
    const matched = String(r.matchedPrompts).padStart(7);
    const hits = String(r.recordedHits).padStart(4);
    out.push(`  ${yellow(gap)}   ${matched}   ${hits}   ${r.id}`);
    out.push(`        ${dim(`triggers: ${r.sampleTriggers.map((t) => `"${t}"`).join(", ")}`)}`);
  }
  return out.join("\n");
}

export async function run(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(helpText());
    return 0;
  }
  if (!telemetryEnabled()) {
    process.stderr.write(
      "cue trigger-gaps: telemetry is disabled — no hit counts to compare against. " +
      "Enable with `cue telemetry enable`.\n",
    );
    return 1;
  }
  const profileName = resolveActiveProfile(args.profile);
  if (!profileName) {
    process.stderr.write("cue trigger-gaps: no profile pinned and --profile not given\n");
    return 1;
  }

  let loaded;
  try { loaded = await loadProfile(profileName); }
  catch (err) {
    process.stderr.write(`cue trigger-gaps: cannot load "${profileName}": ${(err as Error).message}\n`);
    return 1;
  }

  // Parse each profile skill for its trigger phrases (same code path the
  // materializer uses to build the router table).
  const skills: ParsedSkill[] = [];
  const skillRefs = (loaded.skills?.local ?? [])
    .map((s) => typeof s === "string" ? s : s.id)
    .filter((id) => !id.includes("*"));
  for (const id of skillRefs) {
    try {
      const dir = await resolveLocalSkill(id);
      skills.push(await parseSkillFromDir(id, dir));
    } catch { /* skip — unresolvable on disk */ }
  }

  const userPrompts = collectUserPrompts(args.sinceDays);
  const usage = computeSkillUsage(loaded, { windowDays: args.sinceDays });
  const hits = new Map<string, number>();
  for (const u of usage) hits.set(u.id, u.hits);

  const rows = computeTriggerGaps({
    skills,
    userPrompts,
    hits,
    limit: args.limit,
  });

  if (args.json) {
    process.stdout.write(JSON.stringify({
      profile: profileName,
      windowDays: args.sinceDays,
      promptsScanned: userPrompts.length,
      rows,
    }, null, 2) + "\n");
    return 0;
  }
  process.stdout.write(renderRows(profileName, rows, args.sinceDays) + "\n");
  if (userPrompts.length === 0) {
    process.stderr.write(
      "\n(No transcripts found under ~/.claude/projects/. The gap detector needs " +
      "session history to compare against trigger phrases.)\n",
    );
  }
  return 0;
}
