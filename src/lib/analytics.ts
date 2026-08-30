/**
 * Analytics — append-only JSONL log of profile usage.
 * Storage: ~/.config/cue/analytics.jsonl
 */

import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

import { repoScopeMatcher, type RepoScopeOptions } from "./repo-scope";
import { isEnabled as telemetryEnabled } from "./telemetry-consent";

/**
 * Resolve the analytics log path. Lazy — read XDG_CONFIG_HOME on every call so
 * tests (and any caller that mutates the env at runtime) get the current value.
 * Previously this was a top-level const, which froze the path at module-load
 * time and caused parallel test files to race on the same captured value.
 */
function analyticsPath(): string {
  return join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    "cue",
    "analytics.jsonl",
  );
}

/**
 * Session-summary hook (resources/hooks/session-summary.sh) appends one line
 * per session end here. Read it as a secondary source for sessions counts so
 * usage stats reflect real hook data, not just the launch-time analytics path.
 */
/** Same lazy pattern for the session-summary hook's log. */
function sessionLogPath(): string {
  return join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    "cue",
    "session-log.jsonl",
  );
}

interface SessionLogEntry {
  ts: string;
  cwd: string;
  profile: string;
  session_id: string;
}

function readSessionLog(since?: Date): SessionLogEntry[] {
  if (!existsSync(sessionLogPath())) return [];
  const out: SessionLogEntry[] = [];
  for (const line of readFileSync(sessionLogPath(), "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as SessionLogEntry;
      if (!e.profile) continue;
      if (since && new Date(e.ts) < since) continue;
      out.push(e);
    } catch { /* skip malformed */ }
  }
  return out;
}

/**
 * SessionEvent — superset shape used by every emitter. Discriminated by
 * `event`. Most fields are optional because they only apply to specific
 * variants:
 *
 *   - `start` / `end`: profile, agent, cwd, duration_s (end only)
 *   - `skill_hit` (legacy regex match from transcript): profile, agent, cwd, skill
 *   - `skill_invoked` (structured `Skill` tool_use): skill, session_id, tool_use_id
 *   - `skill_miss` (trigger matched but skill wasn't fired): session_id,
 *     prompt_redacted (first 80 chars, secret-masked), matched_skills
 *   - `skill_gap` (self-learner — profile-self-improve.sh Stop hook): where the
 *     active profile's skills fell short. `source:"hook"` carries cheap friction
 *     `signals`; `source:"critic"` carries a critic-agent verdict (`skill`,
 *     `gap_type`, `suggestion`, `confidence`). Consumed by `cue profile
 *     self-improve`; inert to existing readers.
 */
export interface SessionEvent {
  ts: string;
  event: "start" | "end" | "skill_hit" | "skill_invoked" | "skill_miss" | "skill_gap";
  profile?: string;
  agent?: "claude-code" | "codex";
  cwd?: string;
  duration_s?: number;
  skill?: string;
  session_id?: string;
  tool_use_id?: string;
  prompt_redacted?: string;
  matched_skills?: string[];
  // skill_gap variant
  source?: "hook" | "critic";
  signals?: string[];
  gap_type?: "missing-skill" | "weak-description" | "weak-body" | "profile-composition";
  suggestion?: string;
  confidence?: number;
  first_prompt?: string;
}

/**
 * Append an event to the local analytics log. Silently skipped when the
 * user hasn't opted in via `cue telemetry enable`. The consent check is
 * cheap (single existsSync) so per-call overhead is negligible.
 */
export function recordEvent(event: SessionEvent): void {
  if (!telemetryEnabled()) return;
  mkdirSync(dirname(analyticsPath()), { recursive: true });
  appendFileSync(analyticsPath(), JSON.stringify(event) + "\n");
}

/**
 * Record skill usage from session transcripts.
 * Scans the most recent session for skill references and logs them.
 */
export function recordSkillUsage(profile: string, agent: "claude-code" | "codex"): void {
  const projectsDir = join(homedir(), ".claude", "projects");
  if (!existsSync(projectsDir)) return;

  try {
    const { readdirSync, statSync, openSync, readSync, closeSync } = require("node:fs");
    const dirs = readdirSync(projectsDir).filter((d: string) => {
      try { return statSync(join(projectsDir, d)).isDirectory(); } catch { return false; }
    });

    // Find most recent session (only check last 5 dirs)
    let latestFile = "";
    let latestMtime = 0;
    for (const dir of dirs.slice(-5)) {
      const files = readdirSync(join(projectsDir, dir)).filter((f: string) => f.endsWith(".jsonl"));
      for (const f of files.slice(-3)) {
        const p = join(projectsDir, dir, f);
        const mt = statSync(p).mtimeMs;
        if (mt > latestMtime) { latestMtime = mt; latestFile = p; }
      }
    }

    if (!latestFile || Date.now() - latestMtime > 300_000) return; // only last 5 min

    // Read only first 50KB
    const fd = openSync(latestFile, "r");
    const buf = Buffer.alloc(50_000);
    const bytesRead = readSync(fd, buf, 0, 50_000, 0);
    closeSync(fd);
    const content = buf.toString("utf8", 0, bytesRead);
    const skillRefs = content.match(/skills\/([a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)?)\/SKILL\.md/g);
    if (!skillRefs) return;

    const seen = new Set<string>();
    const ts = new Date().toISOString();
    for (const ref of skillRefs) {
      const skill = ref.replace("skills/", "").replace("/SKILL.md", "");
      if (seen.has(skill)) continue;
      seen.add(skill);
      recordEvent({ ts, event: "skill_hit", profile, agent, cwd: process.cwd(), skill });
    }
  } catch { /* non-fatal */ }
}

// Process-level cache keyed by resolved file path + mtime.
// Two computeStats() calls in the same picker prep share one read; a new
// path (tests using XDG_CONFIG_HOME overrides) or a file write (new events
// appended) both bust the cache automatically.
interface EventsCache { path: string; mtimeMs: number; events: SessionEvent[] }
let _eventsCache: EventsCache | undefined;

export function readEvents(since?: Date): SessionEvent[] {
  const path = analyticsPath();
  let mtimeMs = 0;
  try {
    const { statSync } = require("node:fs") as typeof import("node:fs");
    mtimeMs = statSync(path).mtimeMs;
  } catch { /* file missing — mtimeMs stays 0 */ }

  if (!_eventsCache || _eventsCache.path !== path || _eventsCache.mtimeMs !== mtimeMs) {
    const events: SessionEvent[] = [];
    if (mtimeMs > 0) {
      const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        try { events.push(JSON.parse(line) as SessionEvent); } catch { /* skip malformed */ }
      }
    }
    _eventsCache = { path, mtimeMs, events };
  }

  const all = _eventsCache.events;
  if (!since) return all;
  return all.filter((e) => new Date(e.ts) >= since);
}

export interface ProfileStats {
  profile: string;
  sessions: number;
  total_duration_s: number;
  avg_duration_s: number;
  last_used: string | null;
}

export interface ComputeStatsOptions extends RepoScopeOptions {
  since?: Date;
  /**
   * `cwd` (inherited) scopes Recent to the repository being launched in, so
   * launches from $HOME — or from an unrelated project — don't squat in the
   * Recent slots here. Repository rather than raw subtree, matching how combo
   * history and pair affinity scope: a launch in `packages/core` and one at the
   * repo root are the same project, and Recent should say so.
   */
}

/**
 * Accepts either a legacy `Date` (treated as `since`) or an options object.
 * Kept this way to avoid touching every caller; new callers should pass the
 * options object form.
 */
export function computeStats(optsOrSince: Date | ComputeStatsOptions = {}): ProfileStats[] {
  const opts: ComputeStatsOptions = optsOrSince instanceof Date
    ? { since: optsOrSince }
    : optsOrSince;
  const { since } = opts;
  // undefined when unscoped — then every event counts, as before.
  const matchesCwd = repoScopeMatcher(opts) ?? ((): boolean => true);

  const events = readEvents(since);
  const map = new Map<string, { sessions: number; total_s: number; last: string; seenIds: Set<string> }>();

  for (const e of events) {
    if (e.event !== "start") continue;
    if (!e.profile) continue;
    if (!matchesCwd(e.cwd)) continue;
    const entry = map.get(e.profile) ?? { sessions: 0, total_s: 0, last: "", seenIds: new Set<string>() };
    entry.sessions++;
    if (e.ts > entry.last) entry.last = e.ts;
    map.set(e.profile, entry);
  }

  // Fold in hook-emitted session-log entries (Stop hook). Dedupe by session_id
  // so a session that fires both the launch-time analytics and the Stop hook
  // doesn't double-count. Entries without an id fall through as best-effort.
  for (const e of readSessionLog(since)) {
    if (!matchesCwd(e.cwd)) continue;
    const entry = map.get(e.profile) ?? { sessions: 0, total_s: 0, last: "", seenIds: new Set<string>() };
    const key = e.session_id || `${e.ts}|${e.cwd}`;
    if (entry.seenIds.has(key)) continue;
    entry.seenIds.add(key);
    entry.sessions++;
    if (e.ts > entry.last) entry.last = e.ts;
    map.set(e.profile, entry);
  }

  for (const e of events) {
    if (e.event !== "end" || !e.duration_s) continue;
    if (!e.profile) continue;
    if (!matchesCwd(e.cwd)) continue;
    const entry = map.get(e.profile);
    if (entry) entry.total_s += e.duration_s;
  }

  return [...map.entries()]
    .map(([profile, d]) => ({
      profile,
      sessions: d.sessions,
      total_duration_s: d.total_s,
      avg_duration_s: d.sessions > 0 ? Math.round(d.total_s / d.sessions) : 0,
      last_used: d.last || null,
    }))
    .sort((a, b) => b.sessions - a.sessions);
}

export interface DailyActivity {
  /** Calendar day, `YYYY-MM-DD` (UTC). */
  date: string;
  sessions: number;
}

/**
 * Sessions per calendar day over the window, gap-filled so a sparkline/area
 * chart is continuous (days with no activity render as 0, not a missing point).
 * Dedupes a session that appears in both the `start` events and the Stop-hook
 * session log by `session_id`, mirroring computeStats' intent.
 */
export function computeDailyActivity(sinceDays: number, now: number = Date.now()): DailyActivity[] {
  const days = Math.max(1, Math.floor(sinceDays));
  // Read from the START of the oldest day we actually render a bucket for. Reading
  // a full `days` span back (now - days*day) reaches into the day BEFORE the oldest
  // bucket: those events have no bucket, and worse, their session ids poison the
  // dedup `seen` set, so a session that starts late on that prior day but whose
  // Stop-hook log lands on the oldest shown day is dropped from the chart entirely.
  // Anchoring `since` to the oldest bucket's UTC midnight keeps read and display
  // windows identical.
  const oldestDay = new Date(now - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const since = new Date(`${oldestDay}T00:00:00.000Z`);
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  const bump = (ts: string, id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const day = ts.slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  };
  for (const e of readEvents(since)) {
    if (e.event !== "start" || !e.profile) continue;
    bump(e.ts, e.session_id || `start|${e.ts}|${e.cwd ?? ""}`);
  }
  for (const e of readSessionLog(since)) {
    bump(e.ts, e.session_id || `log|${e.ts}|${e.cwd}`);
  }
  const out: DailyActivity[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = new Date(now - i * 86_400_000).toISOString().slice(0, 10);
    out.push({ date: key, sessions: counts.get(key) ?? 0 });
  }
  return out;
}

export interface DurationSummary {
  /** Average length of *ended* sessions, in seconds. */
  avgS: number;
  /** Total tracked session time, in seconds. */
  totalS: number;
  /** How many sessions had a recorded end (the basis for avgS). */
  ended: number;
}

/**
 * Aggregate session-duration stats from `end` events (the only ones carrying
 * `duration_s`). Reported separately from session *counts* because many
 * sessions start but never log a clean end — averaging over starts would
 * understate real session length.
 */
export function sessionDurationSummary(since?: Date): DurationSummary {
  const ends = readEvents(since).filter(
    (e) => e.event === "end" && typeof e.duration_s === "number",
  );
  const totalS = ends.reduce((a, e) => a + (e.duration_s ?? 0), 0);
  return { avgS: ends.length ? Math.round(totalS / ends.length) : 0, totalS, ended: ends.length };
}

export interface SkillUsageStats {
  skill: string;
  hits: number;
  lastUsed: string | null;
}

export function skillStats(profile?: string, since?: Date): SkillUsageStats[] {
  const events = readEvents(since).filter(e => e.event === "skill_hit" && e.skill);
  const filtered = profile ? events.filter(e => e.profile === profile) : events;

  const map = new Map<string, { hits: number; last: string }>();
  for (const e of filtered) {
    const entry = map.get(e.skill!) ?? { hits: 0, last: "" };
    entry.hits++;
    if (e.ts > entry.last) entry.last = e.ts;
    map.set(e.skill!, entry);
  }

  return [...map.entries()]
    .map(([skill, d]) => ({ skill, hits: d.hits, lastUsed: d.last || null }))
    .sort((a, b) => b.hits - a.hits);
}
