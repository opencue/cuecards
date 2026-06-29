/**
 * Transcript ingest for cue telemetry.
 *
 * Reads recent Claude Code transcripts under `~/.claude/projects/*\/*.jsonl`,
 * parses tool_use events with `name === "Skill"`, emits `skill_invoked`
 * events. Also matches user prompts against a known set of trigger phrases
 * to emit `skill_miss` events when Claude clearly should have invoked a
 * skill but didn't.
 *
 * Idempotent: a JSON tracker at `~/.config/cue/.telemetry-seen.json`
 * records every (session, message/tool_use) pair we've already processed
 * so repeat ingests don't double-count.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { recordEvent, type SessionEvent } from "./analytics";
import { redactPrompt } from "./telemetry-redact";
import { isEnabled, seenTrackerPath } from "./telemetry-consent";

const DEFAULT_PROJECTS_DIR = join(homedir(), ".claude", "projects");
const MAX_BYTES_PER_TRANSCRIPT = 5 * 1024 * 1024;
// A trigger phrase needs at least one of these properties before it's used
// for miss detection; otherwise short / common phrases match everything.
const MIN_TRIGGER_LENGTH = 8;

/**
 * Heuristic patterns that mark a "user" message as actually being a system /
 * sub-agent / orchestrator prompt, not a real user keystroke. Excluded from
 * miss detection because it would otherwise drown the signal in tool-loop
 * noise. Iterate this list as new patterns surface.
 */
const SUB_AGENT_PROMPT_PATTERNS: RegExp[] = [
  /^<observed_from_/i,
  /^<system-reminder/i,
  /^<command-name/i,
  /MODE SWITCH:/,
  /^You are (?:the |an? )/i,
  /^Hello memory agent/i,
  /<task-notification/i,
  /<user-prompt-submit-hook/i,
  /Caveat: The messages below were generated/i,
  /^This session is being continued from a previous conversation/i,
  /^Base directory for this skill:/i,
  /^Translate the following markdown/i,
];

function looksLikeAgentPrompt(text: string): boolean {
  const head = text.trimStart().slice(0, 200);
  return SUB_AGENT_PROMPT_PATTERNS.some((re) => re.test(head));
}

export interface IngestOptions {
  /** Override the projects root (defaults to ~/.claude/projects). Used in tests. */
  projectsDir?: string;
  /** Window in days; transcripts older than this are skipped. */
  sinceDays?: number;
  /** Per-skill trigger phrases for miss detection. Map: skill name → phrases. */
  triggers?: Map<string, string[]>;
  /** Override seen-tracker path (used in tests). */
  seenTrackerOverride?: string;
}

export interface IngestStats {
  transcriptsScanned: number;
  newInvocations: number;
  newMisses: number;
  skippedDuplicates: number;
}

interface SeenTracker {
  invocations: Set<string>;
  misses: Set<string>;
}

/** Recently-modified transcripts, mtime-sorted (newest first). */
function recentTranscripts(projectsDir: string, sinceDays: number): string[] {
  if (!existsSync(projectsDir)) return [];
  const cutoff = Date.now() - sinceDays * 24 * 3600 * 1000;
  const out: { path: string; mtime: number }[] = [];
  try {
    for (const proj of readdirSync(projectsDir)) {
      const projDir = join(projectsDir, proj);
      try {
        for (const f of readdirSync(projDir)) {
          if (!f.endsWith(".jsonl")) continue;
          const full = join(projDir, f);
          try {
            const st = statSync(full);
            if (st.mtimeMs >= cutoff) out.push({ path: full, mtime: st.mtimeMs });
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  out.sort((a, b) => b.mtime - a.mtime);
  return out.map((x) => x.path);
}

function loadSeen(path: string): SeenTracker {
  if (!existsSync(path)) return { invocations: new Set(), misses: new Set() };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      invocations?: string[];
      misses?: string[];
    };
    return {
      invocations: new Set(raw.invocations ?? []),
      misses: new Set(raw.misses ?? []),
    };
  } catch {
    return { invocations: new Set(), misses: new Set() };
  }
}

function saveSeen(path: string, seen: SeenTracker): void {
  // Atomic write (tmp + rename) so a crash mid-write can't corrupt the dedup
  // tracker and cause every previously-seen event to re-emit on the next ingest.
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify({
    invocations: [...seen.invocations],
    misses: [...seen.misses],
  }, null, 2) + "\n");
  renameSync(tmp, path);
}

interface ParsedTurn {
  kind: "user" | "assistant";
  text: string;
  toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  messageId: string | null;
  sessionId: string | null;
  timestamp: string | null;
}

/**
 * Pure parser: takes a transcript content string, returns the turn-by-turn
 * structure cue cares about. Exposed for tests; the real callers go through
 * `ingestTranscript` which wraps this with the dedup tracker + event writer.
 */
export function parseTranscript(content: string): ParsedTurn[] {
  const turns: ParsedTurn[] = [];
  for (const rawLine of content.split("\n")) {
    if (!rawLine.trim()) continue;
    let line: Record<string, unknown>;
    try { line = JSON.parse(rawLine) as Record<string, unknown>; } catch { continue; }
    const sessionId = typeof line.sessionId === "string" ? line.sessionId : null;
    const timestamp = typeof line.timestamp === "string" ? line.timestamp : null;
    const message = line.message as Record<string, unknown> | undefined;
    if (!message || typeof message !== "object") continue;

    const role = typeof message.role === "string" ? message.role : null;
    const messageId = typeof message.id === "string" ? message.id : null;
    if (role !== "user" && role !== "assistant") continue;

    let text = "";
    const toolUses: ParsedTurn["toolUses"] = [];
    const content = message.content;

    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string") {
          text += (text ? " " : "") + b.text;
        } else if (b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string") {
          const input = (b.input && typeof b.input === "object" && !Array.isArray(b.input))
            ? (b.input as Record<string, unknown>)
            : {};
          toolUses.push({ id: b.id, name: b.name, input });
        }
      }
    }

    turns.push({ kind: role, text: text.trim(), toolUses, messageId, sessionId, timestamp });
  }
  return turns;
}

interface TriggerIndex {
  /** Map: lowercase trigger phrase → list of skill names that own it. */
  byPhrase: Map<string, string[]>;
}

function buildTriggerIndex(triggers: Map<string, string[]>): TriggerIndex {
  const byPhrase = new Map<string, string[]>();
  for (const [skill, phrases] of triggers) {
    for (const phrase of phrases) {
      const norm = phrase.toLowerCase().trim();
      if (norm.length < MIN_TRIGGER_LENGTH && !/\s/.test(norm)) continue;
      const list = byPhrase.get(norm) ?? [];
      list.push(skill);
      byPhrase.set(norm, list);
    }
  }
  return { byPhrase };
}

function matchTriggers(text: string, index: TriggerIndex): string[] {
  const lower = text.toLowerCase();
  const matched = new Set<string>();
  for (const [phrase, skills] of index.byPhrase) {
    if (lower.includes(phrase)) {
      for (const s of skills) matched.add(s);
    }
  }
  return [...matched];
}

/** Process a single transcript file. Returns counts of new events emitted. */
function ingestTranscript(
  path: string,
  triggers: TriggerIndex | null,
  seen: SeenTracker,
): { invocations: number; misses: number; duplicates: number } {
  let contentRaw: string;
  try {
    const st = statSync(path);
    if (st.size > MAX_BYTES_PER_TRANSCRIPT) {
      // Read a 5MB tail: recent activity matters most.
      const buf = Buffer.alloc(MAX_BYTES_PER_TRANSCRIPT);
      const fd = require("node:fs").openSync(path, "r");
      try {
        require("node:fs").readSync(fd, buf, 0, MAX_BYTES_PER_TRANSCRIPT, st.size - MAX_BYTES_PER_TRANSCRIPT);
      } finally {
        require("node:fs").closeSync(fd);
      }
      contentRaw = buf.toString("utf8");
      // Drop the first (possibly truncated) line.
      const nl = contentRaw.indexOf("\n");
      if (nl >= 0) contentRaw = contentRaw.slice(nl + 1);
    } else {
      contentRaw = readFileSync(path, "utf8");
    }
  } catch {
    return { invocations: 0, misses: 0, duplicates: 0 };
  }

  const turns = parseTranscript(contentRaw);
  let invocations = 0;
  let misses = 0;
  let duplicates = 0;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]!;

    if (turn.kind === "assistant") {
      for (const tu of turn.toolUses) {
        if (tu.name !== "Skill") continue;
        const skill = typeof tu.input.skill === "string" ? tu.input.skill : null;
        if (!skill) continue;
        const key = `${turn.sessionId ?? "no-session"}|${tu.id}`;
        if (seen.invocations.has(key)) { duplicates++; continue; }
        seen.invocations.add(key);
        const event: SessionEvent = {
          ts: turn.timestamp ?? new Date().toISOString(),
          event: "skill_invoked",
          skill,
          session_id: turn.sessionId ?? undefined,
          tool_use_id: tu.id,
        };
        recordEvent(event);
        invocations++;
      }
      continue;
    }

    // User turn: miss detection. Requires a trigger index + a non-empty prompt.
    if (!triggers || turn.text.length === 0) continue;
    // Filter out sub-agent / orchestrator prompts — they aren't real user
    // intent and drown the signal otherwise.
    if (looksLikeAgentPrompt(turn.text)) continue;
    const matchedSkills = matchTriggers(turn.text, triggers);
    if (matchedSkills.length === 0) continue;

    // Look at the very next assistant turn. Did it invoke ANY of the matched
    // skills via the Skill tool? If yes → not a miss. Otherwise → miss.
    const nextAssistant = turns.slice(i + 1).find((t) => t.kind === "assistant");
    const invokedSkillNames = new Set<string>();
    if (nextAssistant) {
      for (const tu of nextAssistant.toolUses) {
        if (tu.name === "Skill" && typeof tu.input.skill === "string") {
          invokedSkillNames.add(tu.input.skill);
        }
      }
    }
    if (matchedSkills.some((s) => invokedSkillNames.has(s))) continue;

    const key = `${turn.sessionId ?? "no-session"}|${turn.messageId ?? `turn-${i}`}`;
    if (seen.misses.has(key)) { duplicates++; continue; }
    seen.misses.add(key);
    recordEvent({
      ts: turn.timestamp ?? new Date().toISOString(),
      event: "skill_miss",
      session_id: turn.sessionId ?? undefined,
      prompt_redacted: redactPrompt(turn.text),
      matched_skills: matchedSkills,
    });
    misses++;
  }

  return { invocations, misses, duplicates };
}

export async function ingest(opts: IngestOptions = {}): Promise<IngestStats> {
  if (!isEnabled()) {
    return { transcriptsScanned: 0, newInvocations: 0, newMisses: 0, skippedDuplicates: 0 };
  }

  const projectsDir = opts.projectsDir ?? DEFAULT_PROJECTS_DIR;
  const sinceDays = opts.sinceDays ?? 7;
  const transcripts = recentTranscripts(projectsDir, sinceDays);
  const seenPath = opts.seenTrackerOverride ?? seenTrackerPath();
  const seen = loadSeen(seenPath);
  const triggerIndex = opts.triggers ? buildTriggerIndex(opts.triggers) : null;

  let newInvocations = 0;
  let newMisses = 0;
  let skippedDuplicates = 0;
  for (const path of transcripts) {
    const r = ingestTranscript(path, triggerIndex, seen);
    newInvocations += r.invocations;
    newMisses += r.misses;
    skippedDuplicates += r.duplicates;
  }

  saveSeen(seenPath, seen);
  return {
    transcriptsScanned: transcripts.length,
    newInvocations,
    newMisses,
    skippedDuplicates,
  };
}
